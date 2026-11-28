// @spec-test-coverage-ignore: test-owned peer3 node with light client endpoints; executable evidence belongs to its calling test declarations
import { JsonRpcSocket } from "./JsonRpcSocket";
import {
    LIGHT_CLIENT_METHODS,
    type LightClientStorageBlock,
    type LightClientSubscription
} from "@/evm/p2pRuntime/rpcNodes/lightClient/lightClientWire";
import type { ProvenBlock } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/AProvenStateReader";
import { PEER3_CHAIN_CONSTANTS } from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierChainConstants";
import FrontierProvenStateReader from "@/evm/p2pRuntime/rpcNodes/lightClient/proof/substrate/FrontierProvenStateReader";
import { RpcNodeProxy } from "@test/fixtures/node/RpcNodeProxy";
import { type NodeHandle, startPeer3Node } from "@test/utils/nodeInfra";
import { waitFor } from "@test/utils/waitFor";
import {
    concat,
    HDNodeWallet,
    JsonRpcProvider,
    Mnemonic,
    type Provider,
    type Signer,
    toBeHex,
    type TransactionReceipt,
    type TransactionResponse
} from "ethers";

/** A proven state reader over the node's light client `socket`. */
export function readerOver(socket: JsonRpcSocket): FrontierProvenStateReader {
    return new FrontierProvenStateReader(
        (method, params) => socket.request(method, params),
        PEER3_CHAIN_CONSTANTS
    );
}

/** What a light client test fails with on a node without the endpoints. */
export const LIGHT_CLIENT_UNSUPPORTED = "RPC node doesn't support LC endpoints";

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

/**
 * Creation code of a contract that, called with 64 bytes, stores the second
 * word at the slot the first names and logs the slot as its only topic, as
 * {@link STORE_AND_LOG_CONTRACT} does, and called with anything else returns
 * the word at the slot its calldata names.
 */
export const STORE_LOG_AND_READ_CONTRACT =
    "0x602480600b6000396000f3" +
    "36604014601357" +
    "6000355460005260206000f3" +
    "5b6020356000355560003560006000a100";

/**
 * Creation code of a contract that returns the block values a call reads, one
 * word each: NUMBER, TIMESTAMP, COINBASE, GASLIMIT, PREVRANDAO, BASEFEE and
 * CHAINID.
 */
export const BLOCK_VALUES_CONTRACT =
    "0x602180600b6000396000f3" +
    "4360005242602052416040524560605244608052" +
    "4860a0524660c05260e06000f3";
/**
 * Creation code of a contract that makes a static call to the address in its
 * first calldata word with the rest of its calldata, and returns or reverts
 * with what that call returned.
 */
export const STATIC_FORWARDER_CONTRACT =
    "0x602680600b6000396000f3" +
    "60006000366020900380602060003760006000355a" +
    "fa3d600060003e3d600082602457fd5bf3";

/** Creation code of a contract that returns the hash of the block before the call's. */
export const PREVIOUS_BLOCK_HASH_CONTRACT =
    "0x600d80600b6000396000f3" + "60014303406000526020" + "6000f3";

/**
 * Creation code of a contract that, called with 128 bytes `[topic, r, w, v]`,
 * stores `sload(r) + v` at slot `w` and logs with `topic` as its second topic
 * (its first is 1), as the state channel manager logs a channel id; called
 * with 32 bytes, it returns the word at the slot they name.
 */
export const PARTITION_CONTRACT =
    "0x602b80600b6000396000f3" +
    "36608014601357" +
    "6000355460005260206000f3" +
    "5b" +
    "602035546060350160403555" +
    "600035" +
    "6001" +
    "60006000a2" +
    "00";

/**
 * The calldata with which {@link PARTITION_CONTRACT} stores `sload(read) + add`
 * at slot `write`, logged with `topic`.
 */
export function partitionWrite(
    topic: string,
    read: number,
    write: number,
    add: number
): string {
    return concat([
        topic,
        toBeHex(read, 32),
        toBeHex(write, 32),
        toBeHex(add, 32)
    ]);
}

/** Creation code of a contract whose code is the invalid opcode `0xfe`. */
export const INVALID_OPCODE_CONTRACT = "0x600180600b6000396000f3" + "fe";

