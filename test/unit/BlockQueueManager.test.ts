import { SourceEligibility } from "@/stateManager/membership/MembershipService";
import { BlockOrigin } from "@/storage/QueueStorage";
import { BlockConfirmationEthersType } from "@/types/ethers";
import type { Address, Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import { probeSyncingQueuedSource } from "@test/fixtures/MilestoneSyncStaging";
import {
    restoreDequeuedEntry,
    stagePrunedObserver,
    withQueuedBlockMadePast
} from "@test/fixtures/PastBlockStaging";
import { assertDeployedMaximum } from "@test/fixtures/QueueDeploymentFixture";
import {
    assertStoredTipCopyDrainsNextBlock,
    probeJunkSourceAcrossUnreducedWindow,
    scheduleForkRecoveryAroundStop
} from "@test/fixtures/QueueDrainStaging";
import {
    QueueIntakeFixture,
    receiveWithExplicitStrategy
} from "@test/fixtures/QueueIntakeFixture";
import {
    assertOutsiderProofDoesNotAdmitCopy,
    assertSyncingAbsentSenderTakesOneStrike,
    stageAbsentGossipAcrossUnreducedWindow
} from "@test/fixtures/QueueNetworkRetentionFixture";
import { MathTestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { id, ZeroHash } from "ethers";

// a copy committed on chain carries onChainTimestamp, so the queue judges it
// with the calldata strategy: the participant strategy plus the chain-only
// deviations. Both tests read that routing off its two observable effects.

describe("Unit: BlockQueueManager", () => {
    it("stopping the runtime cancels a future queued block's armed timeout", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        const result = await f.h.execOnHost(
            f.h.getPeer(0),
            async (sm, args, { ethers }) => {
                const schedule = sm.timeoutManager.scheduleTask.bind(
                    sm.timeoutManager
                );
                let armed = 0;
                let delayMs = 0;
                let runs = 0;
                sm.timeoutManager.scheduleTask = (task, delay, name) => {
                    if (!name?.startsWith("BlockQueueManager.queueTimeout -"))
                        return schedule(task, delay, name);
                    armed += 1;
                    delayMs = delay;
                    return schedule(
                        () => {
                            runs += 1;
                            return task();
                        },
                        delay,
                        name
                    );
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
                    await sm.stop();
                    // past the armed deadline: a live timer would have fired
                    await new Promise((resolve) =>
                        setTimeout(resolve, delayMs + 500)
                    );
                    return { queuedBefore, armed, runs };
                } finally {
                    sm.timeoutManager.scheduleTask = schedule;
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
            armed: 1,
            runs: 0
        });
    });

    it("a fork recovery scheduled or firing after stop began never runs", async () => {
        expect(await scheduleForkRecoveryAroundStop()).to.deep.equal({
            scheduledBeforeStop: 1,
            scheduledAfterStop: 0,
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
                const sync = spectate.syncBlockSource;
                let syncCalls = 0;
                spectate.syncBlockSource = (...parameters) => {
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
                // isDisposed and before the timeout manager disposes
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
                    spectate.syncBlockSource = sync;
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

    it("a junk supplier answering a source probe through a window the chain has not reduced is asked again once the chain reduces it, then excluded", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        const probe = await probeJunkSourceAcrossUnreducedWindow(f);
        // premise: the probe waited while the window was unreduced
        expect(probe.reducedBeforeRelease).to.equal(ZeroHash);
        await waitFor(probe.supplierBlacklisted);
        expect(await probe.supplierRequests()).to.equal(2);
    });

    it("evidence posted into the window while a source probe waits extends the kill period and changes nothing: the supplier is asked again after the reduction, then excluded", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        const probe = await probeJunkSourceAcrossUnreducedWindow(
            f,
            async () => {
                await f.h.tamper.postTamperedDispute(0, () => {}, {
                    markMalicious: false
                });
                await f.h.assert.dispute.committedWait({
                    expectedCount: 2,
                    peersIndices: [0, 1]
                });
            }
        );
        // premise: the later evidence moved the kill period's end
        expect(probe.killPeriodEndAfter).to.be.greaterThan(
            probe.killPeriodEndBefore
        );
        expect(probe.reducedBeforeRelease).to.equal(ZeroHash);
        await waitFor(probe.supplierBlacklisted);
        expect(await probe.supplierRequests()).to.equal(2);
    });

    it("stopping the runtime while a source probe waits for the chain's reduction ends the wait: stop resolves and the supplier is not asked again", async () => {
        const f = new QueueIntakeFixture();
        await f.start();
        let stopped = false;
        const probe = await probeJunkSourceAcrossUnreducedWindow(
            f,
            async () => {
                // well after the first answer the probe is waiting; stop
                // ends the wait through the spectate service's abort
                // controller, and the supplier is not asked again
                await waitFor(
                    async () =>
                        (await f.h.query.killPeriod(f.h.activeForkId!))
                            .isExpired,
                    f.h.event.protocolEventTimeoutMs() * 2
                );
                stopped = await f.h.execOnHost(f.h.getPeer(0), async (sm) => {
                    await sm.stop();
                    return sm.isDisposed;
                });
            }
        );
        expect(stopped).to.equal(true);
        expect(await probe.supplierRequests()).to.equal(1);
    });

    it("an absent sender's gossip whose sync meets a window the chain has not reduced stays pending through the kill period, then the sender is asked again after the reduction and blacklisted", async () => {
        const { whileUnreduced, afterReduction } =
            await stageAbsentGossipAcrossUnreducedWindow();
        // premise: the kill period ended with the window unreduced
        expect(whileUnreduced).to.deep.equal({
            reducedForkId: ZeroHash,
            completedIntakes: 0,
            completedSyncs: 0,
            outsiderRequests: 1,
            outsiderBlacklisted: false,
            eligibility: SourceEligibility.ABSENT
        });
        expect(afterReduction).to.deep.equal({
            completedIntakes: 1,
            completedSyncs: 1,
            outsiderRequests: 2,
            outsiderBlacklisted: true,
            eligibility: SourceEligibility.ABSENT
        });
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

    it("an absent sender still in its own initial sync answers the intake sync that it is still syncing: one counted close, no blacklist and no queued block", async () => {
        await assertSyncingAbsentSenderTakesOneStrike();
    });

    it("a queued block's source still in its own initial sync answers the expiry probe that it is still syncing: one counted close and no blacklist", async () => {
        const h = MathTestSession.getHarness();
        const probed = await probeSyncingQueuedSource(h);
        expect(probed).to.deep.equal({
            wasQueued: true,
            strikesBefore: 0,
            strikesAfter: 1,
            isBlacklisted: false
        });
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
