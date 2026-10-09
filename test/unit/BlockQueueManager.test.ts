import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { BlockConfirmationEthersType } from "@/types/ethers";
import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { assertDeployedMaximum } from "@test/fixtures/QueueDeploymentFixture";
import {
    assertStoredTipCopyDrainsNextBlock,
    scheduleForkRecoveryAroundStop,
    stopWithHeldForkRecovery,
    stopWithRejectedAndPendingProbes
} from "@test/fixtures/QueueDrainStaging";
import {
    QueueIntakeFixture,
    receiveWithExplicitStrategy
} from "@test/fixtures/QueueIntakeFixture";
import { assertOutsiderProofDoesNotAdmitCopy } from "@test/fixtures/QueueNetworkRetentionFixture";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id } from "ethers";

// a copy committed on chain carries onChainTimestamp, so the queue judges it
// with the calldata strategy: the participant strategy plus the chain-only
// deviations. Both tests read that routing off its two observable effects.

describe("Unit: BlockQueueManager", () => {
    it("stopping the manager clears a future queued block and cancels its timeout", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        const result = await f.h.execOnHost(
            f.h.getPeer(0),
            async (sm, args, { ethers }) => {
                const schedule = sm.timeoutManager.scheduleTask.bind(
                    sm.timeoutManager
                );
                const cancel = sm.timeoutManager.cancelTask.bind(
                    sm.timeoutManager
                );
                const handles = new Set<ReturnType<typeof setTimeout>>();
                let cancelled = 0;
                sm.timeoutManager.scheduleTask = (task, delay, name) => {
                    const handle = schedule(task, delay, name);
                    if (name?.startsWith("BlockQueueManager.queueTimeout -"))
                        handles.add(handle);
                    return handle;
                };
                sm.timeoutManager.cancelTask = (handle) => {
                    if (handles.delete(handle)) cancelled++;
                    cancel(handle);
                };
                try {
                    const block = ethers.AbiCoder.defaultAbiCoder().decode(
                        [args.blockType],
                        args.encodedBlockConfirmation
                    )[0];
                    await sm.blockQueueManager.ingestBlockConfirmation(block, {
                        origin: args.origin,
                        senderAddress: args.source
                    });
                    const queuedBefore = !!sm.storage.queues.getQueuedEntry(
                        args.hash
                    );
                    const armedBefore = handles.size;
                    await sm.stop();
                    return {
                        queuedBefore,
                        armedBefore,
                        queuedAfter: !!sm.storage.queues.getQueuedEntry(
                            args.hash
                        ),
                        armedAfter: handles.size,
                        cancelled
                    };
                } finally {
                    sm.timeoutManager.scheduleTask = schedule;
                    sm.timeoutManager.cancelTask = cancel;
                }
            },
            {
                blockType: BlockConfirmationEthersType,
                encodedBlockConfirmation: f.encodedBlockConfirmation,
                origin: BlockOrigin.NETWORK as const,
                source: f.h.getPeer(1).address,
                hash: f.block.hash
            }
        );
        expect(result).to.deep.equal({
            queuedBefore: true,
            armedBefore: 1,
            queuedAfter: false,
            armedAfter: 0,
            cancelled: 1
        });
    });

    it("stop waits for a source probe held in flight at its sync", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        const result = await f.h.execOnHost(
            f.h.getPeer(0),
            async (sm, args, { ethers }) => {
                const spectate = sm.p2pManager.localRpc.spectateService;
                const sync = spectate.sync;
                let release!: () => void;
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                let entered!: () => void;
                const held = new Promise<void>((resolve) => {
                    entered = resolve;
                });
                let synced = false;
                const queue = sm.blockQueueManager;
                const dispose = queue.dispose;
                let drainEntered!: () => void;
                const draining = new Promise<void>((resolve) => {
                    drainEntered = resolve;
                });
                queue.dispose = () => {
                    drainEntered();
                    return dispose.call(queue);
                };
                spectate.sync = async (...parameters) => {
                    entered();
                    await gate;
                    try {
                        return await sync.apply(spectate, parameters);
                    } finally {
                        synced = true;
                    }
                };
                try {
                    const block = ethers.AbiCoder.defaultAbiCoder().decode(
                        [args.blockType],
                        args.encodedBlockConfirmation
                    )[0];
                    await sm.blockQueueManager.ingestBlockConfirmation(block, {
                        origin: args.origin,
                        senderAddress: args.source
                    });
                    // the real queue timeout probes the future block's source
                    await held;
                    let stopped = false;
                    let syncedWhenStopped = false;
                    const stopping = sm.stop().then(() => {
                        stopped = true;
                        syncedWhenStopped = synced;
                    });
                    // stop reached the drain while the probe is held
                    await draining;
                    const stoppedWhileHeld = stopped;
                    release();
                    await stopping;
                    return { stoppedWhileHeld, syncedWhenStopped };
                } finally {
                    release();
                    spectate.sync = sync;
                    queue.dispose = dispose;
                }
            },
            {
                blockType: BlockConfirmationEthersType,
                encodedBlockConfirmation: f.encodedBlockConfirmation,
                origin: BlockOrigin.NETWORK as const,
                source: f.h.getPeer(1).address
            }
        );
        expect(result).to.deep.equal({
            stoppedWhileHeld: false,
            syncedWhenStopped: true
        });
    });

    it("stop drains a pending probe after another fails, clears the queue, then rejects with the failure", async () => {
        expect(await stopWithRejectedAndPendingProbes()).to.deep.equal({
            jobs: 2,
            afterFailure: {
                stopped: false,
                inFlight: 1,
                timeoutManagerDisposed: false
            },
            stopError: "probe failed",
            afterStop: {
                inFlight: 0,
                queued: [false, false],
                recoveryScheduled: 0,
                recoverySuppressed: 0,
                timeoutManagerDisposed: true
            }
        });
    });

    it("stop waits for a fork recovery held in flight, then clears the recovery state", async () => {
        expect(
            await stopWithHeldForkRecovery(MathTestSession.getHarness())
        ).to.deep.equal({
            recoveries: 1,
            whileHeld: {
                onSourceFork: true,
                stopped: false,
                inFlight: 1,
                recoveryScheduled: true,
                timeoutManagerDisposed: false
            },
            afterStop: {
                inFlight: 0,
                recoveryScheduled: 0,
                timeoutManagerDisposed: true
            }
        });
    });

    it("a fork recovery scheduled or firing after stop began never runs", async () => {
        expect(await scheduleForkRecoveryAroundStop()).to.deep.equal({
            scheduledBeforeStop: 1,
            scheduledAfterStop: 0,
            inFlight: 0,
            entered: 0
        });
    });

    it("a queue timeout firing after stop began starts no source probe", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        const result = await f.h.execOnHost(
            f.h.getPeer(0),
            async (sm, args, { ethers }) => {
                const spectate = sm.p2pManager.localRpc.spectateService;
                const sync = spectate.sync;
                let syncCalls = 0;
                spectate.sync = (...parameters) => {
                    syncCalls++;
                    return sync.apply(spectate, parameters);
                };
                const schedule = sm.timeoutManager.scheduleTask.bind(
                    sm.timeoutManager
                );
                let fired!: () => void;
                const timeoutFired = new Promise<void>((resolve) => {
                    fired = resolve;
                });
                sm.timeoutManager.scheduleTask = (task, delay, name) =>
                    schedule(
                        name?.startsWith("BlockQueueManager.queueTimeout -")
                            ? async () => {
                                  await task();
                                  fired();
                              }
                            : task,
                        delay,
                        name
                    );
                // stop() parks on the custom RPC disposal, after it set
                // isDisposed and before the block queue disposes
                const localRpc = sm.p2pManager.localRpc;
                const disposeLocalRpc = localRpc.dispose;
                let release!: () => void;
                const gate = new Promise<void>((resolve) => {
                    release = resolve;
                });
                localRpc.dispose = async () => {
                    await gate;
                    return disposeLocalRpc.call(localRpc);
                };
                try {
                    const block = ethers.AbiCoder.defaultAbiCoder().decode(
                        [args.blockType],
                        args.encodedBlockConfirmation
                    )[0];
                    await sm.blockQueueManager.ingestBlockConfirmation(block, {
                        origin: args.origin,
                        senderAddress: args.source
                    });
                    const stopping = sm.stop();
                    await timeoutFired;
                    release();
                    await stopping;
                    return { isDisposed: sm.isDisposed, syncCalls };
                } finally {
                    release();
                    spectate.sync = sync;
                    sm.timeoutManager.scheduleTask = schedule;
                    localRpc.dispose = disposeLocalRpc;
                }
            },
            {
                blockType: BlockConfirmationEthersType,
                encodedBlockConfirmation: f.encodedBlockConfirmation,
                origin: BlockOrigin.NETWORK as const,
                source: f.h.getPeer(1).address
            }
        );
        expect(result).to.deep.equal({ isDisposed: true, syncCalls: 0 });
    });

    it("a drain that dequeues a stored copy still drains the queued next block", async () => {
        await assertStoredTipCopyDrainsNextBlock(
            MathTestSession.getHarness(),
            "ingested"
        );
    });

    it("sync succeeds but the sender is still absent: blacklisted with no queue entry", async () => {
        await assertOutsiderProofDoesNotAdmitCopy("success");
    });

    it("an oversized verified eligibility cache does not expand the N-source allowance", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        try {
            const eligible = await f.h.execOnHost(
                f.h.getPeer(0),
                (sm, { sources }) => {
                    sm.membershipService.publishOffChainEligibility(sources);
                    return sources.map((source) =>
                        sm.membershipService.getCachedSourceEligibility(source)
                    );
                },
                { sources: f.strangers }
            );
            expect(eligible).to.deep.equal([
                SourceEligibility.ELIGIBLE,
                SourceEligibility.ELIGIBLE,
                SourceEligibility.ELIGIBLE
            ]);
            await f.receive(f.strangers[0]);
            await f.receive(f.strangers[1]);
            const before = await f.retention();
            await f.receive(f.strangers[2]);
            expect(before?.sourceCount).to.equal(2);
            expect(await f.retention()).to.deep.equal(before);
            expect((await f.observation()).chainReads).to.equal(0);
            expect((await f.observation()).syncRequests).to.equal(0);
            expect(
                await f.control.query.isBlacklisted(f.strangers[2]).request()
            ).to.equal(false);
        } finally {
            await f.close();
        }
    });

    it("an explicit validation strategy stays outside the queued storage clone boundary", async () => {
        const result = await receiveWithExplicitStrategy(false);
        expect(result.accepted).to.equal(true);
        expect(result.queued).not.to.equal(null);
    });
    it("an explicit validation strategy stays outside the stored-copy storage clone boundary", async () => {
        const result = await receiveWithExplicitStrategy(true);
        expect(result.accepted).to.equal(true);
        expect(result.storedHeight).to.equal(1);
    });

    it("deployment cache separates a small maximum from default and reuses the small deployment", async () => {
        const first = await assertDeployedMaximum(7);
        await MathTestSession.reset();
        const defaultManager = await assertDeployedMaximum();
        expect(defaultManager).not.to.equal(first);
        await MathTestSession.reset();
        expect(await assertDeployedMaximum(7)).to.equal(first);
    });

    it("eligible source bypasses refresh and sync before queue retention", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        try {
            expect(await f.receive()).to.equal(true);
            const entry = await f.retention();
            expect(entry?.perSource).to.deep.equal([
                { source: f.h.getPeer(1).address, count: 1 }
            ]);
            expect((await f.observation()).chainReads).to.equal(0);
            expect((await f.observation()).syncRequests).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("wrong channel is rejected before sender refresh or retention", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ wrongChannel: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(false);
            expect(await f.retention()).to.equal(null);
            expect((await f.observation()).chainReads).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("forged author is rejected before sender refresh or retention", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ forgedAuthor: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(false);
            expect(await f.retention()).to.equal(null);
            expect((await f.observation()).chainReads).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("a source absent after a failed refresh follows ordinary sync", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ failMembership: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect(await f.retention()).to.equal(null);
            expect((await f.observation()).chainReads).to.equal(1);
            expect((await f.observation()).completedSyncs).to.equal(1);
            expect((await f.observation()).syncRequests).to.equal(0);
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(true);
        } finally {
            await f.close();
        }
    });

    it("a failed unknown copy preserves the existing honest contribution", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ failMembership: true });
        try {
            await f.receive();
            const before = await f.retention();
            await f.receive(f.strangers[0]);
            expect(await f.retention()).to.deep.equal(before);
            expect((await f.observation()).syncRequests).to.equal(0);
        } finally {
            await f.close();
        }
    });

    it("a failed membership read can retry on the next request", async () => {
        const f = new QueueIntakeFixture();
        await f.start({ failMembership: true });
        try {
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect((await f.observation()).chainReads).to.equal(2);
            expect((await f.observation()).completedSyncs).to.equal(2);
            expect(await f.retention()).to.equal(null);
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(true);
        } finally {
            await f.close();
        }
    });

    it("sync with no sender transport ends intake without queueing the block", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        try {
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect((await f.observation()).syncRequests).to.equal(0);
            expect((await f.observation()).completedSyncs).to.equal(1);
            expect(await f.retention()).to.equal(null);
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(true);
        } finally {
            await f.close();
        }
    });

    describe("posted calldata keeps its strategy through the queue", function () {
        it("a queued copy that merged a gossip copy → the gossip source is cut and a forced check is requested", async function () {
            const h = MathTestSession.getHarness();
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
                        {
                            origin: BlockOrigin.NETWORK,
                            senderAddress: colluder.address
                        }
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
            const h = MathTestSession.getHarness();
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