/** Creation code of a contract that reads memory at 2^32 - 1 and so runs out of any gas. */
export const OUT_OF_GAS_CONTRACT =
    "0x600780600b6000396000f3" + "63ffffffff5100";

/**
 * Creation code of a contract that, called with a word, stores it in
 * transient slot 0; called with or without one, it returns what transient
 * slot 0 holds.
 */
export const TRANSIENT_STORAGE_CONTRACT =
    "0x601780600b6000396000f3" +
    "3615600b57" +
    "6000356000" +
    "5d" +
    "5b6000" +
    "5c" +
    "60005260206000f3";

/** Creation code of a contract that returns BLOBBASEFEE as one word. */
export const BLOB_BASE_FEE_CONTRACT =
    "0x600780600b6000396000f3" + "4a5f5260205ff3";

/** Creation code of a contract that returns CALLER and ORIGIN, one word each. */
export const CALLER_AND_ORIGIN_CONTRACT =
    "0x600d80600b6000396000f3" + "336000523260205260406000f3";

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
 * A peer3 dev node of this test's own, serving the light client endpoints.
 * The node is the binary `PEER3_NODE_BIN` names.
 */
export class LightClientNodeFixture {
    /** Reads straight from the node. */
    readonly provider: JsonRpcProvider;
    /** The node this fixture started; undefined when it attached to one already running. */
    private readonly node: NodeHandle | undefined;
    /** Where the node serves its RPC. */
    readonly url: string;
    private readonly wallet: HDNodeWallet;
    private readonly sockets: JsonRpcSocket[] = [];
    private readonly proxies: RpcNodeProxy[] = [];
    /** The funded account's next nonce; several transactions can share a block. */
    private nextNonce = 0;

