import { BlockValidationResult } from "@/types";
import {
    DisputeFraudProofType,
    FraudProofType,
    toSolidityDisputeFraudProofType,
    toSolidityFraudProofType
} from "@/types/sol-enums";
import type { Address } from "@/types/types";
import { Codec, Type } from "@/utils";
import * as factory from "@test/factory";
import {
    simulatedFraudProofSlashes,
    stageFarFutureGenesisTail,
    stageOutsiderAuthoredTail,
    stagePendingAuditorForgedTail
} from "@test/fixtures/DisputeAuditStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("DisputeValidationStrategy", function () {
    it("returns false only for DISPUTE and throws impossible results", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        const matrix = await h
            .control(h.getPeer(0))
            .validation.probeDisputeStrategyResultMatrix()
            .request();

        expect(matrix.SUCCESS).to.equal("true");
        expect(matrix.DUPLICATE).to.equal("true");
        expect(matrix.DISPUTE).to.equal("false");
        expect(matrix.NOT_READY).to.equal("throw");
        expect(matrix.DISCONNECT).to.equal("throw");
        expect(matrix.BROADCAST).to.equal("throw");
        expect(matrix.NOT_ENOUGH_TIME).to.equal("throw");
    });

    it("an early outsider check without the resulting snapshot continues the replay; the union check without the executed snapshots throws", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(4, 0);
        await h.transition.advanceState();
        const result = await h
            .control(h.getPeer(0))
            .validation.probeMissingParticipantSnapshots()
            .request();

        expect(result.earlyAuthorResult).to.equal("SUCCESS");
        expect(result.signatureUnionError).to.match(
            /needs the executed participant snapshots/
        );
        expect(result.proofStored).to.equal(false);
    });

    it("an identical stored confirmation → noNewSignaturesOnExistingBlock → DUPLICATE, signature set untouched", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 1);
        const forkId = h.activeForkId!;
        const bundle = await h
            .control(h.getPeer(0))
            .query.getLatestBlockBundle(forkId)
            .request();
        const confirmation = Codec.decode(
            bundle!.encodedBlockConfirmation,
            Type.BlockConfirmation
        );

        const r = await h.transition.runStoredBlockMerge({
            peerIndex: 0,
            confirmation: {
                signedBlock: confirmation.signedBlock,
                signatures: confirmation.signatures.map(String)
            },
            strategy: "dispute"
        });

        expect(r.result).to.equal(BlockValidationResult.DUPLICATE);
        expect(r.persistedSignatures).to.have.members(
            bundle!.confirmationSignatures
        );
    });

    it("a same-author conflict at a stored height → doubleSignDetected stores BlockDoubleSign and the replay continues", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);
        const observer = h.getPeer(0);
        const forkId = h.activeForkId!;
        const [stored, prevBlock] = await Promise.all([
            h.control(observer).query.getBlockByHeight(forkId, 1).request(),
            h.control(observer).query.getBlockByHeight(forkId, 0).request()
        ]);
        const author = h.peers.find((p) => p.address === stored!.author)!;
        // same author, height, link and timestamp; a different snapshot hash
        const encoded = await factory.buildAndEncodeBlock(author.signer, {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: 1,
                participant: author.address as Address,
                timestamp: stored!.timestamp
            },
            previousBlockHash: prevBlock!.hash
        });

        const r = await h
            .control(observer)
            .validation.runBlockValidation(encoded, { strategy: "dispute" })
            .request();

        expect(r.firedHooks[0]).to.equal("doubleSignDetected");
        expect(r.resultName).to.equal("SUCCESS");
        expect(r.fraudProofType).to.equal(
            String(toSolidityFraudProofType(FraudProofType.BlockDoubleSign))
        );
        expect(r.disputedForkIds).to.deep.equal([]);
    });

    it("an unlinked conflict at a stored height → conflictingButNotLinkedBlockDetected continues, blockIsNotLinkedAndIsNotFirstBlock throws, no proof", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 2);
        const observer = h.getPeer(0);
        const forkId = h.activeForkId!;
        const stored = await h
            .control(observer)
            .query.getBlockByHeight(forkId, 1)
            .request();
        const other = h.peers.find((p) => p.address !== stored!.author)!;
        const encoded = await factory.buildAndEncodeBlock(other.signer, {
            header: {
                channelId: h.channelId,
                forkId,
                transactionCnt: 1,
                participant: other.address as Address
            },
            previousBlockHash: factory.hash()
        });

        const error = await h
            .control(observer)
            .validation.runBlockValidation(encoded, { strategy: "dispute" })
            .request()
            .then(
                () => null,
                (e: unknown) => String(e)
            );

        // the replay judges each block from the previous block of its run,
        // so an unlinked one is an invariant violation, never an abstain
        expect(error).to.match(
            /blockIsNotLinkedAndIsNotFirstBlock should not be called/
        );
        expect(
            await h
                .control(observer)
                .query.getDisputeFraudProofTypes()
                .request()
        ).to.deep.equal([]);
    });

    it("an outsider allegation is stored only when isBlockChallengeEligible answers true; false throws with no proof", async function () {
        const h = TestSession.getHarness();
        // no block is final by everyone: peer 0's proof is one run from
        // block 0, which the chain makes eligible; disconnected peer 2 holds
        // no block, so its dispute's proof is empty and nothing is eligible
        await h.scenario.preDisputeSetupDisconnectedPeer();
        const auditor = h.getPeer(0);
        const { dispute } = await h.dispute.fetchConstructedDispute(0);
        const { dispute: emptyDispute } =
            await h.dispute.fetchConstructedDispute(2);
        expect(dispute.input.stateProof.milestones).to.have.length(1);
        expect(emptyDispute.input.stateProof.milestones).to.have.length(0);
        const encodedBlockZero = Codec.encode(
            dispute.input.stateProof.milestones[0].blockConfirmations[0],
            Type.BlockConfirmation
        ) as string;
        const allege = (target: typeof dispute) =>
            h
                .control(auditor)
                .validation.runBlockValidation(encodedBlockZero, {
                    strategy: "dispute",
                    hook: "blockAuthorIsNotParticipant",
                    encodedDispute: Codec.encode(target, Type.Dispute) as string
                })
                .request();
        const proofTypes = () =>
            h.control(auditor).query.getDisputeFraudProofTypes().request();
        const eligibility = await h.mirror.observe(
            auditor.index,
            "isBlockChallengeEligible"
        );

        const ineligible = await allege(emptyDispute).then(
            () => null,
            (e: unknown) => String(e)
        );
        expect(ineligible).to.match(
            /which the chain does not make challengeable/
        );
        expect(await proofTypes()).to.deep.equal([]);
        // each allegation asks the chain once, right before it is stored
        expect((await eligibility.observation()).chain.answers).to.deep.equal([
            false
        ]);

        const eligible = await allege(dispute);
        expect(eligible.resultName).to.equal("DISPUTE");
        expect((await eligibility.observation()).chain.answers).to.deep.equal([
            false,
            true
        ]);
        expect(await proofTypes()).to.deep.equal([
            String(
                toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeBlockAuthorNotParticipant
                )
            )
        ]);
    });

    it("a pending participant replays a forged non-leader tail block from the posted finalized state → an InvalidStateTransition apply proof slashing its author", async function () {
        const h = TestSession.getHarness();
        const { auditor, release, offenderIndex, dispute, auditingData } =
            await stagePendingAuditorForgedTail(h);
        try {
            const run = await h.dispute.auditDispute(
                auditor.index,
                dispute,
                auditingData
            );
            expect(run).to.deep.include({
                outcome: "returned",
                isValid: false
            });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            const applied = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(applied.blockIndex)).to.equal(1);
            expect(Number(applied.fraudProof.proofType)).to.equal(
                toSolidityFraudProofType(
                    FraudProofType.BlockInvalidStateTransition
                )
            );
            const slashed = await simulatedFraudProofSlashes(
                h,
                auditor.index,
                applied.fraudProof
            );
            expect(slashed).to.include(h.getPeer(offenderIndex).address);
            expect(slashed).to.not.include(auditor.address);
        } finally {
            await release();
        }
    });

    it("a replayed tail block from the right author with a far-future timestamp → objectiveInvalidTimestampDetected stores an InvalidTimestamp apply proof", async function () {
        const h = TestSession.getHarness();
        const { auditor, dispute, auditingData } =
            await stageFarFutureGenesisTail(h);

        const run = await h.dispute.auditDispute(
            auditor.index,
            dispute,
            auditingData
        );

        expect(run).to.deep.include({ outcome: "returned", isValid: false });
        expect(run.storedProof?.disputeFraudProofType).to.equal(
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        );
        const applied = Codec.decode(
            run.storedProof!.encodedProof,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        );
        expect(Number(applied.blockIndex)).to.equal(0);
        expect(Number(applied.fraudProof.proofType)).to.equal(
            toSolidityFraudProofType(FraudProofType.InvalidTimestamp)
        );
    });

    it("an outsider-authored tail block whose resulting snapshot the auditor lacks → the replay passes the early author check and the leader check stores an InvalidStateTransition apply proof", async function () {
        const h = TestSession.getHarness();
        const { auditor, dispute, auditingData, outsiderBlockIndex } =
            await stageOutsiderAuthoredTail(h);

        const run = await h.dispute.auditDispute(
            auditor.index,
            dispute,
            auditingData
        );

        expect(run).to.deep.include({ outcome: "returned", isValid: false });
        expect(run.storedProof?.disputeFraudProofType).to.equal(
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        );
        const applied = Codec.decode(
            run.storedProof!.encodedProof,
            DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
        );
        expect(Number(applied.blockIndex)).to.equal(outsiderBlockIndex);
        expect(Number(applied.fraudProof.proofType)).to.equal(
            toSolidityFraudProofType(FraudProofType.BlockInvalidStateTransition)
        );
    });
});
