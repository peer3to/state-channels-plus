import { expect } from "chai";
import { hexlify, zeroPadValue } from "ethers";

import { Hash } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

// mirrors LOG_RECOVERY_ATTEMPTS in EventSyncService
const LOG_RECOVERY_ATTEMPTS = 3;

describe("EventSyncService", function () {
    it("a failed log is retryable - re-dispatched, cursor advances once it succeeds", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeRejectedEventSyncLog()
            .request();

        expect(result.samePromise).to.equal(true);
        // the first delivery pair shares one dispatch, the reschedule re-enters
        // the handler, and the second reschedule reuses the resolved promise
        expect(result.handlerCallCount).to.equal(2);
        expect(result.firstError).to.equal("Expected event-sync rejection");
        expect(result.secondError).to.equal("Expected event-sync rejection");
        // the failure bubbles out of the detached promise
        expect(result.detachedError).to.equal("Expected event-sync rejection");
        // rescheduling after the failure retries it, it does not replay the
        // cached rejection
        expect(result.rescheduledError).to.equal(null);
        // the log's block completed on the retry -> the watermark moves
        expect(result.cursorAfter).to.be.greaterThan(result.cursorBefore ?? 0);
    });

    it("a log that keeps failing keeps the watermark below its block", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeRejectedEventSyncLog({ recoverOnRetry: false })
            .request();

        // every reschedule dispatches again while the handler keeps failing
        expect(result.handlerCallCount).to.equal(3);
        expect(result.rescheduledError).to.equal(
            "Expected event-sync rejection"
        );
        // its block never completed -> the watermark must not move over it
        expect(result.cursorAfter).to.equal(result.cursorBefore);
    });

    it("joins concurrent calldata recovery onto one chain query", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const result = await h
            .control(h.getPeer(0))
            .stub.probeConcurrentCalldataRecovery()
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
                .stub.probeInboundRunRecovery(inboundHead)
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
                .stub.probeInboundRunRecovery(inboundHead)
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
                15000
            );

            const probe = await h
                .control(h.getPeer(lagging))
                .stub.probeInboundRunRecovery(inboundHead)
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
                .stub.probeInboundRunRecovery(inboundHead)
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
                .stub.probeInboundRunRecovery(inboundHead)
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.heldBefore).to.equal(false);
            // the probe never clears -> the whole attempt budget is spent
            expect(probe.queryCount).to.equal(LOG_RECOVERY_ATTEMPTS);
            expect(probe.heldAfter).to.equal(false);
            expect(probe.blockCount).to.equal(null);

            await held.release({ replay: false });
        });

        it("chain query fails during recovery → undefined, no throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const lagging = 2;
            const dropped = await h.rpcStub.dropInboundMessageLogs(lagging);
            const inboundHead = await stageInboundHead(h, lagging);
            await dropped.waitUntilDropped();

            // the same recoverable gap as above, but every getLogs throws
            const probe = await h
                .control(h.getPeer(lagging))
                .stub.probeInboundRunRecovery(inboundHead, {
                    failChainQueries: true
                })
                .request();

            // the contract that keeps a flaky provider from evicting the peer
            expect(probe.threw).to.equal(null);
            // a failed query is one failed attempt - the rest still run
            expect(probe.queryCount).to.equal(LOG_RECOVERY_ATTEMPTS);
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
                .stub.probeBlockCalldataRecovery()
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.recoveredCalldata).to.equal(true);
            expect(probe.validationScheduled).to.equal(true);
            // one span already covers the whole window the calldata can be in
            expect(probe.queryCount).to.equal(1);
        });

        it("chain queries fail → benign result, no throw, calldata absent", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const { leader } = await h.transition.authorNextBlockOffWireWait();

            const probe = await h
                .control(leader)
                .stub.probeBlockCalldataRecovery({ failChainQueries: true })
                .request();

            expect(probe.threw).to.equal(null);
            expect(probe.recoveredCalldata).to.equal(false);
            expect(probe.validationScheduled).to.equal(false);
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

            const blinded = await h.rpcStub.failChainLogQueries(observerIndex);
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
            // a failed query is one failed attempt - the rest still run
            expect(queryCount).to.equal(LOG_RECOVERY_ATTEMPTS);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
        });

        it("dispute window-span read fails → failed recovery, no throw", async function () {
            const h = TestSession.getHarness();
            const observerIndex = 0;
            const { forkId, race, restoreEvents } =
                await h.scenario.disputeWithSuppressedCommitEvents({
                    observerIndex,
                    maliciousPeerIndex: 2
                });

            const ctl = h.control(h.getPeer(observerIndex));
            await ctl.stub.stubCountChainLogQueries().request();
            await ctl.stub.stubFailDisputeWindowTimestampRead().request();
            const recoveredCount = await ctl.dispute
                .recoverCommittedDisputes(forkId)
                .request();
            const queryCount = await ctl.stub.getChainLogQueryCount().request();
            await ctl.stub.restoreDisputeWindowTimestampRead().request();
            await ctl.stub.restoreChainLogQueries().request();

            expect(recoveredCount).to.equal(null);
            // the span read is contained ahead of the loop -> no query at all
            expect(queryCount).to.equal(0);

            await race.release({
                replayEvents: false,
                runHeldTasks: false,
                keepTasksHeld: true
            });
            await restoreEvents(false);
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