    private constructor(node: NodeHandle | undefined, url: string) {
        this.node = node;
        this.url = url;
        this.provider = new JsonRpcProvider(url, undefined, {
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
     * Starts the node. Throws {@link LIGHT_CLIENT_UNSUPPORTED} at once when no
     * peer3 node binary is named, because the Hardhat test node has no light
     * client endpoints. With `lightClient: false` the node runs without them,
     * a benchmark's baseline. `lightClientArgs` follow `--light-client`.
     */
    static async start({
        lightClient = true,
        lightClientArgs = [] as string[]
    } = {}): Promise<LightClientNodeFixture> {
        if (!process.env.PEER3_NODE_BIN)
            throw new Error(
                `${LIGHT_CLIENT_UNSUPPORTED}: PEER3_NODE_BIN names no peer3 node binary`
            );
        const node = await startPeer3Node({ lightClient, lightClientArgs });
        return new LightClientNodeFixture(node, node.url);
    }

    /**
     * Uses a peer3 dev node already running at `url`, which serves the light
     * client endpoints and funds the test chain's account; stop leaves it
     * running. For a benchmark whose node runs on another host.
     */
    static async attach(url: string): Promise<LightClientNodeFixture> {
        const fixture = new LightClientNodeFixture(undefined, url);
        // earlier runs sent from the same account
        fixture.nextNonce = await fixture.provider.getTransactionCount(
            fixture.senderAddress,
            "pending"
        );
        return fixture;
    }

    async stop(): Promise<void> {
        for (const socket of this.sockets) socket.close();
        for (const proxy of this.proxies) await proxy.close();
        this.provider.destroy();
        if (!this.node) return;
        this.node.stop();
        await this.node.exited;
    }

    /** A connection to the light client endpoints, after checking the node lists them. */
    async connect(): Promise<LightClientConnection> {
        const socket = await this.open(this.url);
        await assertLightClientEndpoints(socket);
        return new LightClientConnection(socket);
    }

    /** A proxy in front of the node, which the test makes answer in the node's place. */
    async proxyToNode(): Promise<RpcNodeProxy> {
        const proxy = await RpcNodeProxy.start(this.url);
        this.proxies.push(proxy);
        return proxy;
    }

    /** A socket to the node itself, which the fixture closes on stop. */
    connectToNode(): Promise<JsonRpcSocket> {
        return this.open(this.url);
    }

    /**
     * A socket to the node through a proxy of its own, which the test makes
     * answer in the node's place. The fixture closes both on stop.
     */
    async connectToNodeThroughProxy(): Promise<{
        proxy: RpcNodeProxy;
        socket: JsonRpcSocket;
    }> {
        const proxy = await this.proxyToNode();
        return { proxy, socket: await this.open(proxy.url) };
    }

    /**
     * Resolves once the node sealed its first block: the genesis header names
     * no Ethereum block, so no proven read can start from it.
     */
    /** The reader's best block, once the node's Ethereum RPC serves that block too. */
    async servedHead(reader: FrontierProvenStateReader): Promise<ProvenBlock> {
        const head = await reader.head();
        await waitFor(
            async () => (await this.provider.getBlock(head.number)) !== null
        );
        return head;
    }

    async firstBlockSealed(): Promise<void> {
        await waitFor(async () => (await this.provider.getBlockNumber()) > 0);
    }

    /** The node's process id, for reading its CPU and memory use. */
    get pid(): number {
        const pid = this.node?.proc.pid;
        if (pid === undefined)
            throw new Error("The node runs in no process of this fixture");
        return pid;
    }

    /** The account that sends this fixture's transactions. */
    get senderAddress(): string {
        return this.wallet.address;
    }

    /** Deploys a contract that stores what it is called with and logs the slot as its topic. */
    deployStoreAndLogContract(): Promise<string> {
        return this.deploy(STORE_AND_LOG_CONTRACT);
    }

    /** Deploys the contract `creationCode` creates, with `gasLimit` when given; its address. */
    async deploy(creationCode: string, gasLimit?: bigint): Promise<string> {
        const receipt = await this.mined({ data: creationCode, gasLimit });
        if (!receipt.contractAddress)
            throw new Error("The deployment created no contract");
        return receipt.contractAddress;
    }

    /**
     * Calls {@link PARTITION_CONTRACT} at `contract` in a transaction: stores
     * `sload(read) + add` at slot `write`, logged with `topic`.
     */
    readWriteLog(
        contract: string,
        topic: string,
        read: number,
        write: number,
        add: number
    ): Promise<TransactionReceipt> {
        return this.transact(contract, partitionWrite(topic, read, write, add));
    }

    /**
     * Calls `contract` with `data` in a transaction, with `gasLimit` when
     * given; the receipt of the included transaction.
     */
    transact(
        contract: string,
        data: string,
        gasLimit?: bigint
    ): Promise<TransactionReceipt> {
        return this.mined({ to: contract, data, gasLimit });
    }

    /**
     * Stores `value` at `slot` of `contract`, paying it `paid` wei; the
     * receipt of the included transaction.
     */
    store(
        contract: string,
        slot: string,
        value: string,
        paid?: bigint
    ): Promise<TransactionReceipt> {
        return this.mined({
            to: contract,
            data: concat([slot, value]),
            value: paid
        });
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

    /**
     * Sends `transaction` from the funded account through `provider`, with
     * the account's next nonce, without waiting for it; also the account as
     * a signer over `provider`.
     */
    async sendThrough(
        provider: Provider,
        transaction: { to: string; data: string; gasLimit: bigint }
    ): Promise<{ sent: TransactionResponse; signer: Signer }> {
        const signer = this.wallet.connect(provider);
        const sent = await signer.sendTransaction({
            ...transaction,
            ...TRANSACTION_FEES,
            nonce: this.nextNonce++
        });
        return { sent, signer };
    }

    private async open(url: string): Promise<JsonRpcSocket> {
        const socket = await JsonRpcSocket.open(url);
        this.sockets.push(socket);
        return socket;
    }

    private async mined(transaction: {
        to?: string;
        data: string;
        value?: bigint;
        gasLimit?: bigint;
    }): Promise<TransactionReceipt> {
        const sent = await this.wallet.sendTransaction({
            ...transaction,
            ...TRANSACTION_FEES,
            gasLimit: transaction.gasLimit ?? 1_000_000n,
            nonce: this.nextNonce++
        });
        const receipt = await sent.wait();
        if (receipt?.status !== 1)
            throw new Error(`Transaction ${sent.hash} did not succeed`);
        return receipt;
    }
}
