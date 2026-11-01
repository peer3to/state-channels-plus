// @spec-test-coverage-ignore: private node, storage diff service and proxies for the RPC mirror cases; declarations live in RpcMirror.test.ts
import { installMirrorShadowCheck } from "../MirrorShadowCheck";
import { RpcNodeProxy } from "./RpcNodeProxy";
import {
    deployNumberStorage,
    deployRuntimeCode,
    StorageDiffClient,
    withStorageDiffUpstream,
    type StorageDiffServiceSettings
} from "./StorageDiffService.fixture";
import {
    RECORDED_ACCOUNT_INFO,
    withSubstrateNode,
    type SubstrateContract
} from "./SubstrateChildTrieNode";
import type { UpstreamRelay } from "./UpstreamRelay";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmCustomPrecompiles";
import MirrorRpcProvider from "@/evm/p2pRuntime/rpcNodes/MirrorRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { createLogger } from "@/utils/logging";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import type { StorageDiffService } from "@/utils/node/storageDiff/StorageDiffService";
import {
    SimpleNumberStorage__factory,
    type SimpleNumberStorage
} from "@typechain-types";
import {
    HDNodeWallet,
    type JsonRpcProvider,
    type JsonRpcSigner,
    Wallet
} from "ethers";

/** Matches the anvil mnemonic in scripts/infra/anvilNode.js. */
const ANVIL_MNEMONIC =
    "test test test test test test test test test test test junk";

export type MirrorSession = {
    /** The provider under test. */
    provider: MirrorRpcProvider;
    /** The provider's node socket, for subscriptions of its own. */
    rpcNode: RpcNodeProvider;
    /** Between the storage diff service and the node. */
    relay: UpstreamRelay;
    /** Every request the provider sent to the node. */
    node: RpcNodeProxy;
    /** Every request and push between the provider and the service. */
    service: RpcNodeProxy;
    storageDiff: StorageDiffService;
    /** The node itself, bypassing the mirror. */
    chain: JsonRpcProvider;
    /** Node account 0 on the node, bypassing the mirror. */
    signer: JsonRpcSigner;
    /** Node account 0, sending its transactions through the mirror provider. */
    wallet: HDNodeWallet;
};

export type MirrorSessionSettings = StorageDiffServiceSettings & {
    customPrecompiles?: EvmCustomPrecompileManifest[];
    /** Build the provider without a storage diff URL. */
    withoutService?: boolean;
    /**
     * Fraction of local answers the provider re-asks of the node. Absent means
     * 0, so a test is deterministic; `undefined` named explicitly leaves the
     * provider's own default.
     */
    sampleRate?: number;
};

/**
 * Runs `use` with a private node, a storage diff service following it, and a
 * mirror provider reading through proxies of both; all end in `finally`.
 */
export async function withMirrorSession<T>(
    use: (session: MirrorSession) => Promise<T>,
    settings: MirrorSessionSettings = {}
): Promise<T> {
    const {
        customPrecompiles,
        withoutService,
        sampleRate: named,
        ...serviceSettings
    } = settings;
    const sampleRate = "sampleRate" in settings ? named : 0;
    return await withStorageDiffUpstream(
        async ({ provider: chain, relay, signer, start }) => {
            const storageDiff = await start(serviceSettings);
            const node = await RpcNodeProxy.start(chain._getConnection().url);
            const service = await RpcNodeProxy.start(storageDiff.url);
            const logger = createLogger(
                {},
                {},
                { level: "error", attachErrorListener: false }
            );
            // diagnostic mode: compare every local read with the node's
            if (process.env.MIRROR_SHADOW_LOG)
                installMirrorShadowCheck(
                    chain._getConnection().url,
                    process.env.MIRROR_SHADOW_LOG
                );
            const rpcNode = new RpcNodeProvider(node.url, logger);
            const provider = new MirrorRpcProvider([rpcNode], logger, {
                storageDiffUrl: withoutService ? undefined : service.url,
                sampleRate,
                customPrecompiles
            });
            try {
                await rpcNode.firstAttempt;
                return await use({
                    provider,
                    rpcNode,
                    relay,
                    node,
                    service,
                    storageDiff,
                    chain,
                    signer,
                    wallet: Wallet.fromPhrase(ANVIL_MNEMONIC).connect(provider)
                });
            } finally {
                provider.destroy();
                await Promise.all([node.close(), service.close()]);
                logger.dispose();
            }
        }
    );
}

/**
 * A mirror session whose backfill reads a scripted Substrate node about one
 * contract. The caller names the contract (`address`, `deployed`, `changes`)
 * once it is deployed; `entries` is how many child trie entries the node
 * counts, which the service checks against the history it replayed.
 */
export async function withSubstrateMirrorSession<T>(
    entries: SubstrateContract["entries"],
    use: (session: MirrorSession, contract: SubstrateContract) => Promise<T>
): Promise<T> {
    const contract: SubstrateContract = {
        address: "",
        changes: [],
        deployed: 0,
        tipNumber: -1,
        tipHash: () => "0xtip",
        info: RECORDED_ACCOUNT_INFO,
        entries
    };
    return await withSubstrateNode(
        contract,
        async (substrate) =>
            await withMirrorSession(
                async (session) => await use(session, contract),
                { backfillBlocks: new ChildTrieBlockSource(substrate.url) }
            )
    );
}

