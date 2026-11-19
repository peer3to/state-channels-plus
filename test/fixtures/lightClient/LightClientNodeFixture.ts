// @spec-test-coverage-ignore: test-owned peer3 node with light client endpoints; executable evidence belongs to its calling test declarations
import { JsonRpcSocket } from "./JsonRpcSocket";
import { LightClientSidecar } from "./LightClientSidecar";
import {
    LIGHT_CLIENT_METHODS,
    type LightClientStorageBlock,
    type LightClientSubscription
} from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { type NodeHandle, startPeer3Node } from "@test/utils/nodeInfra";
import { waitFor } from "@test/utils/waitFor";
import {
    concat,
    HDNodeWallet,
    JsonRpcProvider,
    Mnemonic,
    type TransactionReceipt
} from "ethers";

/** What a light client test fails with on a node without the endpoints. */
export const LIGHT_CLIENT_UNSUPPORTED = "RPC node doesn't support LC endpoints";

/** The existential deposit of the peer3 runtime, a constant of it. */
export const PEER3_EXISTENTIAL_DEPOSIT = 1_000_000_000n;

/** The first account the peer3 test chain funds: the Hardhat mnemonic's. */
const FUNDED_MNEMONIC =
    "test test test test test test test test test test test junk";
/** Above the paid lane's floor, so a transaction never asks for the free lane. */
const TRANSACTION_FEES = { type: 0, gasPrice: 10_000_000_000n };
/**
 * Creation code of a contract whose runtime stores what it is called with and
 * logs the slot as its only topic: `sstore(calldata[0:32], calldata[32:64])`,
 * then `log1(calldata[0:32])`.
 */
const STORE_AND_LOG_CONTRACT =
    "0x601080600b6000396000f36020356000355560003560006000a100";

/** A subscription id a light client endpoint gave. */
type SubscriptionId = string;

/**
 * Throws {@link LIGHT_CLIENT_UNSUPPORTED} unless the node behind `socket`
 * lists the light client methods.
 */
export async function assertLightClientEndpoints(
    socket: JsonRpcSocket
): Promise<void> {
    // a node without the Substrate RPC does not answer rpc_methods at all
    const methods = await socket
        .request<{ methods: string[] }>("rpc_methods")
        .then((listed) => listed.methods)
        .catch((): string[] => []);
    const missing = [
        LIGHT_CLIENT_METHODS.subscribe,
        LIGHT_CLIENT_METHODS.unsubscribe
    ].filter((method) => !methods.includes(method));
    if (missing.length > 0)
        throw new Error(
            `${LIGHT_CLIENT_UNSUPPORTED}: ${missing.join(", ")} not listed`
        );
}

/** One light client connection and the blocks pushed to it. */
export class LightClientConnection {
    /** Every pushed block in arrival order, with the subscription it came for. */
    readonly pushed: {
        subscription: SubscriptionId;
        block: LightClientStorageBlock;
    }[] = [];
    private readonly socket: JsonRpcSocket;

    constructor(socket: JsonRpcSocket) {
        this.socket = socket;
        socket.onNotification((method, params) => {
            if (method !== LIGHT_CLIENT_METHODS.notification) return;
            const { subscription, result } = params as {
                subscription: SubscriptionId;
                result: LightClientStorageBlock;
            };
            this.pushed.push({ subscription, block: result });
        });
    }

    subscribe(subscription: LightClientSubscription): Promise<SubscriptionId> {
        return this.socket.request(LIGHT_CLIENT_METHODS.subscribe, [
            subscription
        ]);
    }

    /** Whether the endpoint held the subscription. */
    unsubscribe(subscription: SubscriptionId): Promise<boolean> {
        return this.socket.request(LIGHT_CLIENT_METHODS.unsubscribe, [
            subscription
        ]);
    }

    /** The `result` of any other call the endpoint serves. */
    request<T>(method: string, params: unknown[] = []): Promise<T> {
        return this.socket.request(method, params);
    }
}

/**
 * A peer3 dev node of this test's own with light client endpoints in front of
 * it. The node is the binary `PEER3_NODE_BIN` names. Until the node serves the
 * endpoints itself, the test-owned sidecar adds them.
 */
export class LightClientNodeFixture {
    /** Reads straight from the node, past the light client endpoints. */
    readonly provider: JsonRpcProvider;
    private readonly node: NodeHandle;
    private readonly sidecar: LightClientSidecar;
    private readonly wallet: HDNodeWallet;
    private readonly sockets: JsonRpcSocket[] = [];
    private readonly proxies: RpcNodeProxy[] = [];
    /** The funded account's next nonce; several transactions can share a block. */
    private nextNonce = 0;

