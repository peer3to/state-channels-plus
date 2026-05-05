import { DisputeFraudProofType, FraudProofType } from "@/types/sol-enums";
import {
    tryDecodeCustomError,
    Codec,
    Type,
    hash,
    addressesEqual
} from "@/utils";
import {
    DisputeTampering,
    MathTestSession as TestSession,
    expectSignedBlocksOnlyStateProof,
    sleep
} from "@test/harness";
import {
    hash as randomHash,
    blockStructWithTransactionHeader
} from "@test/factory";
import { expect } from "chai";
import { ethers } from "ethers";

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

        it("mid signedBlock header ≠ input → ErrorDisputeStateProofHeaderChannelMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer({
                count: 3,
                disconnectedPeerIndex: 3
            });

            try {
                await h.tamper.postTamperedDispute(1, async (dispute) => {
                    const proof = dispute.input.stateProof;
                    expect(
                        proof.signedBlocks.length,
                        "need ≥3 signedBlocks to target a mid index"
                    ).to.be.greaterThanOrEqual(3);
                    const midIndex = Math.floor(proof.signedBlocks.length / 2);
                    await h.tamper.rewriteSignedBlockAtIndex(
                        dispute,
                        midIndex,
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

        it("mid milestone header ≠ input → ErrorDisputeStateProofHeaderChannelMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            try {
                await h.tamper.postTamperedDispute(0, async (dispute) => {
                    const milestones = dispute.input.stateProof.milestones;
                    expect(
                        milestones.length,
                        "need ≥3 milestones to target a mid milestone"
                    ).to.be.greaterThanOrEqual(3);
                    const midMilestoneIndex = Math.floor(milestones.length / 2);
                    const bcs =
                        milestones[midMilestoneIndex].blockConfirmations;
                    expect(
                        bcs.length,
                        "mid milestone must have at least one blockConfirmation"
                    ).to.be.greaterThanOrEqual(1);
                    const midBlockIndex = Math.floor(bcs.length / 2);
                    await h.tamper.rewriteMilestoneSignedBlockAtIndex(
                        dispute,
                        midMilestoneIndex,
                        midBlockIndex,
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
        it("mid signedBlock forkId ≠ input → DisputeStateProofForkMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer({
                count: 3,
                disconnectedPeerIndex: 3
            });

            h.tamper.stubConstructDispute(
                0,
                async (dispute) => {
                    expectSignedBlocksOnlyStateProof(dispute.input.stateProof);
                    const proof = dispute.input.stateProof;
                    expect(
                        proof.signedBlocks.length,
                        "need ≥3 signedBlocks to target a mid index"
                    ).to.be.greaterThanOrEqual(3);
                    const midIndex = Math.floor(proof.signedBlocks.length / 2);
                    await h.tamper.rewriteSignedBlockAtIndex(
                        dispute,
                        midIndex,
                        (bs) =>
                            blockStructWithTransactionHeader(bs, {
                                forkId: randomHash()
                            })
                    );
                },
                { autoRestore: true }
            );

            await h.byzantine.submitDoubleSignBlock(2);

            await h.assert.dispute.initiatedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeStateProofForkMismatch,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        });

        it("mid milestone forkId ≠ input → DisputeStateProofForkMismatch", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            await h.tamper.postTamperedDispute(0, async (dispute) => {
                const milestones = dispute.input.stateProof.milestones;
                expect(
                    milestones.length,
                    "need ≥3 milestones to target a mid milestone"
                ).to.be.greaterThanOrEqual(3);
                const midMilestoneIndex = Math.floor(milestones.length / 2);
                const bcs = milestones[midMilestoneIndex].blockConfirmations;
                expect(
                    bcs.length,
                    "mid milestone must have at least one blockConfirmation"
                ).to.be.greaterThanOrEqual(1);
                const midBlockIndex = Math.floor(bcs.length / 2);
                await h.tamper.rewriteMilestoneSignedBlockAtIndex(
                    dispute,
                    midMilestoneIndex,
                    midBlockIndex,
                    (bs) =>
                        blockStructWithTransactionHeader(bs, {
                            forkId: randomHash()
                        })
                );
            });

            await h.event.waitForPeers("onDisputeKilled", [1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeStateProofForkMismatch,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });

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
    });

    describe("disputerThrottle", function () {
        const evidenceTime = 2;

        it("second junk-forkId dispute from same peer is rejected while throttle is active", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 0, {
                timeConfig: { evidenceTime }
            });
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();

            // First dispute — opens a new window for a junk fork, throttle is set
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });

            // Second dispute from the same peer — throttle should block it
            try {
                await h.tamper.postTamperedDispute(1, (dispute) => {
                    dispute.input.forkId = randomHash();
                    dispute.input.timeout.participant = ethers.ZeroAddress;
                    dispute.input.onChainSlashes = [];
                    dispute.input.selfRemoval = true;
                });
                expect.fail("expected revert");
            } catch (error: unknown) {
                const customError = tryDecodeCustomError(error);
                expect(customError, "expected ErrorDisputeThrottled").to.not.be
                    .null;
                expect(
                    customError!.errorDescription.name,
                    "expected ErrorDisputeThrottled"
                ).to.equal("ErrorDisputeThrottled");
            }
        });

        it("dispute is allowed again after throttle window expires", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 0, {
                timeConfig: { evidenceTime }
            });
            await h.assert.sync.peersInSyncWait();
            h.event.resetEventSpies();

            // First dispute — sets the throttle
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });
            await sleep((evidenceTime + 1) * 1000);

            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.forkId = randomHash();
                dispute.input.timeout.participant = ethers.ZeroAddress;
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = true;
            });
        });
    });

    describe("latestInboundMessageBlockHash", function () {
        it("genesis hash (0x0) → accepted even when chain has inbound blocks", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();

            // bytes32(0) is the genesis anchor — always valid at upload time.
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.latestInboundMessageBlockHash = ethers.ZeroHash;
                dispute.input.lastInboundMessageBlockHeight = 0n;
            });
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

    describe("stateProof milestones (auditing calldata)", function () {
        it("M2 milestoneSnapshot junk latestInboundMessageBlockHash → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            await h.tamper.postTamperedDispute(0, (d, _dc, ad) => {
                if (!ad) {
                    throw new Error("expected calldata auditing data");
                }
                expect(
                    d.input.stateProof.milestones.length,
                    "need ≥2 milestones to target M2 snapshot"
                ).to.be.greaterThanOrEqual(2);
                expect(d.postedAuditingData).to.equal(true);
                ad.milestoneSnapshots[1]!.snapshotData.latestInboundMessageBlockHash =
                    randomHash();
                d.input.disputeAuditingDataHash = hash(
                    Codec.encode(ad, Type.DisputeAuditingData)
                );
            });

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });

        it("M2 auditing row shows M3 snapshot (skip-ahead) → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            await h.tamper.postTamperedDispute(
                0,
                (dispute, _dc, auditingData) => {
                    if (!auditingData) {
                        throw new Error("expected calldata auditing data");
                    }
                    expect(
                        auditingData.milestoneSnapshots.length,
                        "auditing must expose a snapshot per milestone proof"
                    ).to.be.greaterThanOrEqual(3);
                    // slot for M2 carries M3's full snapshot (hash won't match M2 proof's finalizedSnapshotHash).
                    auditingData.milestoneSnapshots[1] =
                        auditingData.milestoneSnapshots[2]!;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });

        it("M2 milestoneSnapshot inboundHash valid, stateSnapshot claims M1 (stay-back) → DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.junkDataMilestoneMultiLeaveSetup();

            await h.tamper.postTamperedDispute(
                0,
                (dispute, _dc, auditingData) => {
                    if (!auditingData) {
                        throw new Error("expected calldata auditing data");
                    }
                    expect(
                        auditingData.milestoneSnapshots.length,
                        "auditing must expose a snapshot per milestone proof"
                    ).to.be.greaterThanOrEqual(3);
                    // slot for M2 carries M1's full snapshot (hash won't match M2 proof's finalizedSnapshotHash).
                    auditingData.milestoneSnapshots[1] =
                        auditingData.milestoneSnapshots[0]!;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData, Type.DisputeAuditingData)
                    );
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });

        it("M2 milestone confirmed without expanding participant set — pending joiner excluded (colluding participants)", async function () {
            const h = TestSession.getHarness();
            const { pendingJoin } =
                await h.scenario.junkDataMilestoneM1InboundThenM2Setup();

            await h.tamper.postTamperedDispute(0, (d, _dc, ad) => {
                if (!ad) {
                    throw new Error("expected calldata auditing data");
                }
                expect(
                    d.input.stateProof.milestones.length,
                    "need ≥2 milestones to target M2 snapshot"
                ).to.be.greaterThanOrEqual(2);
                expect(d.postedAuditingData).to.equal(true);
                expect(
                    ad.milestoneSnapshots.length,
                    "auditing must align with milestone proofs"
                ).to.be.greaterThanOrEqual(2);
                const row = ad.milestoneSnapshots[1]!;
                row.snapshotData.participants =
                    row.snapshotData.participants.filter(
                        (p) => !addressesEqual(p, pendingJoin)
                    );
                d.input.disputeAuditingDataHash = hash(
                    Codec.encode(ad, Type.DisputeAuditingData)
                );
            });

            await h.event.waitForPeers("onDisputeKilled", [0, 1, 3], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof,
                timeoutMs: 15000,
                peerIndices: [1, 3]
            });
        });
    });
});
