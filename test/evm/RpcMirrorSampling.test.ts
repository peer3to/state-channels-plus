import { sleep } from "@/utils";
import {
    deployMirroredStorage,
    nodeRequests,
    nodeStateReads,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex } from "ethers";

describe("MirrorRpcProvider sampling", function () {
    it("re-asks the node about a sampled read after replying, and keeps the account when the node agrees", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                await (await storage.setValue(5n)).wait();
                const held = session.node.holdReplies("eth_getStorageAt");

                const word = await Promise.race([
                    session.provider.getStorage(address, 0),
                    sleep(2_000).then(() => "the answer waited for the sample")
                ]);

                // the caller has its answer while the node's reply to the sample is still held
                expect(BigInt(word)).to.equal(5n);
                await waitFor(() => held.heldReplies() > 0, 5_000, 20);
                held.release();
                expect(nodeStateReads(session)).to.equal(1);

                // the next reads are sampled again and still answered by the copy
                expect(
                    BigInt(await session.provider.getStorage(address, 0))
                ).to.equal(5n);
                await waitFor(() => nodeStateReads(session) >= 2, 5_000, 20);
                expect(
                    BigInt(await session.provider.getStorage(address, 0))
                ).to.equal(5n);
                await waitFor(() => nodeStateReads(session) >= 3, 5_000, 20);
                // Mutation: a match treated as a mismatch drops the account,
                // and the third read then asks the node as well as sampling.
                expect(nodeStateReads(session)).to.equal(3);
            },
            { sampleRate: 1 }
        );
    });

    it("samples balance, nonce and code reads against the node too", async function () {
        await withMirrorSession(
            async (session) => {
                const { address } = await deployMirroredStorage(session);
                const owner = await session.signer.getAddress();

                await session.provider.getBalance(address);
                await session.provider.getCode(address);
                await session.provider.getTransactionCount(owner, "latest");
                await waitFor(
                    () =>
                        nodeRequests(session, "eth_getTransactionCount")
                            .length === 1,
                    5_000,
                    20
                );

                expect(nodeRequests(session, "eth_getBalance")).to.have.length(
                    1
                );
                expect(nodeRequests(session, "eth_getCode")).to.have.length(1);
            },
            { sampleRate: 1 }
        );
    });

    it("sends nothing to the node at a sample rate of 0", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                await (await storage.setValue(5n)).wait();

                await session.provider.getStorage(address, 0);
                await session.provider.getBalance(address);
                await storage.getValue();
                await sleep(300);

                expect(nodeStateReads(session)).to.equal(0);
                expect(nodeRequests(session, "eth_call")).to.have.length(0);
            },
            { sampleRate: 0 }
        );
    });

    it("samples a small fraction of local answers when the provider is built without a sample rate", async function () {
        await withMirrorSession(
            async (session) => {
                const { address } = await deployMirroredStorage(session);
                await session.provider.getBalance(address);
                const before = nodeRequests(session, "eth_getBalance").length;

                const reads = 2_000;
                for (let read = 0; read < reads; read++)
                    await session.provider.getBalance(address);
                await waitFor(
                    () =>
                        nodeRequests(session, "eth_getBalance").length > before,
                    5_000,
                    20
                );
                await sleep(300);

                // about one in a hundred (20 of 2,000 expected); always some, never most
                const sampled =
                    nodeRequests(session, "eth_getBalance").length - before;
                expect(sampled).to.be.greaterThan(0);
                expect(sampled).to.be.lessThan(reads / 10);
            },
            { sampleRate: undefined }
        );
    });

    it("counts a mismatch between a cached value and the node, and reads the account from the node from then on", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                // the service reads slot values wrongly, so its snapshot is wrong
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );
                await (await storage.setValue(5n)).wait();

                const wrong = await session.provider.getStorage(address, 0);
                // the mismatch drops the account: the read then comes from the node
                await waitFor(
                    async () =>
                        BigInt(
                            await session.provider.getStorage(address, 0)
                        ) === 5n,
                    5_000,
                    20
                );

                expect(BigInt(wrong)).to.equal(6n);
            },
            { sampleRate: 1 }
        );
    });

    it("checks a sampled eth_call against the node and drops the called account on a mismatch", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage } = await deployMirroredStorage(session);
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );
                await (await storage.setValue(5n)).wait();

                const wrong = await storage.getValue();
                // the mismatch drops the called account: the call then reads it from the node
                await waitFor(
                    async () => (await storage.getValue()) === 5n,
                    5_000,
                    20
                );

                expect(wrong).to.equal(6n);
            },
            { sampleRate: 1 }
        );
    });
});
