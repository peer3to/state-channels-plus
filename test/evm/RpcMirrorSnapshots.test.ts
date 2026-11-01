import { sleep } from "@/utils";
import { SDK_RPC_DEADLINE_MS } from "@/utils/storageDiff/LearnedBackstop";
import {
    backfillAtService,
    deployMirroredStorage,
    headNumber,
    nodeRequests,
    nodeStateReads,
    serviceRequests,
    waitUntilAnsweredLocally,
    withMirrorSession,
    withSubstrateMirrorSession
} from "@test/fixtures/node/RpcMirrorFixture";
import {
    asksCallFrames,
    deploySlotWriter,
    writeSlot
} from "@test/fixtures/node/StorageDiffService.fixture";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ZeroHash } from "ethers";

describe("MirrorRpcProvider snapshots", function () {
    it("applies a snapshot that reaches the mirror before the reply of the subscription that asked for it", async function () {
        await withMirrorSession(async (session) => {
            // the mirror follows the first contract before the second is deployed
            const first = await deployMirroredStorage(session);
            await first.storage.getValue();
            const second = await deployMirroredStorage(session);
            await (await second.storage.setValue(5n)).wait();
            await backfillAtService(session, [second.address]);
            const asked = serviceRequests(session, "scp_getState").length;
            const held = session.service.holdReplies(
                "scp_subscribeContractStorage"
            );

            const read = session.provider.getStorage(second.address, 0);
            // the snapshot is pushed while the subscribe reply is held back
            await waitFor(() => held.heldReplies() > 0, 5_000, 20);
            await sleep(500);
            held.release();

            expect(BigInt(await read)).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                asked
            );
        });
    });

    it("waits for the snapshot of an account the service has ready instead of reading lazily", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await backfillAtService(session, [address]);
            const release = session.service.holdNotifications("scp_snapshot");

            const read = session.provider.getStorage(address, 0);
            await sleep(300);
            release();
            const word = await read;

            expect(BigInt(word)).to.equal(5n);
            // Mutation: not awaiting the snapshot (reading lazily) asks the service
            expect(serviceRequests(session, "scp_getState")).to.have.length(0);
            expect(nodeStateReads(session)).to.equal(0);
        });
    });

    it("reads an account the service says is syncing at once, and answers locally once its snapshot has come", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            const release = session.service.holdNotifications("scp_snapshot");

            const word = await session.provider.getStorage(address, 0);

            // answered while the snapshot is held back: one state request
            expect(BigInt(word)).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(1);
            release();
            await waitUntilAnsweredLocally(session, address);
            // the code and the slot are local now: a contract call needs no lazy read
            const asked = serviceRequests(session, "scp_getState").length;
            expect(await storage.getValue()).to.equal(5n);
            expect(serviceRequests(session, "scp_getState")).to.have.length(
                asked
            );
        });
    });

    it("reads an account the service says is lazy at once, without waiting for a snapshot", async function () {
        // the node counts one entry more than the history names
        await withSubstrateMirrorSession(2, async (session, contract) => {
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            contract.address = address.toLowerCase();
            contract.deployed = await session.chain.getBlockNumber();
            await (await chainStorage.setValue(5n)).wait();
            contract.changes.push(contract.deployed, contract.deployed + 1);
            await backfillAtService(session, [address]);
            // the notice is held back: the subscribe answer alone says lazy
            const release = session.service.holdNotifications("scp_snapshot");

            const word = await session.provider.getStorage(address, 0);
            release();

            // answered while the snapshot is held back, and no backstop ran out
            expect(BigInt(word)).to.equal(5n);
            // Mutation: entries 1 (the history's count) makes the account
            // complete, so the read comes from the snapshot, not the service.
            expect(serviceRequests(session, "scp_getState")).to.have.length(1);
        });
    });

    it("keeps an account lazy when the backfill of a syncing account ends without a snapshot", async function () {
        // the node counts one entry more than the history names
        await withSubstrateMirrorSession(2, async (session, contract) => {
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            contract.address = address.toLowerCase();
            contract.deployed = await session.chain.getBlockNumber();
            await (await chainStorage.setValue(5n)).wait();
            contract.changes.push(contract.deployed, contract.deployed + 1);

            const word = await session.provider.getStorage(address, 0);
            // the notice that no snapshot is coming
            await waitFor(
                () => session.service.deliveredCount("scp_snapshot") === 1,
                5_000,
                20
            );

            expect(BigInt(word)).to.equal(5n);
            // still lazy: a slot the mirror has not read is asked for
            expect(await session.provider.getStorage(address, 1)).to.equal(
                ZeroHash
            );
            // Mutation: entries 1 (the history's count) makes the account
            // complete, so no read asks the service.
            expect(serviceRequests(session, "scp_getState")).to.have.length(2);
        });
    });

    it("keeps an account lazy when the backfill of a syncing account fails", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            // the service has staged the blocks; the backfill's own reads fail
            await sleep(500);
            session.relay.failNext("eth_getBlockByNumber", 50);

            const word = await session.provider.getStorage(address, 0);
            // the notice that no snapshot is coming (Mutation: a service that sends no
            // notice after a failed backfill never delivers it, and this wait times out)
            await waitFor(
                () => session.service.deliveredCount("scp_snapshot") === 1,
                10_000,
                20
            );

            expect(BigInt(word)).to.equal(5n);
            // still lazy: a slot the mirror has not read is asked for
            expect(await session.provider.getStorage(address, 1)).to.equal(
                ZeroHash
            );
            // Mutation: a snapshot applied after the failed backfill would
            // answer the second read locally.
            expect(serviceRequests(session, "scp_getState")).to.have.length(2);
        });
    });

    it("asks the node, after a backstop learned from snapshot arrivals, for a snapshot the service has ready and never delivers", async function () {
        await withMirrorSession(async (session) => {
            const { address: taught } = await deployMirroredStorage(session);
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(3n)).wait();
            await backfillAtService(session, [taught, address]);
            // a snapshot that arrives teaches how long snapshots take
            await session.provider.getStorage(taught, 0);
            session.service.dropNotifications("scp_snapshot");

            const started = Date.now();
            const word = await session.provider.getStorage(address, 0);
            const elapsed = Date.now() - started;

            expect(BigInt(word)).to.equal(3n);
            // Mutation: a snapshot backstop that stays at its cap makes the
            // read wait past this bound.
            expect(elapsed).to.be.lessThan(SDK_RPC_DEADLINE_MS / 2);
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(1);
        });
    });

    it("does not shorten the wait for a snapshot because blocks arrived fast", async function () {
        await withMirrorSession(async (session) => {
            const { chainStorage, address } =
                await deployMirroredStorage(session);
            await (await chainStorage.setValue(5n)).wait();
            await backfillAtService(session, [address]);
            // an account the service is still backfilling is read lazily: the
            // mirror follows, and its snapshot is held back so it teaches nothing
            const { address: warm } = await deployMirroredStorage(session);
            const releaseWarm =
                session.service.holdNotifications("scp_snapshot");
            await session.provider.getStorage(warm, 0);
            await session.provider.on("block", () => undefined);
            for (let value = 1n; value <= 3n; value++)
                await (await chainStorage.setValue(value)).wait();
            releaseWarm();
            const release = session.service.holdNotifications("scp_snapshot");

            const read = session.provider.getStorage(address, 0);
            // time is the input: longer than the bound the blocks taught, shorter than the snapshot cap
            await sleep(SDK_RPC_DEADLINE_MS * 0.6);
            release();
            const word = await read;

            // the last value the loop above wrote
            expect(BigInt(word)).to.equal(3n);
            // Mutation: a snapshot backstop learned from block arrivals sends
            // the read to the node before the snapshot is released.
            expect(nodeRequests(session, "eth_getStorageAt")).to.have.length(0);
        });
    });

    it("stops waiting for a snapshot at once when the service connection drops", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            await backfillAtService(session, [address]);
            session.service.dropNotifications("scp_snapshot");

            const started = Date.now();
            const read = session.provider.getStorage(address, 0);
            await sleep(300);
            session.service.cut();
            const word = await read;

            // the node answers when the cut ends the wait, not the backstop
            expect(BigInt(word)).to.equal(5n);
            // Mutation: a cut that leaves the wait to the backstop (the cap,
            // no snapshot having arrived) takes the whole cap.
            expect(Date.now() - started).to.be.lessThan(
                SDK_RPC_DEADLINE_MS / 2
            );
        });
    });

    it("drops a complete account to lazy reads when the service finds its cached entries short after a block, and reads the omitted slot", async function () {
        let omitFrom = Number.MAX_SAFE_INTEGER;
        await withSubstrateMirrorSession(
            (n) => (n >= omitFrom ? 3 : 2),
            async (session, contract) => {
                const writer = await deploySlotWriter(session.signer);
                contract.address = writer;
                const deployed = await session.chain.getBlockNumber();
                contract.deployed = deployed;
                await writeSlot(session.signer, writer, 1, 5n);
                await writeSlot(session.signer, writer, 2, 7n);
                contract.changes.push(deployed, deployed + 1, deployed + 2);
                // the service has the account complete: the mirror takes its snapshot
                await backfillAtService(session, [writer]);
                expect(
                    BigInt(await session.provider.getStorage(writer, 1))
                ).to.equal(5n);

                // the next block's trace lists the account but not the slot it wrote
                omitFrom = deployed + 3;
                session.relay.tamper(
                    "debug_traceBlockByNumber",
                    (result, params) =>
                        asksCallFrames(params)
                            ? result
                            : (
                                  result as {
                                      result: {
                                          pre: object;
                                          post: Record<string, object>;
                                      };
                                  }[]
                              ).map((entry) => ({
                                  ...entry,
                                  result: {
                                      pre: entry.result.pre,
                                      post: {
                                          ...entry.result.post,
                                          [writer]: { storage: {} }
                                      }
                                  }
                              }))
                );
                await writeSlot(session.signer, writer, 3, 9n);
                // a complete cache would answer zero for the slot the trace left out
                await waitFor(
                    async () =>
                        BigInt(await session.provider.getStorage(writer, 3)) ===
                        9n,
                    5_000,
                    20
                );
            }
        );
    });

    it("asks the service for exactly the missing fields, at the head block, for an account that is syncing", async function () {
        await withMirrorSession(async (session) => {
            const { storage, address } = await deployMirroredStorage(session);
            await (await storage.setValue(5n)).wait();
            // the snapshot is held back, so the read has to ask for the field
            const release = session.service.holdNotifications("scp_snapshot");
            const head = await session.chain.getBlock(
                await headNumber(session)
            );

            const word = await session.provider.getStorage(address, 0);
            release();

            expect(BigInt(word)).to.equal(5n);
            expect(
                serviceRequests(session, "scp_getState").map(
                    (request) => request.params
                )
            ).to.deep.equal([
                [
                    head!.hash,
                    [
                        {
                            address: address.toLowerCase(),
                            slots: [ZeroHash],
                            account: false,
                            code: false
                        }
                    ]
                ]
            ]);
            expect(nodeStateReads(session)).to.equal(0);
        });
    });
});
