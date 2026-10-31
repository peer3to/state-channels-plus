import { Hash } from "@/types/types";
import {
    assertDirectSlashRecovery,
    assertRecoveredSlashTimestampAndDedup
} from "@test/fixtures/DisputeSlashRecoveryStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { AbiCoder, hexlify, keccak256, zeroPadValue } from "ethers";

// mirrors LOG_RECOVERY_ATTEMPTS in EventSyncService
const LOG_RECOVERY_ATTEMPTS = 3;
/** The handlers a catch-up of the channel's subscribed logs can dispatch. */
const CATCH_UP_HANDLERS = [
    "onChannelOpened",
    "onInboundMessagesProcessed"
] as const;

describe("EventSyncService", function () {
    it("authoritative slash recovery returns no change for an empty chain set", async function () {
        await assertDirectSlashRecovery(TestSession.getHarness(), false);
    });
    it("authoritative slash recovery exposes a failed source read", async function () {
        await assertDirectSlashRecovery(TestSession.getHarness(), true);
    });
    it("authoritative slash recovery preserves the kill timestamp and deduplicates a repeated query", async function () {
        await assertRecoveredSlashTimestampAndDedup(TestSession.getHarness());
    });

    it("authoritative slash recovery rejects a missing chain head", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 0);
        const error = await h.execOnHost(h.getPeer(0), async (sm) => {
            const provider = sm.stateChannelManagerContract.runner!.provider!;
            const original = provider.getBlock.bind(provider);
            provider.getBlock = async () => null;
            try {
                await sm.eventSyncService.recoverOnChainSlashes(sm.channelId);
                return null;
            } catch (error) {
                return error instanceof Error ? error.message : String(error);
            } finally {
                provider.getBlock = original;
            }
        });
        expect(error).to.equal("Membership read could not read the chain head");
    });

    it("authoritative slash recovery rejects exhausted chain log queries", async function () {
        await assertRecoveredSlashTimestampAndDedup(
            TestSession.getHarness(),
            true
        );
    });

    it("joins concurrent calldata recovery onto one chain query", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .validation.probeConcurrentCalldataRecovery()
            .request();

        expect(result.queryCount).to.equal(2);
        expect(result.firstFound).to.equal(false);
        expect(result.secondFound).to.equal(false);
        expect(result.retryFound).to.equal(false);
    });

    describe("loadSynchronizedInboundRun", function () {
        // the inbound head every case below asks the lagging peer to prove.
        // topping up an existing participant moves the chain's inbound head
        // without any block consuming it
        const stageInboundHead = async (
            h: ReturnType<typeof TestSession.getHarness>,
            laggingIndex: number
        ): Promise<Hash> => {
            const observers = h.peers
                .map((peer) => peer.index)
                .filter((index) => index !== laggingIndex);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(observers[0]).address,
                observePeerIndices: observers
            });
            return (await h
                .control(h.getPeer(observers[0]))
                .query.getLatestInboundMessageHash()
                .request()) as Hash;
        };

        it("run already held → returned with no chain query", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const inboundHead = await stageInboundHead(h, 2);

            const probe = await h
                .control(h.getPeer(0))
                .validation.probeInboundRunRecovery(inboundHead)
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.heldBefore).to.equal(true);
            expect(probe.queryCount).to.equal(0);
            expect(probe.blockCount).to.be.greaterThan(0);
        });

        it("missed inbound log → recovered by query, the run becomes walkable", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lagging = 2;
            const dropped = await h.rpcStub.dropInboundMessageLogs(lagging);
            const inboundHead = await stageInboundHead(h, lagging);

            // premise - the delivery really was lost
            await dropped.waitUntilDropped();

            const probe = await h
                .control(h.getPeer(lagging))
                .validation.probeInboundRunRecovery(inboundHead)
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.heldBefore).to.equal(false);
            expect(probe.queryCount).to.be.greaterThan(0);
            // the driver stops as soon as the probe is satisfied
            expect(probe.queryCount).to.be.lessThan(LOG_RECOVERY_ATTEMPTS);
            expect(probe.heldAfter).to.equal(true);
            expect(probe.blockCount).to.be.greaterThan(0);

            await dropped.release();
        });

        it("logs recovered into an empty inbound store set its tip to the recovered head", async function () {
            const h = TestSession.getHarness();
            await h.setup(3);
            const lagging = 2;
            // lost from before the channel opens -> the lagging peer holds no
            // inbound block and no inbound tip
            const dropped = await h.rpcStub.dropInboundMessageLogs(lagging);
            await h.lifecycle.openChannel();
            const inboundHead = await stageInboundHead(h, lagging);
            await dropped.waitUntilDropped();
            const laggingCtl = h.control(h.getPeer(lagging));
            const tipBefore =
                await h.query.getLatestInboundMessageHash(lagging);

            const probe = await laggingCtl.validation
                .probeInboundRunRecovery(inboundHead)
                .request();
            const tipAfter = await h.query.getLatestInboundMessageHash(lagging);

            // premise - the store really was empty
            expect(tipBefore).to.equal(null);
            expect(probe.threw).to.equal(null);
            expect(probe.heldAfter).to.equal(true);
            // recovered logs take the tip-moving store path
            expect(tipAfter).to.equal(inboundHead);

            await dropped.release();
        });

        it("only the inbound log we do not hold is dispatched", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lagging = 2;
            const dropped = await h.rpcStub.dropInboundMessageLogs(lagging, {
                dropCount: 1
            });
            // the first top-up's log is lost, the second one lands -> the store
            // head sits above the hole the first left
            await stageInboundHead(h, lagging);
            await dropped.waitUntilDropped();
            const inboundHead = await stageInboundHead(h, lagging);

            // premise - the second log really landed, so the probe's dispatch
            // count only counts what the recovery itself re-dispatched
            await waitFor(
                async () =>
                    (await h
                        .control(h.getPeer(lagging))
                        .query.getLatestInboundMessageHash()
                        .request()) === inboundHead,
                h.event.protocolEventTimeoutMs()
            );

            const probe = await h
                .control(h.getPeer(lagging))
                .validation.probeInboundRunRecovery(inboundHead)
                .request();

            expect(probe.threw).to.equal(null);
            // the head is held, the block below it is not
            expect(probe.heldBefore).to.equal(true);
            expect(probe.queryCount).to.be.greaterThan(0);
            // exactly the lost one: re-dispatching the log we already applied
            // is pointless work, and that filter is what makes this terminate
            expect(probe.scheduledLogCount).to.equal(1);
            expect(probe.heldAfter).to.equal(true);
            expect(probe.blockCount).to.be.greaterThan(0);

            await dropped.release();
        });

        it("the widening span stays inside the watermark and the chain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lagging = 2;
            // the handler is held, so the gap never closes and every attempt of
            // the budget runs
            const held = await h.rpcStub.holdInboundMessageEvents(lagging);
            const inboundHead = await stageInboundHead(h, lagging);

            const probe = await h
                .control(h.getPeer(lagging))
                .validation.probeInboundRunRecovery(inboundHead)
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.queryCount).to.equal(LOG_RECOVERY_ATTEMPTS);
            expect(probe.toBlock).to.be.greaterThan(0);
            const fromBlocks = probe.queriedFromBlocks.map(
                (fromBlock) => fromBlock ?? -1
            );
            for (const fromBlock of fromBlocks) {
                expect(
                    fromBlock,
                    "every attempt queries a real block range"
                ).to.be.at.least(0);
                expect(
                    fromBlock,
                    "a span must not start above the chain head"
                ).to.be.at.most(probe.toBlock ?? -1);
                if (probe.cursorAtCall !== null) {
                    expect(
                        fromBlock,
                        "a span must not start above the processed watermark"
                    ).to.be.at.most(probe.cursorAtCall);
                }
            }
            // widening only ever moves fromBlock down. on a short chain the
            // span clamps to 0 and the doubling is not observable, so this is
            // non-increasing, not strictly decreasing
            expect(
                fromBlocks.every(
                    (fromBlock, index) =>
                        index === 0 || fromBlock <= fromBlocks[index - 1]
                ),
                "the queried spans must never narrow"
            ).to.equal(true);

            await held.release({ replay: false });
        });

        it("gap survives recovery → undefined, no throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lagging = 2;
            // the handler itself is held, so the recovery's re-dispatch lands in
            // the same hold -> the gap cannot be closed
            const held = await h.rpcStub.holdInboundMessageEvents(lagging);
            const inboundHead = await stageInboundHead(h, lagging);

            const probe = await h
                .control(h.getPeer(lagging))
                .validation.probeInboundRunRecovery(inboundHead)
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.heldBefore).to.equal(false);
            // the probe never clears -> the whole attempt budget is spent
            expect(probe.queryCount).to.equal(LOG_RECOVERY_ATTEMPTS);
            expect(probe.heldAfter).to.equal(false);
            expect(probe.blockCount).to.equal(null);

            await held.release({ replay: false });
        });

        it("local diamond failure applying a recovered log → recovery rejects with it", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lagging = 2;
            const dropped = await h.rpcStub.dropInboundMessageLogs(lagging);
            const inboundHead = await stageInboundHead(h, lagging);
            await dropped.waitUntilDropped();
            await h.mirror.failNextUpdate(
                lagging,
                "onInboundMessagesProcessed"
            );

            const probe = await h
                .control(h.getPeer(lagging))
                .validation.probeInboundRunRecovery(inboundHead)
                .request();

            expect(probe.threw).to.match(
                /^Local contract call failed: Error: Local EVM execution failed: revert/
            );
            expect(probe.heldBefore).to.equal(false);
            expect(probe.queryCount).to.equal(1);
            expect(probe.blockCount).to.equal(null);

            await dropped.release();
        });
    });

    describe("tryRecoverBlockCalldataAndScheduleValidation", function () {
        it("missed calldata log → recovered by query, validation scheduled", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            // an off-wire block is authored but never posted on-chain, so its
            // author owns a free calldata slot the probe can post into
            const { leader } = await h.transition.authorNextBlockOffWireWait();

            const probe = await h
                .control(leader)
                .validation.probeBlockCalldataRecovery()
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.recoveredCalldata).to.equal(true);
            expect(probe.validationScheduled).to.equal(true);
            // one span already covers the whole window the calldata can be in
            expect(probe.queryCount).to.equal(1);
        });
    });

    describe("loadSynchronizedWindowCommitments", function () {
        it("dispute recovery defeated → the window is reported unreadable, not thrown", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2
                });

            const blinded = await h.rpcStub.hideChainLogs(observerIndex);
            const recoveredCount = await h
                .control(h.getPeer(observerIndex))
                .dispute.recoverCommittedDisputes(forkId)
                .request();
            const queryCount = await h
                .control(h.getPeer(observerIndex))
                .stub.getChainLogQueryCount()
                .request();
            await blinded.restore();

            // null = the window could not be made locally readable. the old
            // code threw here, and the throw reached abort()
            expect(recoveredCount).to.equal(null);
            // no attempt finds the log -> every attempt runs
            expect(queryCount).to.equal(LOG_RECOVERY_ATTEMPTS);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
        });

        it("in-flight dispute log succeeds → recovery awaits it and resolves with its dispute stored", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, held } =
                await h.scenario.finalDisputeWithInFlightCommit({
                    observerIndex,
                    maliciousPeerIndex: 1
                });
            const observer = h.control(h.getPeer(observerIndex));
            const commitments = await h.channelManager.getWindowCommitments(
                h.channelId,
                forkId
            );
            expect(
                await observer.query
                    .hasDisputeConfirmation(commitments[0])
                    .request(),
                "the held log must not have stored its dispute yet"
            ).to.equal(false);

            let recoveredCount: number | null;
            try {
                recoveredCount = await observer.dispute
                    .recoverCommittedDisputes(forkId)
                    .request();
            } finally {
                await held.release();
            }

            expect(recoveredCount).to.equal(commitments.length);
            expect(
                await observer.query
                    .hasDisputeConfirmation(commitments[0])
                    .request()
            ).to.equal(true);
        });

        it("in-flight dispute log stores its dispute, then fails → recovery resolves with the window", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, held } =
                await h.scenario.finalDisputeWithInFlightCommit({
                    observerIndex,
                    maliciousPeerIndex: 1
                });
            const observer = h.control(h.getPeer(observerIndex));
            const commitments = await h.channelManager.getWindowCommitments(
                h.channelId,
                forkId
            );
            expect(
                await observer.query
                    .hasDisputeConfirmation(commitments[0])
                    .request(),
                "the held log must not have stored its dispute yet"
            ).to.equal(false);
            // the final path stores the dispute before this preparation
            await h.rpcStub.failNextFinalDisputePreparation(observerIndex);

            let recoveredCount: number | null;
            try {
                recoveredCount = await observer.dispute
                    .recoverCommittedDisputes(forkId)
                    .request();
            } finally {
                await held.release();
            }

            expect(recoveredCount).to.equal(commitments.length);
            expect(
                await observer.query
                    .hasDisputeConfirmation(commitments[0])
                    .request()
            ).to.equal(true);
            // the streamed log's own pipeline still reports its failure
            await TestSession.settleDetached({
                expectedErrorIncludes:
                    "Forced final-dispute output preparation failure"
            });
        });

        it("in-flight dispute log fails before storing its dispute → recovery rejects with that failure, also on a second call", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, held } =
                await h.scenario.finalDisputeWithInFlightCommit({
                    observerIndex,
                    maliciousPeerIndex: 1
                });
            const observer = h.control(h.getPeer(observerIndex));
            const commitments = await h.channelManager.getWindowCommitments(
                h.channelId,
                forkId
            );
            expect(
                await observer.query
                    .hasDisputeConfirmation(commitments[0])
                    .request(),
                "the held log must not have stored its dispute yet"
            ).to.equal(false);
            // the handler's first step, before the dispute is stored
            await h.mirror.failNextUpdate(observerIndex, "onDisputeCommitted");

            try {
                await expect(
                    observer.dispute.recoverCommittedDisputes(forkId).request()
                ).to.be.rejectedWith(/Local EVM execution failed: revert/);
            } finally {
                await held.release();
            }
            // the failed log is never dispatched again: the retry joins the
            // same failure instead of reporting the window unreadable
            await expect(
                observer.dispute.recoverCommittedDisputes(forkId).request()
            ).to.be.rejectedWith(/Local EVM execution failed: revert/);
            expect(
                await observer.query
                    .hasDisputeConfirmation(commitments[0])
                    .request()
            ).to.equal(false);
            await TestSession.settleDetached({
                expectedErrorIncludes: "Local EVM execution failed: revert"
            });
        });

        it("dispute log recovery dispatches itself fails → recovery rejects with that failure", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2
                });
            const failing =
                await h.rpcStub.failDisputeCommittedHandler(observerIndex);

            await expect(
                h
                    .control(h.getPeer(observerIndex))
                    .dispute.recoverCommittedDisputes(forkId)
                    .request()
            ).to.be.rejectedWith("stubbed onDisputeCommitted failure");
            expect(
                await failing.handlerCalls(),
                "the recovery must really have dispatched the dropped logs"
            ).to.be.greaterThan(0);
            await failing.restore();

            // Keep event and timer holds until harness disposal. Restoring only
            // event handlers lets a late chain event await a deferred reduction
            // whose retry timer is still held, hanging the detached-promise drain.
        });
    });

    describe("scheduleLog deduplication", function () {
        it("dispatches a log a second stream delivers again only once", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });

            const probe = await h
                .control(h.getPeer(1))
                .validation.probeInboundLogRedelivery("duplicate")
                .request();

            expect(probe.handlerCalls).to.equal(0);
        });

        it("dispatches a log re-mined in another block after a reorg as a new event", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });

            const probe = await h
                .control(h.getPeer(1))
                .validation.probeInboundLogRedelivery("reorged")
                .request();

            expect(probe.handlerCalls).to.equal(1);
        });

        it("ignores a log a reorg removed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });

            const probe = await h
                .control(h.getPeer(1))
                .validation.probeInboundLogRedelivery("removed")
                .request();

            expect(probe.handlerCalls).to.equal(0);
        });
    });

    describe("waitForChainHead", function () {
        it("head already at the block → true without waiting for a new block, no block listener left", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const r = await h.execOnHost(h.getPeer(0), async (sm) => {
                const provider =
                    sm.stateChannelManagerContract.runner!.provider!;
                const listenersBefore = await provider.listenerCount("block");
                const head = await provider.getBlockNumber();
                const reached = await sm.eventSyncService.waitForChainHead(
                    head,
                    60_000,
                    new AbortController().signal
                );
                return {
                    reached,
                    listenersBefore,
                    listenersAfter: await provider.listenerCount("block")
                };
            });
            expect(r.reached).to.equal(true);
            expect(r.listenersAfter).to.equal(r.listenersBefore);
        });

        it("the provider catches up during the wait → still waiting until the next mined block, then true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lag = await h.rpcStub.lagChainView(0);
            try {
                await h.rpcStub.mineTransferBlock();
                let settled = false;
                const waiting = h
                    .execOnHost(
                        h.getPeer(0),
                        async (sm, a) =>
                            sm.eventSyncService.waitForChainHead(
                                a.target,
                                60_000,
                                new AbortController().signal
                            ),
                        { target: lag.pinnedBlock + 1 }
                    )
                    .finally(() => {
                        settled = true;
                    });
                await waitFor(
                    async () =>
                        (await lag.chainHeadWaitsEntered()) > 0 &&
                        (await lag.headReads()) > 0,
                    h.event.protocolEventTimeoutMs()
                );
                // the real head is past the block, but nothing announces it
                expect(await lag.release()).to.equal(true);
                expect(settled).to.equal(false);
                await h.rpcStub.mineTransferBlock();
                expect(await waiting).to.equal(true);
            } finally {
                await lag.release();
            }
        });

        it("the block does not arrive within the timeout → false after the timeout, no block listener left", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const r = await h.execOnHost(h.getPeer(0), async (sm) => {
                const provider =
                    sm.stateChannelManagerContract.runner!.provider!;
                const listenersBefore = await provider.listenerCount("block");
                const head = await provider.getBlockNumber();
                const startedAt = Date.now();
                const reached = await sm.eventSyncService.waitForChainHead(
                    head + 1_000,
                    200,
                    new AbortController().signal
                );
                return {
                    reached,
                    elapsedMs: Date.now() - startedAt,
                    listenersBefore,
                    listenersAfter: await provider.listenerCount("block")
                };
            });
            expect(r.reached).to.equal(false);
            expect(r.elapsedMs).to.be.at.least(200);
            expect(r.listenersAfter).to.equal(r.listenersBefore);
        });

        it("aborted during the wait → false, no block listener left", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const r = await h.execOnHost(h.getPeer(0), async (sm) => {
                const provider =
                    sm.stateChannelManagerContract.runner!.provider!;
                const listenersBefore = await provider.listenerCount("block");
                const head = await provider.getBlockNumber();
                const abort = new AbortController();
                setTimeout(() => abort.abort(), 200);
                const reached = await sm.eventSyncService.waitForChainHead(
                    head + 1_000,
                    60_000,
                    abort.signal
                );
                return {
                    reached,
                    listenersBefore,
                    listenersAfter: await provider.listenerCount("block")
                };
            });
            expect(r.reached).to.equal(false);
            expect(r.listenersAfter).to.equal(r.listenersBefore);
        });

        it("aborted before the call → false at once, with no head read", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const r = await h.execOnHost(h.getPeer(0), async (sm) => {
                const provider =
                    sm.stateChannelManagerContract.runner!.provider!;
                const original = provider.getBlockNumber.bind(provider);
                let headReads = 0;
                provider.getBlockNumber = async () => {
                    headReads++;
                    throw new Error("head read failed");
                };
                const abort = new AbortController();
                abort.abort();
                try {
                    const reached = await sm.eventSyncService.waitForChainHead(
                        1,
                        60_000,
                        abort.signal
                    );
                    return { reached, headReads };
                } finally {
                    provider.getBlockNumber = original;
                }
            });
            expect(r).to.deep.equal({ reached: false, headReads: 0 });
        });

        it("a failed head read rejects with its error, no block listener left", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const r = await h.execOnHost(h.getPeer(0), async (sm) => {
                const provider =
                    sm.stateChannelManagerContract.runner!.provider!;
                const listenersBefore = await provider.listenerCount("block");
                const original = provider.getBlockNumber.bind(provider);
                provider.getBlockNumber = async () => {
                    throw new Error("head read failed");
                };
                let error: string | null = null;
                try {
                    await sm.eventSyncService.waitForChainHead(
                        1,
                        60_000,
                        new AbortController().signal
                    );
                } catch (caught) {
                    error =
                        caught instanceof Error
                            ? caught.message
                            : String(caught);
                } finally {
                    provider.getBlockNumber = original;
                }
                return {
                    error,
                    listenersBefore,
                    listenersAfter: await provider.listenerCount("block")
                };
            });
            expect(r.error).to.equal("head read failed");
            expect(r.listenersAfter).to.equal(r.listenersBefore);
        });

        it("a head read that never settles → false at the timeout and at the abort, no block listener left", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const r = await h.execOnHost(h.getPeer(0), async (sm) => {
                const provider =
                    sm.stateChannelManagerContract.runner!.provider!;
                const listenersBefore = await provider.listenerCount("block");
                const original = provider.getBlockNumber.bind(provider);
                provider.getBlockNumber = () => new Promise<number>(() => {});
                try {
                    const timedOutAt = Date.now();
                    const timedOut = await sm.eventSyncService.waitForChainHead(
                        1,
                        200,
                        new AbortController().signal
                    );
                    const timeoutElapsedMs = Date.now() - timedOutAt;
                    const abort = new AbortController();
                    setTimeout(() => abort.abort(), 200);
                    const abortedAt = Date.now();
                    const aborted = await sm.eventSyncService.waitForChainHead(
                        1,
                        60_000,
                        abort.signal
                    );
                    return {
                        timedOut,
                        timeoutElapsedMs,
                        aborted,
                        abortElapsedMs: Date.now() - abortedAt,
                        listenersBefore,
                        listenersAfter: await provider.listenerCount("block")
                    };
                } finally {
                    provider.getBlockNumber = original;
                }
            });
            expect(r.timedOut).to.equal(false);
            expect(r.timeoutElapsedMs).to.be.within(190, 5_000);
            expect(r.aborted).to.equal(false);
            expect(r.abortElapsedMs).to.be.within(190, 5_000);
            expect(r.listenersAfter).to.equal(r.listenersBefore);
        });
    });

    describe("scheduleStreamedLog", function () {
        it("drops a lagging node's log below the watermark", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            // a later block completes, so the watermark passes the opening
            // block and that block's dedup keys are pruned
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });

            const probe = await h
                .control(h.getPeer(1))
                .validation.probeStreamedLogBelowWatermark()
                .request();

            // premise - the opening log is below the watermark
            expect(probe.watermark).to.be.greaterThan(probe.logBlockNumber);
            expect(probe.handlerCalls).to.equal(0);
        });
    });

    describe("scheduleStreamedLog at the watermark", function () {
        it("dispatches a never-seen log in the watermark block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });

            const probe = await h
                .control(h.getPeer(1))
                .validation.probeInboundLogRedelivery("reorgedAtWatermark")
                .request();

            // premise - the log's block is the completed watermark itself
            expect(probe.watermark).to.equal(probe.logBlockNumber);
            expect(probe.handlerCalls).to.equal(1);
        });
    });

    describe("holdWatermark", function () {
        it("keeps the watermark at its block while a later block completes, and publishes that block on release", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const validation = h.control(h.getPeer(1)).validation;
            const watermark = await validation.getEventWatermark().request();
            if (watermark === null) throw new Error("Expected a watermark");
            const holdId = await validation.holdEventWatermark().request();
            const callsBefore = h.event.getEventCallCount(
                1,
                "onInboundMessagesProcessed"
            );

            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });
            await h.event.settleContractEvents(1);
            const [topUpLog] = (
                await h.channelManager.queryFilter(
                    h.channelManager.filters.InboundMessagesProcessed(
                        h.channelId
                    )
                )
            ).slice(-1);

            // premise - the later block's log was processed while held
            expect(
                h.event.getEventCallCount(1, "onInboundMessagesProcessed")
            ).to.equal(callsBefore + 1);
            expect(topUpLog.blockNumber).to.be.greaterThan(watermark);
            expect(await validation.getEventWatermark().request()).to.equal(
                watermark
            );
            expect(
                await validation.releaseEventWatermark(holdId).request()
            ).to.equal(topUpLog.blockNumber);
        });

        it("a repeated release does not release another hold", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const validation = h.control(h.getPeer(1)).validation;
            const watermark = await validation.getEventWatermark().request();
            if (watermark === null) throw new Error("Expected a watermark");
            const firstHold = await validation.holdEventWatermark().request();
            const secondHold = await validation.holdEventWatermark().request();

            await validation.releaseEventWatermark(firstHold).request();
            await validation.releaseEventWatermark(firstHold).request();
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });
            await h.event.settleContractEvents(1);
            const [topUpLog] = (
                await h.channelManager.queryFilter(
                    h.channelManager.filters.InboundMessagesProcessed(
                        h.channelId
                    )
                )
            ).slice(-1);

            expect(topUpLog.blockNumber).to.be.greaterThan(watermark);
            expect(await validation.getEventWatermark().request()).to.equal(
                watermark
            );
            expect(
                await validation.releaseEventWatermark(secondHold).request()
            ).to.equal(topUpLog.blockNumber);
        });

        it("holds at the given start block before any block completed, and publishes the channel's first block on release", async function () {
            const h = TestSession.getHarness();
            const label = "event-sync-hold-before-watermark";
            const channelId = keccak256(
                AbiCoder.defaultAbiCoder().encode(["string"], [label])
            );
            const observer = 2;
            await h.setup(3, { autoConnect: false, channelId: label });
            await h.setChannelId(channelId);
            const validation = h.control(h.getPeer(observer)).validation;
            // premise - no block of the channel completed yet
            expect(await validation.getEventWatermark().request()).to.equal(
                null
            );
            const startBlock = await h.provider.getBlockNumber();
            const holdId = await validation
                .holdEventWatermark(startBlock)
                .request();
            const openedBefore = h.event.getEventCallCount(
                observer,
                "onChannelOpened"
            );

            await h.lifecycle.openChannelForParticipants([0, 1], {
                observePeerIndices: [0, 1]
            });
            await waitFor(
                () =>
                    h.event.getEventCallCount(observer, "onChannelOpened") >
                    openedBefore
            );
            await h.event.settleContractEvents(observer);
            const [openedLog] = (
                await h.channelManager.queryFilter(
                    h.channelManager.filters.ChannelOpened(channelId)
                )
            ).slice(-1);

            // premise - the opening completed a block after the hold's start
            expect(openedLog.blockNumber).to.be.greaterThan(startBlock);
            expect(await validation.getEventWatermark().request()).to.equal(
                null
            );
            expect(
                await validation.releaseEventWatermark(holdId).request()
            ).to.equal(openedLog.blockNumber);
        });
    });

    describe("catchUpLogs", function () {
        it("schedules the log this peer's subscription lost", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lagging = 2;
            const dropped = await h.rpcStub.dropInboundMessageLogs(lagging);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address,
                observePeerIndices: [0, 1]
            });
            const inboundHead = await h
                .control(h.getPeer(0))
                .query.getLatestInboundMessageHash()
                .request();
            // premise - the delivery really was lost
            await dropped.waitUntilDropped();
            await dropped.release();
            expect(
                await h
                    .control(h.getPeer(lagging))
                    .query.getLatestInboundMessageHash()
                    .request()
            ).not.to.equal(inboundHead);
            // every earlier handler call has reached the spies
            await h.event.settleContractEvents(lagging);
            const callsBefore = h.event.getEventCallCounts(
                lagging,
                CATCH_UP_HANDLERS
            );

            const read = await h
                .control(h.getPeer(lagging))
                .validation.runCatchUpFromFirstNode()
                .request();

            expect(read).to.equal(true);
            await waitFor(
                () =>
                    h.event.getEventCallCounts(lagging, CATCH_UP_HANDLERS) >
                    callsBefore
            );
            await h.event.settleContractEvents(lagging);
            expect(
                h.event.getEventCallCounts(lagging, CATCH_UP_HANDLERS)
            ).to.equal(callsBefore + 1);
            expect(
                await h
                    .control(h.getPeer(lagging))
                    .query.getLatestInboundMessageHash()
                    .request()
            ).to.equal(inboundHead);
        });

        it("does not dispatch the channel's opening logs again", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);

            // the watermark is the opening block, so the read includes its
            // ChannelOpened and genesis inbound logs
            // every earlier handler call has reached the spies
            await h.event.settleContractEvents(1);
            const callsBefore = h.event.getEventCallCounts(
                1,
                CATCH_UP_HANDLERS
            );

            const read = await h
                .control(h.getPeer(1))
                .validation.runCatchUpFromFirstNode()
                .request();

            expect(read).to.equal(true);
            await h.event.settleContractEvents(1);
            expect(h.event.getEventCallCounts(1, CATCH_UP_HANDLERS)).to.equal(
                callsBefore
            );
        });

        it("does not dispatch a log this peer already processed again", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address
            });

            // every earlier handler call has reached the spies
            await h.event.settleContractEvents(1);
            const callsBefore = h.event.getEventCallCounts(
                1,
                CATCH_UP_HANDLERS
            );

            const read = await h
                .control(h.getPeer(1))
                .validation.runCatchUpFromFirstNode()
                .request();

            expect(read).to.equal(true);
            await h.event.settleContractEvents(1);
            expect(h.event.getEventCallCounts(1, CATCH_UP_HANDLERS)).to.equal(
                callsBefore
            );
        });
    });

    describe("getSubscriptionFilter", function () {
        // restated on purpose: this list is the oracle. dropping an event from
        // the subscription changes which logs the peer receives at all, and the
        // shared topic builder must not quietly reshape the filter
        const SUBSCRIBED_EVENT_NAMES = [
            "ChannelOpened",
            "StateSnapshotUpdated",
            "BlockCalldataPosted",
            "DisputeCommitted",
            "DisputeCommittedWithAuditingData",
            "ChainSlashed",
            "DisputeReducedResultCommitted",
            "WithdrawalsUpdated",
            "ChannelStorageCleared",
            "DisputeKilled",
            "InboundMessagesProcessed"
        ] as const;

        it("the subscription filter is unchanged by the shared topic builder", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const channelId = h.channelId!;

            const filter = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const built = sm.eventSyncService.getSubscriptionFilter(
                        args.channelId
                    );
                    return {
                        address: String(built.address),
                        topics: built.topics ?? []
                    };
                },
                { channelId }
            );

            expect(filter.address).to.equal(
                await h.channelManager.getAddress()
            );
            // only topic0 and the indexed channelId - the subscription has no
            // third indexed constraint
            expect(filter.topics.length).to.equal(2);
            expect(filter.topics[0]).to.deep.equal(
                SUBSCRIBED_EVENT_NAMES.map(
                    (name) =>
                        h.channelManager.interface.getEvent(name)!.topicHash
                )
            );
            expect(filter.topics[1]).to.equal(
                zeroPadValue(hexlify(channelId), 32)
            );
        });
    });
});