/**
 * A deployed `SimpleNumberStorage`: `storage` reads and sends through the
 * mirror provider, `chainStorage` goes straight to the node.
 */
export async function deployMirroredStorage(session: MirrorSession): Promise<{
    storage: SimpleNumberStorage;
    chainStorage: SimpleNumberStorage;
    address: string;
}> {
    const chainStorage = await deployNumberStorage(session.signer);
    const address = await chainStorage.getAddress();
    return {
        storage: SimpleNumberStorage__factory.connect(address, session.wallet),
        chainStorage,
        address
    };
}

/** Requests of `method` the provider sent to the node. */
export function nodeRequests(session: MirrorSession, method: string) {
    return session.node.forwardedRequests.filter(
        (request) => request.method === method
    );
}

/** The node's newest block number, read fresh (ethers caches its own). */
export async function headNumber(session: MirrorSession): Promise<number> {
    return Number(await session.chain.send("eth_blockNumber", []));
}

/** Self-call whose `argsSize` byte calldata dispatches the frame. */
function selfCall(argsSize: number): string {
    return (
        "6000" + // retSize
        "6000" + // retOffset
        "60" +
        argsSize.toString(16).padStart(2, "0") + // argsSize
        "6000" + // argsOffset
        "6000" + // value
        "30" + // ADDRESS
        "5a" + // GAS
        "f1" + // CALL
        "50" // POP
    );
}

/**
 * Runtime of the three-frame probe, told apart by calldata size: empty is the
 * parent, 1 byte the child, 2 bytes the grandchild. The grandchild writes slot
 * 0 and returns, the child calls it and reverts, the parent calls the child
 * and returns slot 0. A state that keeps a returned sub-call's write across
 * its caller's revert answers 7, a correct one 0.
 */
function commitProbeRuntime(): string {
    const grandchild = "6007" + "6000" + "55" + "00";
    const child = "5b" + selfCall(2) + "6000" + "6000" + "fd";
    const parent =
        "5b" +
        selfCall(1) +
        "6000" +
        "54" +
        "6000" +
        "52" +
        "6020" +
        "6000" +
        "f3";
    const head = (parentAt: number, childAt: number) =>
        "36" + // CALLDATASIZE
        "80" + // DUP1
        "15" + // ISZERO
        "60" +
        parentAt.toString(16).padStart(2, "0") +
        "57" + // JUMPI parent
        "6001" +
        "14" + // EQ 1
        "60" +
        childAt.toString(16).padStart(2, "0") +
        "57"; // JUMPI child
    const headLength = head(0, 0).length / 2;
    const childAt = headLength + grandchild.length / 2;
    const parentAt = childAt + child.length / 2;
    return head(parentAt, childAt) + grandchild + child + parent;
}

/** Deploys the commit probe and returns its address. */
export async function deployCommitProbe(
    signer: JsonRpcSigner
): Promise<string> {
    return await deployRuntimeCode(signer, commitProbeRuntime());
}

/** Requests of `method` the provider sent to the storage diff service. */
export function serviceRequests(session: MirrorSession, method: string) {
    return session.service.forwardedRequests.filter(
        (request) => request.method === method
    );
}

/**
 * Lets the session's storage diff service backfill `addresses` before the
 * mirror asks for them, so they are `ready` (or `lazy`) at its subscribe.
 */
export async function backfillAtService(
    session: MirrorSession,
    addresses: string[]
): Promise<void> {
    const client = await StorageDiffClient.connect(session.storageDiff.url);
    try {
        const subscription = await client.subscribe(
            addresses.map((address) => address.toLowerCase())
        );
        await client.nextSnapshot(subscription);
    } finally {
        client.close();
    }
}

/** State reads the provider sent to the node: slots, balances and code. */
export function nodeStateReads(session: MirrorSession): number {
    return (
        nodeRequests(session, "eth_getStorageAt").length +
        nodeRequests(session, "eth_getBalance").length +
        nodeRequests(session, "eth_getCode").length
    );
}

/**
 * Deploys a runtime that returns the block environment a call sees: TIMESTAMP,
 * NUMBER, BASEFEE, PREVRANDAO, GASLIMIT and COINBASE as six words.
 */
export async function deployEnvironmentProbe(
    signer: JsonRpcSigner
): Promise<string> {
    const opcodes = ["42", "43", "48", "44", "45", "41"];
    return await deployRuntimeCode(
        signer,
        opcodes
            .map(
                (op, i) =>
                    op + "60" + (32 * i).toString(16).padStart(2, "0") + "52"
            )
            .join("") + "60c06000f3"
    );
}

/** Runtime that calls `target` with no data and returns its success flag as a word. */
export function callerRuntime(target: string): string {
    return (
        "6000".repeat(5) + // retSize, retOffset, argsSize, argsOffset, value
        "73" +
        target.slice(2) + // PUSH20 target
        "5a" + // GAS
        "f1" + // CALL
        "600052" + // MSTORE(0, success)
        "60206000f3" // RETURN(0, 32)
    );
}
