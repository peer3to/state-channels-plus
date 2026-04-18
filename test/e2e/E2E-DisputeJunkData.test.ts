import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import { tryDecodeCustomError } from "@/utils";
import {
    DisputeTampering,
    TestSession,
    PeerTestHarness,
    expectSignedBlocksOnlyStateProof
} from "@test/harness";
import {
    hash as randomHash,
    blockStructWithTransactionHeader
} from "@test/factory";
import { expect } from "chai";
import { ethers } from "ethers";

PeerTestHarness.setDefaultLogLevel("error");

function expectDecodedError(
    error: unknown,
    name: string,
    failMessage: string
): void {
    const customError = tryDecodeCustomError(error);
    expect(customError, failMessage).to.not.be.null;
    expect(customError!.errorDescription.name, failMessage).to.equal(name);
}

describe("E2E: dispute junk data", function () {
    describe("channelId", function () {
        it("wrong input channel → ErrorCantParticipateInDispute", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.input.channelId = randomHash();
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorCantParticipateInDispute",
                    "expected ErrorCantParticipateInDispute"
                );
            }
        });

        it("signedBlock header ≠ input → ErrorDisputeStateProofHeaderChannelMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            try {
                await h.tamper.postTamperedDispute(1, async (dispute) => {
                    await h.tamper.rewriteLastSignedBlockInDispute(
                        dispute,
                        (bs) =>
                            blockStructWithTransactionHeader(bs, {
                                channelId: randomHash()
                            })
                    );
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorDisputeStateProofHeaderChannelMismatch",
                    "expected ErrorDisputeStateProofHeaderChannelMismatch"
                );
            }
        });

        it("milestone header ≠ input → ErrorDisputeStateProofHeaderChannelMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            try {
                await h.tamper.postTamperedDispute(3, async (dispute) => {
                    await h.tamper.rewriteLastMilestoneSignedBlockInDispute(
                        dispute,
                        (bs) =>
                            blockStructWithTransactionHeader(bs, {
                                channelId: randomHash()
                            })
                    );
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorDisputeStateProofHeaderChannelMismatch",
                    "expected ErrorDisputeStateProofHeaderChannelMismatch"
                );
            }
        });
    });

    describe("forkId", function () {
        it("genesis-only junk fork commits; honest peers unchanged", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 0, {
                timeConfig: { evidenceTime: 6 }
            });
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();
            h.contextApi.captureOriginalFork();
            const originalForkId = h.context.originalForkId!;

            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });

            for (const p of h.getHonestPeers()) {
                expect(p.stateManager.forkId).to.equal(originalForkId);
            }

            await h.event.waitWhileEventCountsStayAtMost(
                "onDisputeKilled",
                [0, 1, 2],
                { durationMs: 6000 }
            );
        });

        it("input forkId ≠ signed proof headers → ErrorDisputeStateProofHeaderForkMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();

            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                    dispute.input.forkId = randomHash();
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorDisputeStateProofHeaderForkMismatch",
                    "expected ErrorDisputeStateProofHeaderForkMismatch"
                );
            }
        });

        it("milestone header fork ≠ input → ErrorDisputeStateProofHeaderForkMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            try {
                await h.tamper.postTamperedDispute(3, async (dispute) => {
                    await h.tamper.rewriteLastMilestoneSignedBlockInDispute(
                        dispute,
                        (bs) =>
                            blockStructWithTransactionHeader(bs, {
                                forkId: randomHash()
                            })
                    );
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorDisputeStateProofHeaderForkMismatch",
                    "expected ErrorDisputeStateProofHeaderForkMismatch"
                );
            }
        });
    });

    describe("latestInboundMessageBlockHash", function () {
        it("junk hash → ErrorDisputeLatestInboundMessageBlockHashInvalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });

            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.input.latestInboundMessageBlockHash = randomHash();
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorDisputeLatestInboundMessageBlockHashInvalid",
                    "expected ErrorDisputeLatestInboundMessageBlockHashInvalid"
                );
            }
        });
    });

    describe("lastInboundMessageBlockHeight", function () {
        it("junk height → ErrorDisputeLastInboundMessageBlockHeightInvalid", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });

            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.input.lastInboundMessageBlockHeight = 999999n;
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorDisputeLastInboundMessageBlockHeightInvalid",
                    "expected ErrorDisputeLastInboundMessageBlockHeightInvalid"
                );
            }
        });
    });

    describe("disputeAuditingDataHash", function () {
        it("with calldata: hash mismatch → ErrorAuditingDataHashMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            try {
                await h.tamper.postTamperedDispute(3, (dispute) => {
                    DisputeTampering.tamperAuditingDataHash(dispute);
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorAuditingDataHashMismatch",
                    "expected ErrorAuditingDataHashMismatch"
                );
            }
        });

        it("no calldata: wrong hash still resolves double-sign", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });

            h.tamper.stubConstructDispute(
                0,
                DisputeTampering.tamperAuditingDataHash,
                {
                    autoRestore: true,
                    markMalicious: false
                }
            );

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedAndCommitedWait();

            h.assert.storage.honestPeersStoredFraudProof({
                fraudProofType: FraudProofType.BlockDoubleSign,
                maliciousPeerIndex: 1
            });

            await h.dispute.resolveDisputeWait();

            await h.assert.sync.maliciousPeerExcluded();
            await h.assert.sync.participantCount({ expectedCount: 2 });
        });
    });

    describe("disputer", function () {
        it("wrong disputer → ErrorDisputerNotMsgSender", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();

            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.input.disputer = ethers.ZeroAddress;
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                expectDecodedError(
                    error,
                    "ErrorDisputerNotMsgSender",
                    "expected ErrorDisputerNotMsgSender"
                );
            }
        });
    });

    describe("selfRemoval", function () {
        it("toggle without recomputing output → DisputeInvalidOutputState", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });

            await h.tamper.postTamperedDispute(1, (dispute) => {
                DisputeTampering.junkSelfRemovalInconsistentOutputHash(dispute);
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidOutputState,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        });
    });

    // TODO
    describe.skip("stateProof milestones — [M1,M2] with different inbound hashes", function () {
        it("M2 milestoneSnapshot has junk inboundMessageBlockHash → DisputeInvalidStateProof", async function () {
            // Setup: 4+ peers, two participant transitions creating M1 and M2 (M1.inboundHash ≠ M2.inboundHash)
            // Action: tamper auditingData.milestoneSnapshots[1].snapshotData.latestInboundMessageBlockHash = junk
            // Expected: _deriveMilestoneUnionParticipants derives wrong pending set for M3 threshold
            //           → verifyMilestones fails → DisputeInvalidStateProof kills the dispute
        });

        it("M2 milestoneSnapshot inboundHash valid, stateSnapshot at M2 — honest case must NOT be killed", async function () {
            // This is the positive/correct case: the dispute is honest.
            // Expected: verifyStateProof passes, dispute survives and wins the window.
        });

        it("M2 milestoneSnapshot inboundHash valid, stateSnapshot claims M3 (skip-ahead) → DisputeInvalidStateProof", async function () {
            // Action: tamper auditingData.milestoneSnapshots[1] with M3's snapshotData
            // Expected: verifyMilestones detects finalizedSnapshotHash mismatch → DisputeInvalidStateProof
        });

        it("M2 milestoneSnapshot inboundHash valid, stateSnapshot claims M1 (stay-back) → DisputeInvalidStateProof", async function () {
            // Action: tamper auditingData.milestoneSnapshots[1] with M1's snapshotData
            // Expected: verifyMilestones detects finalizedSnapshotHash mismatch → DisputeInvalidStateProof
        });

        it("M2 milestone confirmed without expanding participant set — pending joiner excluded (colluding participants)", async function () {
            // Setup: peer joins on-chain between M1 and M2 (pending in inbound chain); M1 participants collude.
            // Action: tamper milestoneSnapshots[1].snapshotData.participants to omit the pending joiner;
            //         supply only original M1-participants' block confirmations (threshold appears met).
            // Expected: _deriveMilestoneUnionParticipants reads on-chain inbound hash and includes the
            //           pending joiner → supplied confirmations fall short of threshold
            //           → verifyMilestones fails → DisputeInvalidStateProof
        });
    });
});
