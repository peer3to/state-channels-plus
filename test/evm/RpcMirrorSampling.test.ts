import { sleep } from "@/utils";
import {
    deployMirroredStorage,
    callerRuntime,
    mismatchLog,
    nodeRequests,
    nodeStateReads,
    withMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import { deployRuntimeCode } from "@test/fixtures/node/StorageDiffContracts";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { toBeHex, ZeroHash } from "ethers";

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

    it("reads the account from the node from then on after a mismatch between a cached value and the node", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                // the service reads slot values wrongly, so its snapshot is wrong
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );
                await (await storage.setValue(5n)).wait();
                const head = (await session.chain.getBlock("latest"))!;

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
                // Mutation: the mismatch is not logged, or its log carries a value.
                const logged = mismatchLog(session);
                expect(logged).to.include({
                    method: "eth_getStorageAt",
                    blockHash: head.hash,
                    account: address.toLowerCase()
                });
                expect(BigInt(String(logged?.slot))).to.equal(0n);
                expect(JSON.stringify(logged)).to.not.include(
                    toBeHex(5n, 32).slice(2)
                );
                expect(JSON.stringify(logged)).to.not.include(
                    toBeHex(6n, 32).slice(2)
                );
            },
            { sampleRate: 1 }
        );
    });

    // Mutation: a block's record or a snapshot puts the feed's values back for a dropped account.
    it("keeps reading a dropped account from the node after a block writes it and after the service connection comes back", async function () {
        await withMirrorSession(
            async (session) => {
                const { storage, address } =
                    await deployMirroredStorage(session);
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );
                await (await storage.setValue(5n)).wait();
                await session.provider.getStorage(address, 0);
                await waitFor(
                    async () =>
                        BigInt(
                            await session.provider.getStorage(address, 0)
                        ) === 5n,
                    5_000,
                    20
                );
                // reads of the dropped account by block number; samples name a block hash
                const nodeReads = (slot: bigint) =>
                    nodeRequests(session, "eth_getStorageAt").filter(
                        (request) => {
                            const [, asked, block] =
                                request.params as unknown[];
                            return (
                                typeof block === "string" &&
                                BigInt(String(asked)) === slot
                            );
                        }
                    ).length;

                await (await storage.setValue(7n)).wait();
                const beforeWrite = nodeReads(0n);
                expect(
                    BigInt(await session.provider.getStorage(address, 0))
                ).to.equal(7n);
                expect(nodeReads(0n)).to.be.greaterThan(beforeWrite);

                session.service.cut();
                session.service.restore();
                // the first read follows again; its snapshot comes after it
                await session.provider.getStorage(address, 9);
                await sleep(300);
                const beforeSlot = nodeReads(10n);
                expect(await session.provider.getStorage(address, 10)).to.equal(
                    ZeroHash
                );
                expect(nodeReads(10n)).to.be.greaterThan(beforeSlot);
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
                // Mutation: the call's mismatch log lacks its selector, or carries a value.
                const logged = mismatchLog(session);
                expect(logged?.functionSelector).to.equal(
                    storage.interface.getFunction("getValue")!.selector
                );
                expect(JSON.stringify(logged)).to.not.include(
                    toBeHex(5n, 32).slice(2)
                );
                expect(JSON.stringify(logged)).to.not.include(
                    toBeHex(6n, 32).slice(2)
                );
            },
            { sampleRate: 1 }
        );
    });

    // Mutation: a node revert counts as no answer -> the sample is skipped
    // and the call keeps returning locally.
    it("drops the called account when the node reverts a call the mirror returned", async function () {
        await withMirrorSession(
            async (session) => {
                // reverts while slot 0 holds 5; a call with data stores its first word in slot 0
                const guard = await deployRuntimeCode(
                    session.signer,
                    "36601857" + // JUMPI to the store when there is calldata
                        "600054600514601257" + // JUMPI to the revert when slot 0 is 5
                        "60006000f3" + // RETURN nothing
                        "5b60006000fd" + // REVERT
                        "5b6000356000" +
                        "5500" // SSTORE(0, calldata word) STOP
                );
                await (
                    await session.signer.sendTransaction({
                        to: guard,
                        data: toBeHex(5n, 32)
                    })
                ).wait();
                // the service reads slot values wrongly: the copy holds 6
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );
                const call = () =>
                    session.provider.send("eth_call", [
                        { to: guard.toLowerCase(), data: "0x" },
                        "latest"
                    ]);

                const local = await call();
                // the mismatch drops the account: the call then sees the node's 5 and reverts
                await waitFor(
                    async () =>
                        (await call().then(
                            () => false,
                            () => true
                        )) === true,
                    5_000,
                    20
                );

                expect(local).to.equal("0x");
                expect(mismatchLog(session)).to.include({
                    method: "eth_call",
                    account: guard.toLowerCase()
                });
            },
            { sampleRate: 1 }
        );
    });

    // Mutation: a mismatch drops only the called account -> the callee's
    // wrong slot stays cached.
    it("drops every account a sampled call used when the node answers differently, the callee's too", async function () {
        await withMirrorSession(
            async (session) => {
                // reverts while slot 0 holds 5; a call with data stores its first word in slot 0
                const guard = await deployRuntimeCode(
                    session.signer,
                    "36601857" +
                        "600054600514601257" +
                        "60006000f3" +
                        "5b60006000fd" +
                        "5b6000356000" +
                        "5500"
                );
                await (
                    await session.signer.sendTransaction({
                        to: guard,
                        data: toBeHex(5n, 32)
                    })
                ).wait();
                // returns whether its call to the guard succeeded
                const caller = await deployRuntimeCode(
                    session.signer,
                    callerRuntime(guard)
                );
                // the service reads slot values wrongly: the copy holds 6
                session.relay.tamper("eth_getStorageAt", (result) =>
                    toBeHex(BigInt(result as string) + 1n, 32)
                );

                const call = async () =>
                    BigInt(
                        await session.provider.send("eth_call", [
                            { to: caller.toLowerCase(), data: "0x" },
                            "latest"
                        ])
                    );

                const local = await call();
                // the mismatch drops the guard as well: the call then sees the node's 5, and the guard reverts
                await waitFor(async () => (await call()) === 0n, 5_000, 20);

                expect(local).to.equal(1n);
            },
            { sampleRate: 1 }
        );
    });
});
