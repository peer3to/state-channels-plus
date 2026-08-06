import { expect } from "chai";
import { Codec, Type } from "@/utils";
import { DisputeFraudProofType } from "@/types/sol-enums";
import Block from "@/models/Block";
import {
    hash as randomHash,
    randomAddress,
    blockStructWithTransactionHeader
} from "@test/factory";
import { MathTestSession as TestSession } from "@test/harness";

// the auditor's contract: verdict + the exact stored fraud proof. the
// kill/counter-dispute/slash cascades stay owned by test/e2e/disputeValidation.
describe("Unit: DisputeValidationService", function () {
    describe("inbound hash", function () {
        it("tampered latestInboundMessageBlockHash not in chain -> false + DisputeInboundHashNotInChain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            dispute.input.latestInboundMessageBlockHash = randomHash();

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInboundHashNotInChain
            );
            expect(run.storedProof?.proofParticipant).to.equal(
                h.getPeer(0).address
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });
    });

    describe("state proof decode", function () {
        it("undecodable state-proof block, no posted auditing data -> audit skipped, true, zero proofs", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);

            const bc =
                dispute.input.stateProof.milestones[0].blockConfirmations[0];
            bc.signedBlock.encodedBlock = randomHash(); // 32 junk bytes -> Block decode throws

            const run = await h.dispute.auditDispute(1, dispute);
            // pinned skip path: no fireable fraud proof without posted data
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    describe("header + structure", function () {
        it("milestone block header channelId mismatched -> false + DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            const bc = dispute.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.at(-1)!;
            const block = Codec.decode(bc.signedBlock.encodedBlock, Type.Block);
            // sanity: the honest header matches dispute.input before the tamper
            expect(block.transaction.header.channelId).to.equal(
                dispute.input.channelId
            );
            const author = h.peers.find(
                (p) => p.address === block.transaction.header.participant
            )!;
            bc.signedBlock = (
                await Block.fromBlockStruct(
                    blockStructWithTransactionHeader(block, {
                        channelId: randomHash()
                    }),
                    author.signer
                )
            ).signedBlock;

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofHeaderMismatch
            );
        });

        it("milestone block header forkId mismatched -> false + DisputeStateProofHeaderMismatch", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            const bc = dispute.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.at(-1)!;
            const block = Codec.decode(bc.signedBlock.encodedBlock, Type.Block);
            expect(block.transaction.header.forkId).to.equal(
                dispute.input.forkId
            );
            const author = h.peers.find(
                (p) => p.address === block.transaction.header.participant
            )!;
            bc.signedBlock = (
                await Block.fromBlockStruct(
                    blockStructWithTransactionHeader(block, {
                        forkId: randomHash()
                    }),
                    author.signer
                )
            ).signedBlock;

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofHeaderMismatch
            );
        });

        it("unfinalized milestone block with an invalid author signature -> false + DisputeInvalidBlockStructure naming the block", async function () {
            const h = TestSession.getHarness();
            // unfinalized head (pending inbound join) -> the tampered tail sits
            // in the unfinalized part the structure check walks
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);

            const confirmations =
                dispute.input.stateProof.milestones.at(-1)!.blockConfirmations;
            expect(confirmations.length).to.equal(1);
            const source = confirmations.at(-1)!;
            // author signature swapped for a confirmation signature -> invalid
            expect(source.signatures[0]).to.not.equal(
                source.signedBlock.signature
            );
            confirmations.push({
                signedBlock: {
                    encodedBlock: source.signedBlock.encodedBlock,
                    signature: source.signatures[0]
                },
                signatures: []
            });

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockStructure
            );
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockStructure
            );
            // the unfinalized part is the milestone's confirmations after its
            // head -> the appended copy is its sole entry, index 0
            expect(
                Number(evidence.blockIndexInUnfinalizedPartOfStateProof)
            ).to.equal(0);
        });
    });

    describe("other checks", function () {
        it("tampered latestStateSnapshotHash -> false + DisputeInvalidStateProof after replay", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            dispute.input.latestStateSnapshotHash = randomHash();

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("onChainSlashes padded with an unslashed address -> false + DisputeOnChainSlashesNotSubset", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            const outsider = randomAddress();
            dispute.input.onChainSlashes = [
                ...dispute.input.onChainSlashes,
                outsider
            ];

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeOnChainSlashesNotSubset
            );
        });

        it("state proof truncated below disputer's latest signed block -> false + DisputeNotLatestState embedding the newer block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 5);
            const forkId = h.activeForkId!;

            // truncate host-side so input hashes stay consistent with the
            // shorter proof (same recipe as the notLatestState e2e)
            await h.tamper.stubConstructDispute(
                0,
                async (dispute, sm) => {
                    await sm.p2pManager.localRpc.dispute.truncateStateProofToHeight(
                        dispute,
                        2
                    );
                },
                { autoRestore: true }
            );
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            // sanity: the auditor knows a newer block signed by the disputer
            const disputer = h.getPeer(0).address;
            const seen = await h.execOnHost(
                h.getPeer(1),
                async (sm, args) => {
                    const result =
                        sm.agreementManager.getLatestSignedBlockByParticipant(
                            args.forkId,
                            args.disputer
                        );
                    return { height: result ? result.block.height : -1 };
                },
                { forkId, disputer }
            );
            expect(seen.height).to.be.greaterThan(2);

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeNotLatestState
            );
            // the evidence embeds the newer block + the disputer's signature
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeNotLatestState
            );
            const newerBlock = Codec.decode(evidence.encodedBlock, Type.Block);
            expect(
                Number(newerBlock.transaction.header.transactionCnt)
            ).to.equal(seen.height);
            const recovered = await Block.fromSignedBlock({
                encodedBlock: evidence.encodedBlock,
                signature: evidence.signature
            }).signatureToAddress(evidence.signature as string);
            expect(recovered).to.equal(disputer);
        });

        it("honest dispute at head: latest signed height equals snapshot height -> equality not flagged, true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const forkId = h.activeForkId!;
            // self-removal gives the dispute a genuine reason (hasDisputeReason)
            // without needing an on-chain timeout window
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.input.selfRemoval).to.equal(true);

            // sanity: exactly at the boundary the strict `>` must not flag
            const disputer = h.getPeer(0).address;
            const seen = await h.execOnHost(
                h.getPeer(1),
                async (sm, args) => {
                    const result =
                        sm.agreementManager.getLatestSignedBlockByParticipant(
                            args.forkId,
                            args.disputer
                        );
                    return { height: result ? result.block.height : -1 };
                },
                { forkId, disputer }
            );
            expect(seen.height).to.equal(
                Number(auditingData.latestStateSnapshot.blockHeight)
            );

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("fully valid untampered dispute over real history -> true, zero proofs stored", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 5);
            // self-removal is the dispute's stated reason (see boundary test)
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.input.selfRemoval).to.equal(true);

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });
});
