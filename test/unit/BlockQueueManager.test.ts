import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id } from "ethers";

// a copy committed on chain carries onChainTimestamp, so the queue judges it
// with the calldata strategy: the participant strategy plus the chain-only
// deviations. Both tests read that routing off its two observable effects.

describe("Unit: BlockQueueManager", function () {
    describe("posted calldata keeps its strategy through the queue", function () {
        it("a queued copy that merged a gossip copy → the gossip source is cut and a forced check is requested", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const writerAddress = await h
                .control(observer)
                .query.getNextToWrite()
                .request();
            const writer = h.peers.find((p) => p.address === writerAddress)!;
            const colluder = h.peers.find(
                (p) => p.index !== observer.index && p.index !== writer.index
            )!;
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index, {
                suppressPrefix: "timeoutParticipant"
            });
            // park the queue drain so both copies pool into one entry
            const held = await h.rpcStub.holdScheduledTasks(
                observer.index,
                "BlockQueueManager.tryExecuteFromQueue"
            );
            try {
                const { encodedSignedBlock } =
                    await h.byzantine.postJunkCalldataOnChain(writer.index, {
                        height: 2,
                        authentic: true,
                        previousBlockHash: id("not the head") as Hash
                    });
                await waitFor(
                    async () =>
                        (await h
                            .control(observer)
                            .query.getBlockCalldataTimestamp(
                                forkId,
                                2,
                                writer.address
                            )
                            .request()) !== null,
                    h.event.protocolEventTimeoutMs()
                );
                // the same block, now as a gossip copy from another peer
                await h
                    .control(observer)
                    .transition.ingestBlockConfirmation(
                        Codec.encode(
                            {
                                signedBlock: Codec.decode(
                                    encodedSignedBlock,
                                    Type.SignedBlock
                                ),
                                signatures: []
                            },
                            Type.BlockConfirmation
                        ) as string,
                        { senderAddress: colluder.address }
                    )
                    .request();
                await held.release(true);

                // calldata behaviour: the unlinked rejection asks for the check
                await waitFor(
                    async () =>
                        (await tasks.tasks()).some(
                            (task) =>
                                task.taskName ===
                                `timeoutParticipantAfterPostedBlockRejected - fork ${forkId} - block 2 - participant ${writer.address}`
                        ),
                    h.event.hostExecTimeoutMs()
                );
                // participant behaviour: the merged gossip source is cut
                await waitFor(
                    async () =>
                        await h.execOnHost(
                            observer,
                            (sm, args) =>
                                sm.p2pManager.isBlacklisted(args.colluder),
                            { colluder: colluder.address }
                        ),
                    h.event.hostExecTimeoutMs()
                );
            } finally {
                await held.release(false);
                await tasks.restore();
            }
        });

        it("posted calldata queued above the next height → restored, then judged as calldata once its height is next", async function () {
            const h = TestSession.getHarness();
            // the entry has to stay queued while the intermediate block is
            // authored, and the queue window is agreementTime
            await h.lifecycle.start(3, 2, {
                timeConfig: {
                    p2pTime: 2,
                    agreementTime: 12,
                    chainFallbackTime: 3,
                    evidenceTime: 6
                }
            });
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const author = h.getPeer(2);
            const tasks = await h.rpcStub.recordScheduledTasks(observer.index, {
                suppressPrefix: "timeoutParticipant"
            });
            const requested = async () =>
                (await tasks.tasks()).filter((task) =>
                    task.taskName.startsWith(
                        "timeoutParticipantAfterPostedBlockRejected"
                    )
                );
            try {
                await h.byzantine.postJunkCalldataOnChain(author.index, {
                    height: 3,
                    authentic: true,
                    previousBlockHash: id("not the head") as Hash
                });
                await waitFor(
                    async () =>
                        (await h
                            .control(observer)
                            .query.getBlockCalldataTimestamp(
                                forkId,
                                3,
                                author.address
                            )
                            .request()) !== null,
                    h.event.protocolEventTimeoutMs()
                );
                // above the next height: queued, not judged
                expect(await requested()).to.deep.equal([]);

                await h.transition.advanceState({ count: 1 });
                await waitFor(
                    async () =>
                        (await requested()).some(
                            (task) =>
                                task.taskName ===
                                `timeoutParticipantAfterPostedBlockRejected - fork ${forkId} - block 3 - participant ${author.address}`
                        ),
                    h.event.hostExecTimeoutMs()
                );
            } finally {
                await tasks.restore();
            }
        });
    });
});
