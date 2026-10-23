import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { BlockConfirmationEthersType } from "@/types/ethers";
import type { Address, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import {
    restoreDequeuedEntry,
    stagePrunedObserver,
    withQueuedBlockMadePast
} from "@test/fixtures/PastBlockStaging";
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

    it("an intake-gate sync whose payload fails validation blacklists the sender through the sync with no queue entry", async () => {
        await assertOutsiderProofDoesNotAdmitCopy("invalid");
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

    it("sync with no sender transport ends intake with a counted close, no blacklist and no queued block", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        try {
            expect(await f.receive(f.strangers[0])).to.equal(true);
            expect((await f.observation()).syncRequests).to.equal(0);
            expect((await f.observation()).completedSyncs).to.equal(1);
            expect(await f.retention()).to.equal(null);
            // the failed request is the sync's counted close, not a verdict
            expect(
                await f.control.query.isBlacklisted(f.strangers[0]).request()
            ).to.equal(false);
            expect(
                await f.control.query.getStrikes(f.strangers[0]).request()
            ).to.equal(1);
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

    describe("past blocks", function () {
        it("gossip: a genuine block at a free height below the next height → dropped: not queued, stored or executed, no sync probe, no source cut, no fraud proof", async function () {
            const h = MathTestSession.getHarness();
            const { observer, source, forkId, pruned, prunedHeights } =
                await stagePrunedObserver(h, { stripStoredHead: false });
            const control = h.control(observer);
            // premise - height 1 is free below the next height
            expect(prunedHeights).to.deep.equal([0, 1]);
            expect(
                await control.query.getNextBlockHeight(forkId).request()
            ).to.equal(3);
            const restoreSync = await h.rpcStub.recordSpectateSync(
                observer.index,
                { forward: false }
            );
            try {
                expect(
                    await control.transition
                        .ingestBlockConfirmation(
                            pruned.encodedBlockConfirmation,
                            {
                                origin: BlockOrigin.NETWORK,
                                senderAddress: source.address
                            }
                        )
                        .request()
                ).to.equal(true);
                expect(
                    await control.query.isBlockQueued(pruned.hash).request()
                ).to.equal(false);
                expect(
                    await control.query.getBlockHashAt(forkId, 1).request()
                ).to.equal(null);
                expect(
                    await control.query.getNextBlockHeight(forkId).request()
                ).to.equal(3);
                expect(
                    await h.rpcStub.spectateSyncCallCount(observer.index)
                ).to.equal(0);
            } finally {
                await restoreSync();
            }
            for (const peer of h.peers) {
                expect(
                    await control.query.isBlacklisted(peer.address).request()
                ).to.equal(false);
                expect(
                    await control.query
                        .getFraudProofType(peer.address)
                        .request()
                ).to.equal(null);
            }
        });

        it("gossip: a stored block below the next height carrying signatures the observer lacks → still merges them", async function () {
            const h = MathTestSession.getHarness();
            const { observer, source, forkId, head } =
                await stagePrunedObserver(h, { stripStoredHead: true });
            const control = h.control(observer);
            const signers = async () =>
                (await control.query.getBlockByHeight(forkId, 2).request())!
                    .confirmationSignerAddresses;
            // premise - the stored head is below the next height and lacks
            // the confirmations the full copy carries
            expect(
                await control.query.getNextBlockHeight(forkId).request()
            ).to.equal(3);
            expect(await signers()).to.deep.equal([]);
            expect(head.confirmationSignerAddresses).to.not.be.empty;

            expect(
                await control.transition
                    .ingestBlockConfirmation(head.encodedBlockConfirmation, {
                        origin: BlockOrigin.NETWORK,
                        senderAddress: source.address
                    })
                    .request()
            ).to.equal(true);
            await waitFor(
                async () =>
                    (await signers()).length ===
                    head.confirmationSignerAddresses.length,
                h.event.protocolEventTimeoutMs()
            );
            expect(await signers()).to.have.members(
                head.confirmationSignerAddresses
            );
            expect(
                await control.query.isBlacklisted(source.address).request()
            ).to.equal(false);
        });

        it("pipeline: a live entry at a free height below the next height → settled as past before validation: no deviation hook, restore, disconnect or dispute", async function () {
            const h = MathTestSession.getHarness();
            const { observer, forkId } = await stagePrunedObserver(h, {
                stripStoredHead: false
            });
            // a participant's block at the pruned height; its link cannot be
            // judged without the history the proof skipped
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 1,
                    participant: observer.address as Address
                },
                previousBlockHash: factory.hash()
            });

            const r = await h
                .control(observer)
                .validation.runBlockIngest(encoded)
                .request();

            expect(r.threw).to.equal(null);
            expect(r.keepConnection).to.equal(true);
            expect(r.firedHooks).to.deep.equal([]);
            expect(r.disconnectedAddresses).to.deep.equal([]);
            expect(r.disputedForkIds).to.deep.equal([]);
            expect(r.restoreQueuedEntryCalled).to.equal(false);
            expect(
                await h
                    .control(observer)
                    .query.getBlockHashAt(forkId, 1)
                    .request()
            ).to.equal(null);
        });

        it("queue expiry: a queued block whose height became free below the next height → dropped: no sync probe, no queue entry or stored block, no source cut, no fraud proof", async function () {
            const h = MathTestSession.getHarness();
            await withQueuedBlockMadePast(
                h,
                async ({
                    requester,
                    forkId,
                    hash,
                    premise,
                    queueTimeouts,
                    executions
                }) => {
                    const control = h.control(requester);
                    // premise - queued above the next height, then a compact
                    // sync left its height free below the next height
                    expect(premise).to.deep.equal({
                        beforeSync: { queued: true, nextHeight: 0 },
                        syncAccepted: true,
                        queued: true,
                        heldTimeouts: 1,
                        nextHeight: 3,
                        storedAtHeight: null
                    });
                    const restoreSync = await h.rpcStub.recordSpectateSync(
                        requester.index,
                        { forward: false }
                    );
                    try {
                        expect(await queueTimeouts.runHeld()).to.deep.equal({
                            ran: 1,
                            errors: []
                        });
                        // settled at expiry, not handed to queued execution
                        expect(await executions.heldCount()).to.equal(0);
                        expect(
                            await h.rpcStub.spectateSyncCallCount(
                                requester.index
                            )
                        ).to.equal(0);
                    } finally {
                        await restoreSync();
                    }
                    expect(
                        await control.query.isBlockQueued(hash).request()
                    ).to.equal(false);
                    expect(
                        await control.query.getBlockHashAt(forkId, 1).request()
                    ).to.equal(null);
                    for (const peer of h.peers) {
                        expect(
                            await control.query
                                .isBlacklisted(peer.address)
                                .request()
                        ).to.equal(false);
                        expect(
                            await control.query
                                .getFraudProofType(peer.address)
                                .request()
                        ).to.equal(null);
                    }
                }
            );
        });

        it("restore: a dequeued entry whose height became free below the next height → settled as past: processed, not queued again, no new queue timeout", async function () {
            const h = MathTestSession.getHarness();
            await withQueuedBlockMadePast(
                h,
                async ({ requester, forkId, hash, premise, queueTimeouts }) => {
                    expect(premise).to.deep.equal({
                        beforeSync: { queued: true, nextHeight: 0 },
                        syncAccepted: true,
                        queued: true,
                        heldTimeouts: 1,
                        nextHeight: 3,
                        storedAtHeight: null
                    });
                    expect(
                        await restoreDequeuedEntry(h, requester, hash)
                    ).to.deep.equal({ queued: false });
                    await h.event.waitForBlockConfirmationProcessed({
                        peerIndex: requester.index,
                        blockHash: hash as Hash,
                        keepConnection: true
                    });
                    // a restore would have armed a second timeout
                    expect(await queueTimeouts.heldCount()).to.equal(1);
                    expect(
                        await h
                            .control(requester)
                            .query.getBlockHashAt(forkId, 1)
                            .request()
                    ).to.equal(null);
                }
            );
        });

        it("dispute replay at a free height below the next height → not past: validation reaches the linkage guard", async function () {
            const h = MathTestSession.getHarness();
            const { observer, forkId } = await stagePrunedObserver(h, {
                stripStoredHead: false
            });
            const encoded = await factory.buildAndEncodeBlock(observer.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: 1,
                    participant: observer.address as Address
                },
                previousBlockHash: factory.hash()
            });

            const r = await h
                .control(observer)
                .validation.runBlockIngest(encoded, { strategy: "dispute" })
                .request();

            // the linkage hook throws on this strategy (a replayed block is
            // always linked), so reaching it proves the entry was not settled
            // as past
            expect(r.threw).to.match(
                /blockIsNotLinkedAndIsNotFirstBlock should not be called/
            );
        });
    });
});