    private constructor(node: NodeHandle, sidecar: LightClientSidecar) {
        this.node = node;
        this.sidecar = sidecar;
        this.provider = new JsonRpcProvider(node.url, undefined, {
            staticNetwork: true,
            // a receipt is asked for well inside the node's block time
            pollingInterval: 250
        });
        this.wallet = HDNodeWallet.fromMnemonic(
            Mnemonic.fromPhrase(FUNDED_MNEMONIC),
            "m/44'/60'/0'/0/0"
        ).connect(this.provider);
    }

    /**
     * Starts the node and its light client endpoints. Throws
     * {@link LIGHT_CLIENT_UNSUPPORTED} at once when no peer3 node binary is
     * named, because the Hardhat test node has no such endpoints.
     */
    static async start(): Promise<LightClientNodeFixture> {
        if (!process.env.PEER3_NODE_BIN)
            throw new Error(
                `${LIGHT_CLIENT_UNSUPPORTED}: PEER3_NODE_BIN names no peer3 node binary`
            );
        const node = await startPeer3Node();
        try {
            const sidecar = await LightClientSidecar.start(node.url);
            return new LightClientNodeFixture(node, sidecar);
        } catch (error) {
            node.stop();
            throw error;
        }
    }

    async stop(): Promise<void> {
        for (const socket of this.sockets) socket.close();
        for (const proxy of this.proxies) await proxy.close();
        this.provider.destroy();
        await this.sidecar.close();
        this.node.stop();
        await this.node.exited;
    }

    /** A connection to the light client endpoints, after checking the node lists them. */
    async connect(): Promise<LightClientConnection> {
        const socket = await this.open(this.sidecar.url);
        await assertLightClientEndpoints(socket);
        return new LightClientConnection(socket);
    }

    /** A socket to the node itself, which the fixture closes on stop. */
    connectToNode(): Promise<JsonRpcSocket> {
        return this.open(this.node.url);
    }

    /**
     * A socket to the node through a proxy of its own, which the test makes
     * answer in the node's place. The fixture closes both on stop.
     */
    async connectToNodeThroughProxy(): Promise<{
        proxy: RpcNodeProxy;
        socket: JsonRpcSocket;
    }> {
        const proxy = await RpcNodeProxy.start(this.node.url);
        this.proxies.push(proxy);
        return { proxy, socket: await this.open(proxy.url) };
    }

    /**
     * Resolves once the node sealed its first block: the genesis header names
     * no Ethereum block, so no proven read can start from it.
     */
    async firstBlockSealed(): Promise<void> {
        await waitFor(async () => (await this.provider.getBlockNumber()) > 0);
    }

    /** The account that sends this fixture's transactions. */
    get senderAddress(): string {
        return this.wallet.address.toLowerCase();
    }

    /** Deploys a contract that stores what it is called with and logs the slot as its topic. */
    async deployStoreAndLogContract(): Promise<string> {
        const receipt = await this.mined({ data: STORE_AND_LOG_CONTRACT });
        if (!receipt.contractAddress)
            throw new Error("The deployment created no contract");
        return receipt.contractAddress.toLowerCase();
    }

    /** Stores `value` at `slot` of `contract`; the receipt of the included transaction. */
    store(
        contract: string,
        slot: string,
        value: string
    ): Promise<TransactionReceipt> {
        return this.mined({ to: contract, data: concat([slot, value]) });
    }

    /**
     * Stores all of `stores` by one transaction each, all in one block. A
     * block sealed between two of them splits them, so they are sent again
     * until one block includes every one.
     */
    async storeInOneBlock(
        contract: string,
        stores: { slot: string; value: string }[]
    ): Promise<TransactionReceipt[]> {
        for (;;) {
            const receipts = await Promise.all(
                stores.map(({ slot, value }) =>
                    this.store(contract, slot, value)
                )
            );
            if (
                receipts.every(
                    (receipt) => receipt.blockNumber === receipts[0].blockNumber
                )
            )
                return receipts;
        }
    }

    private async open(url: string): Promise<JsonRpcSocket> {
        const socket = await JsonRpcSocket.open(url);
        this.sockets.push(socket);
        return socket;
    }

    private async mined(transaction: {
        to?: string;
        data: string;
    }): Promise<TransactionReceipt> {
        const sent = await this.wallet.sendTransaction({
            ...transaction,
            ...TRANSACTION_FEES,
            gasLimit: 200_000n,
            nonce: this.nextNonce++
        });
        const receipt = await sent.wait();
        if (receipt?.status !== 1)
            throw new Error(`Transaction ${sent.hash} did not succeed`);
        return receipt;
    }
}
