import { DisputeFraudProofType } from "@/types/sol-enums";
import { sleep, tryDecodeCustomError } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { TimeoutTooEarlyStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import { expect } from "chai";

// Invalid-dispute scenarios require upload -> audit -> kill to fit inside the
// evidence window. With one-second interval mining, the three-second minimum
// has no scheduling margin for those two sequential on-chain transactions.
const INVALID_DISPUTE_EVIDENCE_TIME = 5;

describe("E2E: dispute validation / disputeInputFields / timeout", function () {
    it("dispute.input.timeout.blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState", async function () {
        const h = TestSession.getHarness();
        // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
        await h.lifecycle.timeoutSetup(3, 0, {
            timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
        });
        await h.assert.sync.peersInSyncWait();
        h.contextApi.captureOriginalFork();
        h.event.resetEventSpies();

        // Peer 2 submits a timeout dispute with the wrong blockHeight.
        await h.tamper.stubConstructDispute(2, async (dispute, sm) => {
            const svc = sm.p2pManager.localRpc.dispute;
            const [hasBlock, latestBlock] =
                await svc.getLatestBlockFromStateProof(
                    dispute.input.stateProof
                );
            const expectedHeight = hasBlock
                ? Number(latestBlock.transaction.header.transactionCnt) + 1
                : 0;
            dispute.input.timeout.blockHeight = expectedHeight + 1;
        });

        // No action needed — peer 0 never writes, so the timeout fires naturally.
        // Peer 1 will upload a valid timeout dispute; peer 2's dispute is tampered
        // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast",
            timeoutMs: h.event.protocolEventTimeoutMs(0)
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.TimeoutNotLinkedToLatestState,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait({
            forkId: h.context.originalForkId!,
            forkSettleTimeoutMs: 15000
        });
    });

    it("dispute.input.timeout.participant != next writer → TimeoutParticipantNotNext", async function () {
        const h = TestSession.getHarness();
        // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
        await h.scenario.preDisputeSetup({
            timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
        });
        const forkId = h.activeForkId!;

        // Peer 0 submits a timeout dispute with the wrong participant.
        await h.tamper.stubConstructDispute(
            0,
            (dispute, _sm, args) => {
                //  blame peer 1
                dispute.input.timeout.participant =
                    args.blamedAddress as string;
            },
            { args: { blamedAddress: h.getPeer(1).address } }
        );

        // No action needed — peer 2 never writes, so the timeout fires naturally.
        // Peer 1 will upload a valid timeout dispute; peer 0's dispute is tampered
        // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast",
            timeoutMs: h.event.protocolEventTimeoutMs(0)
        });

        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.TimeoutParticipantNotNext,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait({ forkId });
    });

    describe("TimeoutTooEarly", function () {
        it("existing window predates timeout deadline → upload reverts with race-condition guard", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
            });
            const forkId = h.activeForkId!;
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });

            await h.tamper.postTamperedDispute(0, () => {}, {
                markMalicious: false
            });
            await h.assert.dispute.committedWait({
                peersIndices: [0],
                expectedCount: 1
            });

            const windowCreationTimestamp =
                await h.channelManager.getDisputeWindowCreationTimestamp(
                    h.channelId,
                    h.activeForkId!
                );
            await h.tamper.plantFreshTimeoutForNextWriter(1);

            try {
                await h.tamper.postTamperedDispute(
                    1,
                    (dispute) => {
                        dispute.input.timeout.minTimeStamp =
                            windowCreationTimestamp + 1n;
                    },
                    { markMalicious: false }
                );
                throw new Error("expected timeout dispute upload to revert");
            } catch (error: unknown) {
                const customError = tryDecodeCustomError(error);
                if (!customError) throw error;
                if (
                    customError.errorDescription.name !==
                    "RaceConditionDisputeTimeoutWindowCreatedTooEarly"
                ) {
                    throw error;
                }
            }
        });

        it("dispute.input.timeout posted before wait period elapses → honest peers store TimeoutTooEarly", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
            });
            const forkId = h.activeForkId!;
            // peer 2 is the silent non-writer → exclude from fork-change barrier.
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });

            await h.tamper.plantFreshTimeoutForNextWriter(0);
            await h.tamper.postTamperedDispute(0, () => {});
            const maliciousAfterAction = [...h.context.maliciousPeerIndices];
            if (
                maliciousAfterAction.length !== 1 ||
                maliciousAfterAction[0] !== 0
            ) {
                throw new Error(
                    "Tampered dispute author was not classified malicious"
                );
            }

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType: DisputeFraudProofType.TimeoutTooEarly,
                timeoutMs: 10000
            });

            await h.assert.dispute.slashedOnChain(h.getPeer(0).address);
            await h.dispute.resolveDisputeWait({
                forkId,
                forkSettleTimeoutMs: 15000
            });
        });

        it("valid timeout dispute → no TimeoutTooEarly fraud proof stored (false-positive guard)", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // Mark the non-writer up front so honest-peer barriers (committedWait,
            // resolveDisputeWait) exclude peer 2.
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });
            const originalForkId = h.activeForkId!;

            // Natural timeout: peer 2 never authors.
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 1]
            });

            // No honest peer should fire onDisputeKilled and none
            // should store ANY dispute fraud proof.
            await h.event.waitWhileEventCountsStayAtMost(
                "onDisputeKilled",
                [0, 1],
                { durationMs: 3000, maxCount: 0 }
            );
            for (const peer of [0, 1]) {
                const proofTypes = await h
                    .control(h.getPeer(peer))
                    .query.getDisputeFraudProofTypes()
                    .request();
                if (proofTypes.length > 0) {
                    throw new Error(
                        `Peer ${peer} stored ${proofTypes.length} dispute fraud proof(s) on a valid timeout dispute (types: ${proofTypes.join(", ")}) — pipeline false positive`
                    );
                }
            }

            await h.dispute.resolveDisputeWait({
                forkId: originalForkId,
                forkSettleTimeoutMs: 15000
            });
        });

        it("forged TimeoutTooEarly against a legitimate timeout dispute → proof author slashed", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // peer 2 does not write, so it will timeout naturally.
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });
            const forkId = h.activeForkId!;

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 1]
            });

            await h.tamper.submitForgedFraudProof(
                0,
                DisputeFraudProofType.TimeoutTooEarly,
                ({ genesisSnapshot }): TimeoutTooEarlyStruct => ({
                    genesisStateSnapshotData: genesisSnapshot.snapshotData,
                    previousBlockOnChainTimestamp: 0
                })
            );

            await h.assert.dispute.slashedOnChain(h.getPeer(0).address);

            await h.dispute.resolveDisputeWait({
                forkId,
                forkSettleTimeoutMs: 15000
            });
        });
    });

    it("leaver does not dispute a timeout after leaving the channel", async function () {
        const h = TestSession.getHarness();
        // peer 0 leaves the channel but stays on-chain (leave snapshot suppressed),
        // then is isolated. with no p2p blocks it sees a phantom timeout for the
        // next writer -> but it's no longer an off-chain participant, so it must
        // NOT dispute.
        await h.lifecycle.timeoutSetup(4, 0, {
            timeConfig: { agreementTime: 2, evidenceTime: 8 }
        });

        // Skip leave snapshot so peer 0 stays dispute-eligible on-chain.
        await h.control(h.getPeer(0)).stub.stubPostStateSnapshot().request();
        //  peer 0 is leaving (off chain)
        await h.transition.advanceState({
            txFn: (c) => c.leaveChannel(),
            waitForFinalization: true
        });
        const remaining = [1, 2, 3];
        h.context.leftChannelPeerIndices = [0];

        // isolate peer 0 so it stops receiving p2p blocks -> its timeout timer
        // for the next block fires naturally.
        await h.byzantine.disconnect(0);
        h.contextApi.markAfkPeer({ afkPeerIndex: 0 });

        // remaining peers advance past peer 0.
        await h.transition.advanceState({
            waitForPeers: remaining,
            waitForFinalization: true
        });

        await h.event.waitWhileEventCountsStayAtMost(
            "onInitiatingDispute",
            [0],
            {
                durationMs: 8000,
                maxCount: 0
            }
        );
    });

    it("dispute.input.timeout.blockHeight = block whose calldata is on-chain; isForced=true → TimeoutCalldataPosted", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.timeoutSetup(4, 0, {
            timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
        });

        // Establish height 1 so the calldata block does not receive first-block grace.
        await h.transition.advanceState({ count: 2 });
        const calldataAuthor = await h.query.getNextPeerToWrite();

        // Peer 3 cannot confirm height 2, so the author must post it as calldata.
        await h.execOnHost(h.getPeer(3), (sm) => {
            sm.ingestBlockConfirmation = async () => false;
        });
        await Promise.all(
            [0, 1, 2, 3].map((peerIndex) =>
                h.execOnHost(h.getPeer(peerIndex), (sm) => {
                    Object.defineProperty(sm, "tryTimeoutParticipant", {
                        value: async () => undefined
                    });
                })
            )
        );
        await h.network.disconnectPeer(3);
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2],
            waitForFinalization: false
        });
        await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2, 3], 1, {
            mode: "atLeast",
            timeoutMs: 15000
        });

        // Construct the committed output for the same participant blamed by
        // the timeout. Mutating the participant afterwards invalidates the
        // dispute output before TimeoutCalldataPosted is even evaluated.
        await h.tamper.plantFreshTimeoutForParticipant(
            3,
            calldataAuthor.address
        );
        await sleep(h.event.evidencePeriodWaitMs());

        h.contextApi.captureOriginalFork();
        h.event.resetEventSpies();
        await h.tamper.postTamperedDispute(3, (dispute) => {
            dispute.input.timeout.isForced = true;
        });

        await h.event.waitForPeers("onDisputeKilled", [0, 1, 2], 1, {
            mode: "atLeast",
            timeoutMs: 25000
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType: DisputeFraudProofType.TimeoutCalldataPosted,
            peerIndices: [0, 1, 2],
            timeoutMs: 15000
        });

        const slashed = (
            await h.channelManager.getOnChainSlashedParticipants(h.channelId)
        ).map((address) => address.toLowerCase());
        for (const peerIndex of [0, 1, 2]) {
            expect(slashed).not.to.include(
                h.getPeer(peerIndex).address.toLowerCase()
            );
        }
    });
});
