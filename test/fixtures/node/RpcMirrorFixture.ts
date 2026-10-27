// @spec-test-coverage-ignore: private node, storage diff service and proxies for the RPC mirror cases; declarations live in RpcMirror.test.ts
import { RpcNodeProxy } from "./RpcNodeProxy";
import {
    deployNumberStorage,
    withStorageDiffUpstream,
    type StorageDiffServiceSettings
} from "./StorageDiffService.fixture";
import type { EvmCustomPrecompileManifest } from "@/evm/EvmFactory";
import MirrorRpcProvider from "@/evm/p2pRuntime/rpcNodes/MirrorRpcProvider";
import RpcNodeProvider from "@/evm/p2pRuntime/rpcNodes/RpcNodeProvider";
import { createLogger } from "@/utils/logging";
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
};

/**
 * Runs `use` with a private node, a storage diff service following it, and a
 * mirror provider reading through proxies of both; all end in `finally`.
 */
export async function withMirrorSession<T>(
    use: (session: MirrorSession) => Promise<T>,
    settings: MirrorSessionSettings = {}
): Promise<T> {
    const { customPrecompiles, withoutService, ...serviceSettings } = settings;
    return await withStorageDiffUpstream(
        async ({ provider: chain, signer, start }) => {
            const storageDiff = await start(serviceSettings);
            const node = await RpcNodeProxy.start(chain._getConnection().url);
            const service = await RpcNodeProxy.start(storageDiff.url);
            const logger = createLogger(
                {},
                {},
                { level: "error", attachErrorListener: false }
            );
            const rpcNode = new RpcNodeProvider(node.url, logger);
            const provider = new MirrorRpcProvider([rpcNode], logger, {
                storageDiffUrl: withoutService ? undefined : service.url,
                customPrecompiles
            });
            try {
                await rpcNode.firstAttempt;
                return await use({
                    provider,
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
