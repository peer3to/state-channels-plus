import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    LAGGING_AUDITOR,
    appendInvalidTransition,
    appendNonAuthenticBlock,
    expectKilledByChallenge,
    expectLastRunHeights,
    expectNoChallengeThroughKillPeriod,
    onlyAuditorKills,
    prependStoredBlocks,
    reissueBlock,
    stageLaggingAuditorBelowChainAnchor,
    storedChallengeBlockIndex,
    uploadSelfRemovalDispute,
    withForgedBody
} from "@test/fixtures/ChallengeBoundaryStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Peer 2 lags: its mirror anchor is the genesis, its own final point is
// block 1, the chain anchor is block 2. Peer 1 is a current auditor (mirror
// and final point at block 2). Peer 3 submits.
const { laggingIndex: LAGGING } = LAGGING_AUDITOR;
const CURRENT = 1;
const SUBMITTER = 3;
const AUDITORS = [LAGGING, 0, CURRENT];
const APPLY =
    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof;

describe("E2E: dispute validation / lagging mirror and block-challenge target", function () {
    it("E33: an auditor whose mirror lags the chain anchor kills an eligible tail offense on chain at its position from the last milestone's start, the same position a current auditor stores; the lagging auditor is not slashed", async function () {
        const h = TestSession.getHarness();
        await stageLaggingAuditorBelowChainAnchor(h, { tailBlocks: 0 });
        const walks = await h.mirror.observe(LAGGING, "verifyMilestones");
        await onlyAuditorKills(h, LAGGING, AUDITORS);

        await uploadSelfRemovalDispute(
            h,
            SUBMITTER,
            async (dispute) => {
                expectLastRunHeights(dispute, [2]);
                await appendInvalidTransition(h, dispute, SUBMITTER);
            },
            { markMalicious: true }
        );

        await expectKilledByChallenge(h, {
            proofType: APPLY,
            auditorIndices: AUDITORS,
            slashedIndices: [SUBMITTER]
        });
        expect(await storedChallengeBlockIndex(h, LAGGING, APPLY)).to.equal(1);
        expect(await storedChallengeBlockIndex(h, CURRENT, APPLY)).to.equal(1);
        // the lagging tiers failed and fell through to the chain's anchor
        const { local, chain } = await walks.observation();
        expect(local.reads).to.be.greaterThan(0);
        expect(chain.reads).to.be.greaterThan(0);
    });

    it("E33 ext: anchor in the middle of the last milestone → the lagging and the current auditor both target the shifted position (index 3), the lagging auditor's kill lands, only the submitter is slashed", async function () {
        const h = TestSession.getHarness();
        await stageLaggingAuditorBelowChainAnchor(h, { tailBlocks: 0 });
        await onlyAuditorKills(h, LAGGING, AUDITORS);

        await uploadSelfRemovalDispute(
            h,
            SUBMITTER,
            async (dispute) => {
                await prependStoredBlocks(h, dispute, [0, 1]);
                await appendInvalidTransition(h, dispute, SUBMITTER);
                expectLastRunHeights(dispute, [0, 1, 2, 3]);
            },
            { markMalicious: true }
        );

        await expectKilledByChallenge(h, {
            proofType: APPLY,
            auditorIndices: AUDITORS,
            slashedIndices: [SUBMITTER]
        });
        expect(await storedChallengeBlockIndex(h, LAGGING, APPLY)).to.equal(3);
        expect(await storedChallengeBlockIndex(h, CURRENT, APPLY)).to.equal(3);
    });

    it("E33 ext: structure fault at the position following the boundary (index 3 after the anchor at index 2) → the lagging auditor's DisputeInvalidBlockStructure names index 3 and kills the dispute, only the submitter is slashed", async function () {
        const h = TestSession.getHarness();
        await stageLaggingAuditorBelowChainAnchor(h, { tailBlocks: 0 });
        await onlyAuditorKills(h, LAGGING, AUDITORS);

        await uploadSelfRemovalDispute(
            h,
            SUBMITTER,
            async (dispute) => {
                await prependStoredBlocks(h, dispute, [0, 1]);
                await appendNonAuthenticBlock(h, dispute, SUBMITTER, 0);
                expectLastRunHeights(dispute, [0, 1, 2, 3]);
            },
            { markMalicious: true }
        );

        await expectKilledByChallenge(h, {
            proofType: DisputeFraudProofType.DisputeInvalidBlockStructure,
            auditorIndices: AUDITORS,
            slashedIndices: [SUBMITTER]
        });
        expect(
            await storedChallengeBlockIndex(
                h,
                LAGGING,
                DisputeFraudProofType.DisputeInvalidBlockStructure
            )
        ).to.equal(3);
    });

    it("E33 ext: forged block below the chain anchor (block 1, so the anchor at the boundary index no longer links) with an honest block after it → the lagging tiers fail, the chain tier replays from the anchor: no false accusation, no kill, the submitter is not slashed", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stageLaggingAuditorBelowChainAnchor(h, {
            tailBlocks: 1
        });
        const walks = await h.mirror.observe(LAGGING, "verifyMilestones");

        await uploadSelfRemovalDispute(
            h,
            SUBMITTER,
            async (dispute) => {
                expectLastRunHeights(dispute, [2, 3]);
                await prependStoredBlocks(h, dispute, [0, 1]);
                await reissueBlock(h, dispute, 1, withForgedBody);
            },
            { markMalicious: true }
        );

        await expectNoChallengeThroughKillPeriod(h, {
            forkId,
            auditorIndices: AUDITORS
        });
        const { local, chain } = await walks.observation();
        expect(local.reads, "the mirror tier must have run").to.be.greaterThan(
            0
        );
        expect(
            chain.reads,
            "the chain tier must have decided"
        ).to.be.greaterThan(0);
    });

    it("E33 ext: forged block below the chain anchor plus a genuine invalid transition two blocks after the anchor → the transition counter from the chain anchor names that block (index 4), the lagging auditor's kill lands, only the submitter is slashed", async function () {
        const h = TestSession.getHarness();
        await stageLaggingAuditorBelowChainAnchor(h, { tailBlocks: 1 });
        await onlyAuditorKills(h, LAGGING, AUDITORS);

        await uploadSelfRemovalDispute(
            h,
            SUBMITTER,
            async (dispute) => {
                expectLastRunHeights(dispute, [2, 3]);
                await prependStoredBlocks(h, dispute, [0, 1]);
                await reissueBlock(h, dispute, 1, withForgedBody);
                await appendInvalidTransition(h, dispute, SUBMITTER);
            },
            { markMalicious: true }
        );

        await expectKilledByChallenge(h, {
            proofType: APPLY,
            auditorIndices: AUDITORS,
            slashedIndices: [SUBMITTER]
        });
        expect(await storedChallengeBlockIndex(h, LAGGING, APPLY)).to.equal(4);
    });

    it("E33 ext: defect between the mirror anchor (genesis) and the chain anchor (block 2) in a proof ending at the chain anchor → the local failure reaches the chain check, which protects it: no block-specific challenge, no kill", async function () {
        const h = TestSession.getHarness();
        const { forkId } = await stageLaggingAuditorBelowChainAnchor(h, {
            tailBlocks: 0
        });
        const walks = await h.mirror.observe(LAGGING, "verifyMilestones");

        await uploadSelfRemovalDispute(
            h,
            SUBMITTER,
            async (dispute) => {
                expectLastRunHeights(dispute, [2]);
                await prependStoredBlocks(h, dispute, [0, 1]);
                await reissueBlock(h, dispute, 1, withForgedBody);
            },
            { markMalicious: true }
        );

        await expectNoChallengeThroughKillPeriod(h, {
            forkId,
            auditorIndices: AUDITORS
        });
        const { local, chain } = await walks.observation();
        expect(local.reads, "the mirror tier must have run").to.be.greaterThan(
            0
        );
        expect(
            chain.reads,
            "the chain tier must have decided"
        ).to.be.greaterThan(0);
    });

    it("E33 ext: the same defect below the chain anchor plus an invalid transition right after the chain cutoff (control) → escalates on chain: the lagging auditor's transition counter names index 3, only the submitter is slashed", async function () {
        const h = TestSession.getHarness();
        await stageLaggingAuditorBelowChainAnchor(h, { tailBlocks: 0 });
        await onlyAuditorKills(h, LAGGING, AUDITORS);

        await uploadSelfRemovalDispute(
            h,
            SUBMITTER,
            async (dispute) => {
                expectLastRunHeights(dispute, [2]);
                await prependStoredBlocks(h, dispute, [0, 1]);
                await reissueBlock(h, dispute, 1, withForgedBody);
                await appendInvalidTransition(h, dispute, SUBMITTER);
            },
            { markMalicious: true }
        );

        await expectKilledByChallenge(h, {
            proofType: APPLY,
            auditorIndices: AUDITORS,
            slashedIndices: [SUBMITTER]
        });
        expect(await storedChallengeBlockIndex(h, LAGGING, APPLY)).to.equal(3);
    });
});
