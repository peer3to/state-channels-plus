import { expect } from "chai";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { tryDecodeCustomError, addressesEqual } from "@/utils";
import { TimeoutTooEarlyStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";

describe("E2E: dispute validation / disputeInputFields / timeout", function () {
    it("dispute.input.timeout.blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState", async function () {
        const h = TestSession.getHarness();
        // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
        await h.lifecycle.timeoutSetup(3);
        await h.assert.sync.peersInSyncWait();
        h.contextApi.captureOriginalFork();
        h.event.resetEventSpies();

        // Peer 2 submits a timeout dispute with the wrong blockHeight.
        h.tamper.stubConstructDispute(2, async (dispute) => {
            const { hasBlock, latestBlock } = await h
                .localDiamondView(1)
                .getLatestBlockFromStateProof(dispute.input.stateProof);
            const expectedHeight = hasBlock
                ? Number(latestBlock.transaction.header.transactionCnt) + 1
                : 0;
            dispute.input.timeout.blockHeight = expectedHeight + 1;
        });

        // No action needed — peer 0 never writes, so the timeout fires naturally.
        // Peer 1 will upload a valid timeout dispute; peer 2's dispute is tampered
        // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast"
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.TimeoutNotLinkedToLatestState,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
    });

    it("dispute.input.timeout.participant != next writer → TimeoutParticipantNotNext", async function () {
        const h = TestSession.getHarness();
        // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
        await h.scenario.preDisputeSetup();

        // Peer 0 submits a timeout dispute with the wrong participant.
        h.tamper.stubConstructDispute(0, (dispute) => {
            //  blame peer 1
            dispute.input.timeout.participant = h.getPeerHandle(1).address;
        });

        // No action needed — peer 2 never writes, so the timeout fires naturally.
        // Peer 1 will upload a valid timeout dispute; peer 0's dispute is tampered
        // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast"
        });

        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.TimeoutParticipantNotNext,
            timeoutMs: 10000
        });
        await h.dispute.resolveDisputeWait();
    });

    describe("TimeoutTooEarly", function () {
        it("dispute.input.timeout posted before wait period elapses → honest peers store TimeoutTooEarly", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // peer 2 is the silent non-writer → exclude from fork-change barrier.
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

            const slashedBefore =
                await h.channelManager.getOnChainSlashedParticipants(
                    h.channelId
                );

            await h.tamper.plantFreshTimeoutForNextWriter(0);
            await h.tamper.postTamperedDispute(0, () => {});

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType: DisputeFraudProofType.TimeoutTooEarly,
                timeoutMs: 10000
            });

            const disputerAddress = h.getPeerHandle(0).address;

            const slashedAfter =
                await h.channelManager.getOnChainSlashedParticipants(
                    h.channelId
                );
            expect(slashedAfter.length).to.be.greaterThan(slashedBefore.length);
            expect(
                slashedAfter.some((a: string) =>
                    addressesEqual(a, disputerAddress)
                )
            ).to.equal(true);
        });

        it("valid timeout dispute → no TimeoutTooEarly fraud proof stored (false-positive guard)", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // Mark the non-writer up front so honest-peer barriers (committedWait,
            // resolveDisputeWait) exclude peer 2.
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

            // Natural timeout: peer 2 never authors.
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 1],
                timeoutMs: 15000
            });

            // No honest peer should fire onDisputeKilled and none
            // should store ANY dispute fraud proof.
            await h.event.waitWhileEventCountsStayAtMost(
                "onDisputeKilled",
                [0, 1],
                { durationMs: 3000, maxCount: 0 }
            );
            for (const peer of [0, 1]) {
                const proofs = h.query
                    .getPeerStorage(peer)
                    .disputeFraudProofs.getDisputeFraudProofs();
                if (proofs.length > 0) {
                    const types = proofs.map((p) => p.proofType).join(", ");
                    throw new Error(
                        `Peer ${peer} stored ${proofs.length} dispute fraud proof(s) on a valid timeout dispute (types: ${types}) — pipeline false positive`
                    );
                }
            }

            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });

        it("forged TimeoutTooEarly against a legitimate timeout dispute → applyDisputeFraudProofs reverts ErrorInvalidFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // peer 2 does not write, so it will timeout naturally.
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 1],
                timeoutMs: 15000
            });

            try {
                await h.tamper.submitForgedFraudProof(
                    0,
                    DisputeFraudProofType.TimeoutTooEarly,
                    ({ genesisSnapshot }): TimeoutTooEarlyStruct => ({
                        genesisStateSnapshotData: genesisSnapshot.snapshotData,
                        previousBlockOnChainTimestamp: 0
                    })
                );
                expect.fail("expected revert");
            } catch (error: unknown) {
                const custom = tryDecodeCustomError(error);
                expect(
                    custom!.errorDescription.name,
                    "expected ErrorInvalidFraudProof"
                ).to.equal("ErrorInvalidFraudProof");
            }

            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });
    });

    it("dispute.input.timeout.blockHeight = fully-signed block height; disputer left off-chain → TimeoutThreshold", async function () {
        const h = TestSession.getHarness();
        // Leaver disputes without signing post-leave block 1 so validators reach TimeoutThreshold (not DisputeNotLatestState).
        await h.lifecycle.timeoutSetup(4, 0, {
            timeConfig: { agreementTime: 2, evidenceTime: 8 }
        });

        // Skip leave snapshot so peer 0 stays dispute-eligible on-chain.
        await h
            .getPeerHandle(0)
            .stub.stubMethod("postStateSnapshot", async () => undefined);

        // Tamper peer 0's scheduled timeout dispute: proof to H-1=0, claim height 1 / block-1 author.
        h.tamper.stubConstructDispute(
            0,
            async (dispute, _confirmation, auditingData) => {
                const corruptedAuditingData =
                    await h.tamper.truncateStateProofToHeight(dispute, {
                        disputerPeerIndex: 0,
                        targetHeight: 0
                    });

                Object.assign(auditingData!, corruptedAuditingData);
                const forkId = h.activeForkId!;
                const blockAtH = (await h
                    .getPeerHandle(1)
                    .blocks.queryBlockAt({ forkId, height: 1 }))!;
                dispute.input.timeout.blockHeight = 1n;
                dispute.input.timeout.participant = blockAtH.author;
            },
            { markMalicious: false }
        );

        await h.transition.advanceState({
            txFn: { op: "math.leaveChannel" },
            waitForFinalization: true
        });
        const remaining = [1, 2, 3];
        h.context.leftChannelPeerIndices = [0];

        // Isolate peer 0 so they don't locally sign block 1 (would trip DisputeNotLatestState).
        await h.byzantine.disconnect(0);
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

        await h.transition.advanceState({
            waitForPeers: remaining,
            waitForFinalization: true
        });

        h.contextApi.captureOriginalFork();
        h.event.resetEventSpies();

        // Peer 0 stuck before block 1; background timeout fires → stub tamper → TimeoutThreshold on 1/2/3.
        await h.event.waitForPeers("onDisputeKilled", [1, 2, 3], 1, {
            mode: "atLeast",
            timeoutMs: 15000
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType: DisputeFraudProofType.TimeoutThreshold,
            timeoutMs: 10000
        });
        // Dispute path kills tampered claim; slash/eligible-set update still settles fork.
        await h.dispute.resolveDisputeWait({
            forkSettleTimeoutMs: 20000,
            assertMaliciousRemoved: false
        });
    });

    it("dispute.input.timeout.blockHeight = block whose calldata is on-chain; isForced=true → TimeoutCalldataPosted", async function () {
        const h = TestSession.getHarness();
        // Peer 0 leaves with snapshot suppressed (stays dispute-eligible).
        //  Peer 3 withholds confirms → incomplete block-1 union → author posts calldata; peers 1/2 set onChainTimestamp.
        // Peer 2 never writes H=2 so a real timeout fires; tamper reframes peer 0's dispute (truncate proof, blame peer 1 @ H=1, isForced past calldata upload guard).
        await h.lifecycle.timeoutSetup(4, 0, {
            timeConfig: { agreementTime: 2, evidenceTime: 12 }
        });

        await h
            .getPeerHandle(0)
            .stub.stubMethod("postStateSnapshot", async () => undefined);

        // Falsely blame peer 1 @ H=1 (that block exists + calldata on-chain), truncate proof, isForced clears upload guard.
        h.tamper.stubConstructDispute(
            0,
            async (dispute, _confirmation, auditingData) => {
                const corruptedAuditingData =
                    await h.tamper.truncateStateProofToHeight(dispute, {
                        disputerPeerIndex: 0,
                        targetHeight: 0
                    });
                Object.assign(auditingData!, corruptedAuditingData);
                const forkId = h.activeForkId!;
                const blockAtH = (await h
                    .getPeerHandle(1)
                    .blocks.queryBlockAt({ forkId, height: 1 }))!;
                dispute.input.timeout.blockHeight = 1n;
                dispute.input.timeout.participant = blockAtH.author;
                dispute.input.timeout.isForced = true;
            },
            { markMalicious: false }
        );

        await h.transition.advanceState({
            txFn: { op: "math.leaveChannel" },
            waitForFinalization: true
        });
        h.context.leftChannelPeerIndices = [0];
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

        // Peer 3 withholds confirms → incomplete union → author posts calldata.
        await h.byzantine.stubBroadcast(3);

        // peer1 write the next block
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [1, 2, 3],
            waitForFinalization: false
        });

        // peer1 posts calldata
        await h.event.waitForPeers("onBlockCalldataPosted", [1, 2], 1, {
            mode: "atLeast",
            timeoutMs: 15000
        });

        h.contextApi.captureOriginalFork();
        h.event.resetEventSpies();
        //  peer 2 never writes, so the timeout fires naturally.

        // peer 1 and 2 kill the tampered dispute by peer 0
        await h.event.waitForPeers("onDisputeKilled", [1, 2], 1, {
            mode: "atLeast",
            timeoutMs: 25000
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType: DisputeFraudProofType.TimeoutCalldataPosted,
            peerIndices: [1, 2],
            timeoutMs: 15000
        });
        await h.dispute.resolveDisputeWait({
            forkSettleTimeoutMs: 25000,
            assertMaliciousRemoved: false
        });
    });
});
