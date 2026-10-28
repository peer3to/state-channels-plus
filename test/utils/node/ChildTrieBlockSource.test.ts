import { reviveAccountInfoKey } from "@/utils/node/storageDiff/assetHubStateCheck";
import { ChainMovedError } from "@/utils/node/storageDiff/backfillBlocks/ABackfillBlockSource";
import { ChildTrieBlockSource } from "@/utils/node/storageDiff/backfillBlocks/ChildTrieBlockSource";
import { expect } from "chai";
import { WebSocketServer, type AddressInfo } from "ws";

/** The contract of the recorded mainnet `AccountInfoOf` value below. */
const ADDRESS = "0x99ee73298423dcf5da3059a5e48bda20bfbcd01b";
const RECORDED_INFO =
    "0x0080534cf48ba03bfd9aad907397c556b60630666df566b309489b078f1ea2462806df37580a5890e6391148efc9cbc03c58a4b737422ca66bb8a9ae1928f39bacb5406a0000a901000001e81fa200000000000000000000000001b5a3fa0100000000000000000000005084b5e80000000000000000000000000000000000000000";
const TIP = { number: 1_000_000n, hash: "0xeth" };

type ChainShape = {
    /** Blocks after which the contract's child trie root changed. */
    changes: number[];
    /** First block the contract exists at. */
    deployed: number;
    /** Block hash the node reports for the tip, per question. */
    tipHash: () => string;
    /** The account info the node holds; null for no account. */
    info: string | null;
};

/** A Substrate node that answers the reads of the bisection from a chain shape. */
async function withSubstrateNode<T>(
    shape: ChainShape,
    use: (url: string, reads: { roots: number }) => Promise<T>
): Promise<T> {
    const reads = { roots: 0 };
    const server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await new Promise((resolve) => server.once("listening", resolve));
    const answer = (method: string, params: unknown[]): unknown => {
        if (method === "chain_getBlockHash") {
            const number = params[0] as number;
            return number === Number(TIP.number)
                ? shape.tipHash()
                : "0xblock" + number;
        }
        if (method === "state_getStorage") {
            if (params[0] === reviveAccountInfoKey(ADDRESS)) return shape.info;
            reads.roots++;
            const number = Number(String(params[1]).slice("0xblock".length));
            if (params[1] === shape.tipHash() || params[1] === "0xtip")
                return "0xroot" + shape.changes.length;
            if (number < shape.deployed) return null;
            return "0xroot" + shape.changes.filter((c) => c <= number).length;
        }
        throw new Error("Unexpected " + method);
    };
    server.on("connection", (socket) =>
        socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString());
            const reply = (call: {
                id: number;
                method: string;
                params: unknown[];
            }) => ({
                jsonrpc: "2.0",
                id: call.id,
                result: answer(call.method, call.params)
            });
            socket.send(
                JSON.stringify(
                    Array.isArray(parsed) ? parsed.map(reply) : reply(parsed)
                )
            );
        })
    );
    try {
        const { port } = server.address() as AddressInfo;
        return await use(`ws://127.0.0.1:${port}`, reads);
    } finally {
        for (const client of server.clients) client.terminate();
        await new Promise((resolve) => server.close(resolve));
    }
}

const NO_UPSTREAM = {
    request: () => Promise.reject(new Error("The eth upstream is not used")),
    requestBatch: () => []
};

describe("ChildTrieBlockSource", function () {
    it("lists the blocks that changed the contract, reading far fewer roots than blocks", async function () {
        const changes = [400, 401, 500_000, 999_999];
        await withSubstrateNode(
            {
                changes,
                deployed: 400,
                tipHash: () => "0xtip",
                info: RECORDED_INFO
            },
            async (url, reads) => {
                const source = new ChildTrieBlockSource(url);
                try {
                    const listing = await source.listBlocks(
                        NO_UPSTREAM,
                        ADDRESS,
                        400n,
                        TIP
                    );

                    expect(listing.numbers).to.deep.equal(changes.map(BigInt));
                    expect(listing.blocks).to.equal(999_601);
                    expect(listing.blockReads).to.equal(0);
                    expect(listing.rootReads).to.equal(reads.roots);
                    expect(listing.rootReads).to.be.lessThan(200);
                } finally {
                    source.close();
                }
            }
        );
    });

    it("lists nothing for a range in which the contract did not change", async function () {
        await withSubstrateNode(
            {
                changes: [10],
                deployed: 10,
                tipHash: () => "0xtip",
                info: RECORDED_INFO
            },
            async (url) => {
                const source = new ChildTrieBlockSource(url);
                try {
                    const listing = await source.listBlocks(
                        NO_UPSTREAM,
                        ADDRESS,
                        11n,
                        TIP
                    );
                    expect(listing.numbers).to.deep.equal([]);
                } finally {
                    source.close();
                }
            }
        );
    });

    it("fails with a chain move when the tip block changed during the bisection", async function () {
        let asked = 0;
        await withSubstrateNode(
            {
                changes: [500],
                deployed: 500,
                tipHash: () => (asked++ < 1 ? "0xtip" : "0xother"),
                info: RECORDED_INFO
            },
            async (url) => {
                const source = new ChildTrieBlockSource(url);
                try {
                    const error = await source
                        .listBlocks(NO_UPSTREAM, ADDRESS, 500n, TIP)
                        .then(
                            () => undefined,
                            (reason: unknown) => reason
                        );
                    expect(error).to.be.instanceOf(ChainMovedError);
                } finally {
                    source.close();
                }
            }
        );
    });

    it("fails for an address that is not a contract", async function () {
        await withSubstrateNode(
            { changes: [], deployed: 0, tipHash: () => "0xtip", info: null },
            async (url) => {
                const source = new ChildTrieBlockSource(url);
                try {
                    const error = await source
                        .listBlocks(NO_UPSTREAM, ADDRESS, 1n, TIP)
                        .then(
                            () => undefined,
                            (reason: unknown) => reason
                        );
                    expect((error as Error).message).to.equal(
                        "The address is not a contract"
                    );
                } finally {
                    source.close();
                }
            }
        );
    });
});
