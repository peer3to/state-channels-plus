import { expect } from "chai";
import { ZeroHash } from "ethers";
import { Codec, hash, Type } from "@/utils";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Hash } from "@/types/types";
import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import {
    hash as randomHash,
    randomAddress,
    blockStructWithTransactionHeader
} from "@test/factory";
import { timeoutWaitTime } from "@/types";
import {
    MathTestSession as TestSession,
    resolveTestTimeConfig
} from "@test/harness";
import { DisputeTampering } from "@test/harness/actions/DisputeTamperingActions";

// the auditor's contract: verdict + the exact stored fraud proof. the
// kill/counter-dispute/slash cascades stay owned by test/e2e/disputeValidation.
describe("Unit: DisputeValidationService", function () {
    describe("inbound hash", function () {
        it("dispute.input.latestInboundMessageBlockHash = random -> false + DisputeInboundHashNotInChain", async function () {
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
        it("milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData false -> false + DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);

            const bc =
                dispute.input.stateProof.milestones[0].blockConfirmations[0];
            bc.signedBlock.encodedBlock = randomHash(); // 32 junk bytes -> Block decode throws

            const run = await h.dispute.auditDispute(1, dispute);
            // the proof carries no data from us: the chain recomputes finality
            // from the committed dispute, and an undecodable block can never be
            // final by everyone
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });

        it("signedBlocks[-1].encodedBlock = junk with no milestones AND postedAuditingData false -> audit skipped, true, no proof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute } = await h.dispute.fetchConstructedDispute(3);
            expect(dispute.postedAuditingData).to.equal(false);
            expect(dispute.input.stateProof.milestones.length).to.equal(0);
            expect(
                dispute.input.stateProof.signedBlocks.length
            ).to.be.greaterThan(0);

            dispute.input.stateProof.signedBlocks.at(-1)!.encodedBlock =
                randomHash();

            const run = await h.dispute.auditDispute(1, dispute);
            // project_dispute_gaps.md Gap 1, left open on purpose: with no
            // milestones the chain's _isLastMilestoneFinalByEveryone returns
            // true, so firing the proof slashes us instead of the disputer
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    describe("header + structure", function () {
        it("milestones[-1].blockConfirmations[-1] header.channelId = random -> false + DisputeStateProofHeaderMismatch", async function () {
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

        it("milestones[-1].blockConfirmations[-1] header.forkId = random -> false + DisputeStateProofHeaderMismatch", async function () {
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

        it("milestones[-1].blockConfirmations += copy signed by a confirmer -> false + DisputeInvalidBlockStructure at blockIndex 0", async function () {
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
        it("dispute.input.latestStateSnapshotHash = random -> false + DisputeInvalidStateProof", async function () {
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

        it("dispute.input.onChainSlashes += unslashed address -> false + DisputeOnChainSlashesNotSubset", async function () {
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

        it("stateProof truncated below the disputer's latest signed block -> false + DisputeNotLatestState carrying that block", async function () {
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

        it("disputer's latest signed height == latestStateSnapshot.blockHeight -> not flagged, true", async function () {
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

        it("untampered dispute over real history -> true, no proof", async function () {
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

    describe("posted auditing data", function () {
        it("milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk AND postedAuditingData true -> false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);

            const bc =
                dispute.input.stateProof.milestones[0].blockConfirmations[0];
            bc.signedBlock.encodedBlock = randomHash(); // junk -> Block decode throws

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });

        it("postedAuditingData true + matching auditingData -> verifyStateProof accepts, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            // self-removal is the dispute's stated reason (hasDisputeReason)
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("auditingData.latestStateSnapshot.timestamp += 1 (breaks disputeAuditingDataHash) -> false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);

            auditingData.latestStateSnapshot.timestamp =
                Number(auditingData.latestStateSnapshot.timestamp) + 1;
            // premise: the tamper broke the on-chain hash commitment
            expect(
                hash(Codec.encode(auditingData, Type.DisputeAuditingData))
            ).to.not.equal(dispute.input.disputeAuditingDataHash);

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("dispute.postedAuditingData = false on an unfinalized head -> false + DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);

            dispute.postedAuditingData = false;

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
        });

        it("auditingData.latestStateSnapshot.snapshotData.totalDeposits.amount += 1 -> false + DisputeInvalidBalanceInvariant", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forged = await h.tamper.buildForgedSnapshot(2, (ctx) => ({
                snapshotData: {
                    ...ctx.originalSnapshotData,
                    totalDeposits: {
                        ...ctx.originalSnapshotData.totalDeposits,
                        amount:
                            BigInt(
                                ctx.originalSnapshotData.totalDeposits.amount
                            ) + 1n
                    }
                }
            }));

            // same re-stitch as the balanceInvariant e2e: forged head block +
            // forged snapshot committed by the dispute's hashes
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(2);
            const proof = dispute.input.stateProof;
            if (proof.signedBlocks.length > 0) {
                proof.signedBlocks[proof.signedBlocks.length - 1] =
                    forged.forgedBlock.signedBlock;
            } else {
                const milestone = proof.milestones.at(-1)!;
                milestone.blockConfirmations[0] =
                    forged.forgedBlock.blockConfirmationStruct;
                auditingData.milestoneSnapshots[
                    auditingData.milestoneSnapshots.length - 1
                ] = forged.forgedSnapshot.toStruct();
            }
            auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
            dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
            dispute.postedAuditingData = true;

            const run = await h.dispute.auditDispute(0, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            );
        });

        it("auditingData.inboundMessageBlocks nonempty (real join) -> chain verified, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // premise: the join really put messages on the inbound chain
            expect(auditingData.inboundMessageBlocks.length).to.be.greaterThan(
                0
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        // the general shape: a real earlier inbound block, so
        // _isDisputeInboundHashValid still accepts it as an ancestor, while
        // snapshotData.latestInboundMessageBlockHeight already moved past it
        it("dispute.input.lastInboundMessageBlockHeight = an earlier real inbound block below snapshotData.latestInboundMessageBlockHeight -> false + DisputeInboundAnchorBehindLatestState", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupConsumedInboundTopUp();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);

            const control = h.control(h.getPeer(0));
            const headHash = (await control.query
                .getLatestInboundMessageHash()
                .request()) as Hash;
            const headHeight = (await control.query
                .getInboundLatestHeight()
                .request())!;
            const head = Codec.decode(
                (await control.query
                    .getInboundMessageBlock(headHash)
                    .request())!.encodedMessageBlock,
                Type.MessageBlock
            );
            const previousHash = head.previousBlockHash as Hash;
            const previousHeight = headHeight - 1;
            // premise: an earlier inbound block really exists, and the pinned
            // snapshot already sits on the head above it
            expect(previousHeight).to.be.greaterThan(0);
            expect(
                Number(
                    auditingData.latestStateSnapshot.snapshotData
                        .latestInboundMessageBlockHeight
                )
            ).to.equal(headHeight);

            dispute.input.latestInboundMessageBlockHash = previousHash;
            dispute.input.lastInboundMessageBlockHeight = previousHeight;

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInboundAnchorBehindLatestState
            );
            expect(run.storedProof?.proofParticipant).to.equal(
                h.getPeer(0).address
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });

        // boundary of the same rule: height 0 is the pre-genesis value, below
        // every snapshot (channel open already appends inbound block 1)
        it("dispute.input.latestInboundMessageBlockHash = ZeroHash AND lastInboundMessageBlockHeight = 0 -> false + DisputeInboundAnchorBehindLatestState", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // premise: the channel-open join left a nonzero inbound head
            expect(dispute.input.latestInboundMessageBlockHash).to.not.equal(
                ZeroHash
            );
            // premise: the pinned snapshot is already past the claimed height
            expect(
                Number(
                    auditingData.latestStateSnapshot.snapshotData
                        .latestInboundMessageBlockHeight
                )
            ).to.be.greaterThan(0);

            dispute.input.latestInboundMessageBlockHash = ZeroHash;
            dispute.input.lastInboundMessageBlockHeight = 0;

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInboundAnchorBehindLatestState
            );
            // pinned: the type is appended last, so its value must not move
            expect(
                DisputeFraudProofType.DisputeInboundAnchorBehindLatestState
            ).to.equal(217);
            expect(run.storedProof?.proofParticipant).to.equal(
                h.getPeer(0).address
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });

        // the other route into verifyDisputeOutput: validateDispute's
        // postedAuditingData branch instead of its else branch
        it("the same ZeroHash + height 0 pair on the posted-auditing-data path -> false + DisputeInboundAnchorBehindLatestState", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            expect(dispute.input.latestInboundMessageBlockHash).to.not.equal(
                ZeroHash
            );

            dispute.input.latestInboundMessageBlockHash = ZeroHash;
            dispute.input.lastInboundMessageBlockHeight = 0;

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInboundAnchorBehindLatestState
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });
    });

    describe("milestone finality + state proof anchor", function () {
        // tripwire for the skip below: a peer that joined mid-history still
        // syncs the pre-join blocks, so it holds the last milestone's first
        // block even though it never signed that milestone, and audits for real
        it("dispute.input.latestInboundMessageBlockHash = pre-join head -> joiner still holds milestones[-1].blockConfirmations[0], audits it", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath(); // peer 3 joins late
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            // claim the pre-join inbound head: still a real chain entry
            // (StateChannelCommon.sol:583-592), so the expected participant set
            // is the pre-join one and peer 3 is not part of it
            const inboundHead = await h
                .control(h.getPeer(0))
                .query.getInboundMessageBlock(
                    dispute.input.latestInboundMessageBlockHash
                )
                .request();
            expect(inboundHead, "expected the inbound head in storage").to.not
                .be.null;
            const headBlock = Codec.decode(
                inboundHead!.encodedMessageBlock,
                Type.MessageBlock
            );
            dispute.input.latestInboundMessageBlockHash =
                headBlock.previousBlockHash;
            dispute.input.lastInboundMessageBlockHeight =
                Number(headBlock.blockHeight) - 1;
            dispute.postedAuditingData = false;

            const lastMilestoneFirstBlock = Codec.decode(
                dispute.input.stateProof.milestones.at(-1)!
                    .blockConfirmations[0].signedBlock.encodedBlock,
                Type.Block
            );
            const joinerHas = await h
                .control(h.getPeer(3))
                .query.getBlockByHeight(
                    h.activeForkId!,
                    Number(
                        lastMilestoneFirstBlock.transaction.header
                            .transactionCnt
                    )
                )
                .request();
            expect(joinerHas, "joiner synced the pre-join block").to.not.be
                .null;

            // holding that block, the joiner runs the same audit as a peer that
            // signed the milestone - no skip
            const joiner = await h.dispute.auditDispute(3, dispute);
            const inSync = await h.dispute.auditDispute(1, dispute);
            expect(joiner.outcome).to.equal("returned");
            expect(joiner).to.deep.include({
                outcome: inSync.outcome,
                isValid: inSync.outcome === "returned" ? inSync.isValid : null
            });
        });

        // no test: the false branch of isLastMilestoneStoredLocally needs an
        // auditor that never stored the last milestone's first block.
        // _isLastMilestoneFinalByEveryone (DisputeFraudProofFacet.sol:764-775)
        // only reports final when every expected participant signed it, so a
        // participant auditor necessarily has it; while any participant is
        // disconnected no milestone forms at all (see "E2E: ... stateProof /
        // case3_signedBlocksOnly"); and a peer that joined after the milestone
        // still syncs it, pinned by the test above. only a peer that left the
        // channel is outside the expected set, and it no longer audits.
        it.skip("milestones[-1].blockConfirmations[0] missing from the auditor's block storage -> audit skipped", function () {});

        // the auditor rebuilds the inbound run the dispute names from its own
        // store, on both the settled and the posted path
        describe("inbound run the auditor does not hold", function () {
            /** A settled-path dispute naming an inbound head peer 2 misses. */
            const stageLaggingAuditor = async (
                h: ReturnType<typeof TestSession.getHarness>,
                laggingIndex: number
            ) => {
                await h.join.forceInboundJoinWait({
                    participant: h.getPeer(0).address,
                    observePeerIndices: h.peers
                        .map((peer) => peer.index)
                        .filter((index) => index !== laggingIndex)
                });
                await h
                    .control(h.getPeer(0))
                    .dispute.setForceExit(true)
                    .request();
                const { dispute } = await h.dispute.fetchConstructedDispute(0);
                expect(dispute.postedAuditingData).to.equal(false);
                const statedHead = dispute.input
                    .latestInboundMessageBlockHash as Hash;
                expect(
                    await h
                        .control(h.getPeer(laggingIndex))
                        .query.getInboundMessageBlock(statedHead)
                        .request(),
                    "auditor must not hold the stated inbound head"
                ).to.equal(null);
                return { dispute, statedHead };
            };

            it("settled path, unrecoverable gap -> audit abstains: true, zero proofs", async function () {
                const h = TestSession.getHarness();
                await h.setup(3);
                await h.lifecycle.openChannel();
                const lagging = 2;
                const held = await h.rpcStub.holdInboundMessageEvents(lagging);
                const { dispute } = await stageLaggingAuditor(h, lagging);

                const run = await h.dispute.auditDispute(lagging, dispute);

                // it used to be outcome "threw" (Block hash ... not found)
                expect(run).to.include({ outcome: "returned", isValid: true });
                // our own missing history is nobody's fraud
                expect(run.disputeFraudProofCount).to.equal(0);
                await held.release({ replay: false });
            });

            it("settled path, recoverable gap -> full audit, zero proofs, the run is now held", async function () {
                const h = TestSession.getHarness();
                await h.setup(3);
                await h.lifecycle.openChannel();
                const lagging = 2;
                const dropped = await h.rpcStub.dropInboundMessageLogs(lagging);
                const { dispute, statedHead } = await stageLaggingAuditor(
                    h,
                    lagging
                );
                await dropped.waitUntilDropped();

                const run = await h.dispute.auditDispute(lagging, dispute);

                expect(run).to.include({ outcome: "returned", isValid: true });
                expect(run.disputeFraudProofCount).to.equal(0);
                // it audited for real instead of abstaining
                expect(
                    await h
                        .control(h.getPeer(lagging))
                        .query.getInboundMessageBlock(statedHead)
                        .request(),
                    "the audit must have recovered the stated inbound head"
                ).to.not.equal(null);
                await dropped.release();
            });

            it("posted path with an emptied posted run + gap -> same abstain, zero proofs", async function () {
                const h = TestSession.getHarness();
                const lagging = 1;
                const { releaseLaggingInbound } =
                    await h.scenario.preDisputeSetupCalldataPath({
                        laggingInboundPeerIndex: lagging
                    });
                const { dispute, disputeConfirmation, auditingData } =
                    await h.dispute.fetchConstructedDispute(0);
                expect(dispute.postedAuditingData).to.equal(true);
                expect(
                    await h
                        .control(h.getPeer(lagging))
                        .query.getInboundMessageBlock(
                            dispute.input.latestInboundMessageBlockHash
                        )
                        .request(),
                    "auditor must not hold the stated inbound head"
                ).to.equal(null);

                // the attacker hands the auditor nothing: verifyStateProof never
                // binds the posted run to the dispute's stated head
                DisputeTampering.emptyPostedInboundRun(
                    dispute,
                    disputeConfirmation,
                    auditingData
                );

                const run = await h.dispute.auditDispute(
                    lagging,
                    dispute,
                    auditingData
                );

                expect(run).to.include({ outcome: "returned", isValid: true });
                expect(run.disputeFraudProofCount).to.equal(0);
                await releaseLaggingInbound?.();
            });
        });

        it("stateProof.milestones = [] AND signedBlocks = [] -> stored genesis snapshot + forkId == snapshotDataHash, true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // no blocks -> empty proof
            const forkId = h.activeForkId!;
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.input.stateProof.milestones.length).to.equal(0);
            expect(dispute.input.stateProof.signedBlocks.length).to.equal(0);

            // premises for the genesis branches: the dispute pins the genesis
            // snapshot and the forkId is its snapshot-data hash
            const genesisResult = await h
                .control(h.getPeer(1))
                .dispute.getGenesisSnapshotStruct(forkId)
                .request();
            const genesis = StateSnapshot.from(
                Codec.decode(genesisResult!.encodedSnapshot, Type.StateSnapshot)
            );
            expect(dispute.input.latestStateSnapshotHash).to.equal(
                genesis.hash
            );
            expect(dispute.input.forkId).to.equal(genesis.snapshotDataHash);

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("stateProof.signedBlocks only (partial-signature fork) -> anchored via previous block, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            await h.control(h.getPeer(3)).dispute.setForceExit(true).request();
            const { dispute } = await h.dispute.fetchConstructedDispute(3);
            expect(dispute.input.stateProof.milestones.length).to.equal(0);
            expect(
                dispute.input.stateProof.signedBlocks.length
            ).to.be.greaterThan(0);
            expect(dispute.postedAuditingData).to.equal(false);

            const run = await h.dispute.auditDispute(0, dispute);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("dispute.input.forkId = random on an empty stateProof -> no stored genesis, audit skipped, true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // empty proof -> genesis snapshot branch
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            // no reason stated -> the audited path ends in InvalidDisputeReason
            const audited = await h.dispute.auditDispute(1, dispute);
            expect(audited).to.include({ outcome: "returned", isValid: false });
            expect(audited.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.InvalidDisputeReason
            );

            // an unknown fork keeps passing the channel-scoped inbound check
            // (StateChannelCommon.sol:578-594) but has no stored genesis, so
            // the state proof anchor lookup skips the audit instead
            dispute.input.forkId = randomHash();
            const skipped = await h.dispute.auditDispute(1, dispute);
            expect(skipped).to.include({ outcome: "returned", isValid: true });
            expect(skipped.disputeFraudProofCount).to.equal(1); // from the audit above
        });

        it("localDiamond.isDisputeInboundHashValid false + RPC true -> no DisputeInboundHashNotInChain", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(4, 2);
            // the auditor stops applying inbound messages to its in-memory EVM
            // before the join, so only its local diamond falls behind
            await h
                .control(h.getPeer(1))
                .stub.stubLocalDiamondInboundMessages()
                .request();
            await h.join.forceInboundJoinWait();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);

            // premise: the two sources genuinely disagree on this dispute
            const sources = await h
                .control(h.getPeer(1))
                .dispute.probeDisputeInboundHashSources(
                    Codec.encode(dispute, Type.Dispute) as string
                )
                .request({ timeoutMs: 30000 });
            expect(sources).to.deep.equal({ local: false, rpc: true });

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run.outcome).to.equal("returned");
            expect(run.storedProof?.disputeFraudProofType).to.not.equal(
                DisputeFraudProofType.DisputeInboundHashNotInChain
            );
        });
    });

    describe("pipeline", function () {
        it("signedBlocks[-1].encodedBlock.stateSnapshotHash = ZeroHash -> false + DisputeInvalidBlockInStateProofApplyFraudProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            // rewrite host-side: the block is re-signed by its author, so
            // structure stays valid and only the replay catches it
            await h.tamper.stubConstructDispute(
                3,
                async (dispute, sm) => {
                    const svc = sm.p2pManager.localRpc.dispute;
                    await svc.rewriteLastSignedBlockInDispute(
                        dispute,
                        (bs) => ({
                            ...bs,
                            stateSnapshotHash: svc.zeroHash
                        })
                    );
                },
                { autoRestore: true }
            );
            const { dispute } = await h.dispute.fetchConstructedDispute(3);
            expect(dispute.input.stateProof.milestones.length).to.equal(0);

            const run = await h.dispute.auditDispute(0, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
        });

        // no test: the pipeline only sees false from
        // interpretFinalValidationResult(DISPUTE) (DisputeValidationStrategy.ts:110);
        // SUCCESS and DUPLICATE return true (:90, :97) and every other result
        // throws inside the strategy. each DISPUTE return stores its proof
        // immediately above it (:78-82, :153-160, :201-208, :224-225, :244-245,
        // :256-257, :328-329), so false-with-empty-proof-store has no producer
        it.skip("onBlockConfirmationStruct false with an empty disputeFraudProofs store -> throw", function () {});
    });

    describe("dispute output", function () {
        it("dispute.outputSnapshotDataHash = random -> false + DisputeInvalidOutputState", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            dispute.outputSnapshotDataHash = randomHash();

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidOutputState
            );
        });

        it("timeout.participant = 0 AND onChainSlashes = [] AND selfRemoval false -> false + InvalidDisputeReason", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            // premise: nothing states a reason
            expect(dispute.input.timeout.participant).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
            expect(dispute.input.onChainSlashes.length).to.equal(0);
            expect(dispute.input.selfRemoval).to.equal(false);

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.InvalidDisputeReason
            );
        });

        // verifyDisputeOutput's unlinked-auditing-data kill is covered under
        // "posted auditing data" by the two ZeroHash + height 0 cases
    });

    describe("replay", function () {
        it("same invalid dispute audited twice -> false both times, disputeFraudProofs stays at 1", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 5);
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

            const first = await h.dispute.auditDispute(1, dispute);
            expect(first).to.include({ outcome: "returned", isValid: false });
            expect(first.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeNotLatestState
            );
            expect(first.disputeFraudProofCount).to.equal(1);

            // replay: the store is keyed by dispute hash -> idempotent
            const second = await h.dispute.auditDispute(1, dispute);
            expect(second).to.include({ outcome: "returned", isValid: false });
            expect(second.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeNotLatestState
            );
            expect(second.disputeFraudProofCount).to.equal(1);
        });
    });

    describe("persistDisputeDataWithoutAudit", function () {
        it("includeUnfinalizedBlocks true -> stateProof.signedBlocks + latestStateSnapshot stored on a peer that missed them", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(
                dispute.input.stateProof.signedBlocks.length
            ).to.be.greaterThan(1);

            const p = await h.dispute.persistDisputeData(2, dispute, {
                auditingData,
                includeUnfinalizedBlocks: true
            });
            expect(p.threwMessage).to.equal(undefined);
            // the disconnected peer never saw these blocks - the persist is
            // what puts them (and the head snapshot) into its storage
            for (const item of p.signedBlocks) {
                expect(item.storedBefore, item.key).to.equal(false);
                expect(item.storedAfter, item.key).to.equal(true);
            }
            expect(p.snapshots[0].storedBefore).to.equal(false);
            expect(p.snapshots[0].storedAfter).to.equal(true);
        });

        it("includeUnfinalizedBlocks false -> stateProof.signedBlocks and latestStateSnapshot not stored", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(
                dispute.input.stateProof.signedBlocks.length
            ).to.be.greaterThan(1);

            const p = await h.dispute.persistDisputeData(2, dispute, {
                auditingData,
                includeUnfinalizedBlocks: false
            });
            expect(p.threwMessage).to.equal(undefined);
            for (const item of p.signedBlocks) {
                expect(item.storedAfter, item.key).to.equal(false);
            }
            expect(p.snapshots[0].storedAfter).to.equal(false);
        });

        it("disputeAuditingData undefined -> stateProof blocks stored, snapshots/messages/state untouched", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute } = await h.dispute.fetchConstructedDispute(3);

            const p = await h.dispute.persistDisputeData(2, dispute, {
                includeUnfinalizedBlocks: true
            });
            expect(p.threwMessage).to.equal(undefined);
            for (const item of p.signedBlocks) {
                expect(item.storedAfter, item.key).to.equal(true);
            }
            expect(p.snapshots).to.deep.equal([]);
            expect(p.stateMachineState).to.equal(undefined);
            expect(p.inboundMessages).to.deep.equal([]);
            expect(p.outboundMessages).to.deep.equal([]);
        });

        it('auditingData.latestFinalizedStateStateMachineState = "" -> state store skipped, blocks still stored', async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(
                auditingData.latestFinalizedStateStateMachineState
            ).to.not.equal("");

            // "" is DisputeManager's in-memory missing-state sentinel and is
            // not ABI-encodable -> applied host-side after decode
            const p = await h.dispute.persistDisputeData(2, dispute, {
                auditingData,
                includeUnfinalizedBlocks: true,
                latestFinalizedStateStateMachineStateOverride: ""
            });
            expect(p.threwMessage).to.equal(undefined);
            // the sentinel has no content-addressed key -> nothing is stored
            expect(p.stateMachineState).to.equal(undefined);
            for (const item of p.signedBlocks) {
                expect(item.storedAfter, item.key).to.equal(true);
            }
        });

        it("stateProof.signedBlocks[0].encodedBlock = junk -> skipped, decodable siblings stored", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(
                dispute.input.stateProof.signedBlocks.length
            ).to.be.greaterThan(1);
            dispute.input.stateProof.signedBlocks[0].encodedBlock =
                randomHash();

            const p = await h.dispute.persistDisputeData(2, dispute, {
                auditingData,
                includeUnfinalizedBlocks: true
            });
            expect(p.threwMessage).to.equal(undefined);
            expect(p.undecodableSignedBlockCount).to.equal(1);
            expect(p.signedBlocks.length).to.be.greaterThan(0);
            for (const item of p.signedBlocks) {
                expect(item.storedAfter, item.key).to.equal(true);
            }
        });

        it("milestones[0].blockConfirmations[0].signedBlock.encodedBlock = junk, no auditingData -> skipped, no throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(
                dispute.input.stateProof.milestones.length
            ).to.be.greaterThan(0);
            dispute.input.stateProof.milestones[0].blockConfirmations[0].signedBlock.encodedBlock =
                randomHash();

            const p = await h.dispute.persistDisputeData(1, dispute, {
                includeUnfinalizedBlocks: false
            });
            expect(p.threwMessage).to.equal(undefined);
            expect(p.undecodableMilestoneBlockCount).to.equal(1);
        });

        // the persist never decodes the last milestone's first block: the
        // finalized state is keyed by its own hash, so junk there only skips
        // that entry's block store
        it("milestones[-1].blockConfirmations[0].signedBlock.encodedBlock = junk + auditingData -> skipped, decodable siblings stored", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const lastMilestone = dispute.input.stateProof.milestones.at(-1)!;
            lastMilestone.blockConfirmations[0].signedBlock.encodedBlock =
                randomHash();

            const p = await h.dispute.persistDisputeData(1, dispute, {
                auditingData,
                includeUnfinalizedBlocks: true
            });
            expect(p.threwMessage).to.equal(undefined);
            expect(p.undecodableMilestoneBlockCount).to.equal(1);
            // the finalized state is persisted even though that block is junk
            expect(p.stateMachineState?.storedAfter).to.equal(true);
            for (const item of p.milestoneBlocks) {
                expect(item.storedAfter, item.key).to.equal(true);
            }
        });

        it("auditingData + decodable milestones[-1].blockConfirmations[0] -> finalized state stored under that block's snapshot stateMachineStateHash", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);

            // independent oracle: the key that block's own snapshot commits to
            const lastMilestoneFirstBlock = Codec.decode(
                dispute.input.stateProof.milestones.at(-1)!
                    .blockConfirmations[0].signedBlock.encodedBlock,
                Type.Block
            );
            const blockSnapshot = StateSnapshot.from(
                Codec.decode(
                    (await h
                        .control(h.getPeer(1))
                        .query.getStateSnapshotStructByHash(
                            lastMilestoneFirstBlock.stateSnapshotHash
                        )
                        .request())!.encodedSnapshot,
                    Type.StateSnapshot
                )
            );
            const committedStateHash = blockSnapshot.stateMachineStateHash;

            const p = await h.dispute.persistDisputeData(1, dispute, {
                auditingData,
                includeUnfinalizedBlocks: true
            });
            expect(p.threwMessage).to.equal(undefined);
            // content-addressing lands on the same word for honest data
            expect(p.stateMachineState?.key).to.equal(committedStateHash);
            expect(p.stateMachineState?.storedAfter).to.equal(true);
            expect(
                hash(auditingData.latestFinalizedStateStateMachineState)
            ).to.equal(committedStateHash);
        });

        it("auditingData.latestFinalizedStateStateMachineState = another real state -> stored under its own hash, the honest snapshot's key untouched", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const persister = h.control(h.getPeer(1));

            const lastMilestoneFirstBlock = Codec.decode(
                dispute.input.stateProof.milestones.at(-1)!
                    .blockConfirmations[0].signedBlock.encodedBlock,
                Type.Block
            );
            const blockSnapshot = StateSnapshot.from(
                Codec.decode(
                    (await persister.query
                        .getStateSnapshotStructByHash(
                            lastMilestoneFirstBlock.stateSnapshotHash
                        )
                        .request())!.encodedSnapshot,
                    Type.StateSnapshot
                )
            );
            const committedStateHash = blockSnapshot.stateMachineStateHash;
            const stateBefore = await persister.query
                .getStateMachineState(committedStateHash)
                .request();

            // a real state of the same channel from a different height - the
            // math machine's state changes on every transition
            const otherSnapshot = await persister.query
                .getStateSnapshotStructAt(
                    forkId,
                    blockSnapshot.blockHeight === 0 ? 1 : 0
                )
                .request();
            const otherStateHash = StateSnapshot.from(
                Codec.decode(otherSnapshot!.encodedSnapshot, Type.StateSnapshot)
            ).stateMachineStateHash;
            const otherState = await persister.query
                .getStateMachineState(otherStateHash)
                .request();
            // premise: the substituted bytes really are a different state
            expect(otherState).to.not.equal(stateBefore);

            const p = await h.dispute.persistDisputeData(1, dispute, {
                auditingData,
                includeUnfinalizedBlocks: true,
                latestFinalizedStateStateMachineStateOverride: otherState!
            });
            expect(p.threwMessage).to.equal(undefined);
            expect(p.stateMachineState?.key).to.equal(otherStateHash);
            // the honest key still holds the honest state - substituted bytes
            // only ever land under their own hash
            expect(
                await persister.query
                    .getStateMachineState(committedStateHash)
                    .request()
            ).to.equal(stateBefore);
            expect(
                await persister.query
                    .getStateMachineState(otherStateHash)
                    .request()
            ).to.equal(otherState);
        });
    });

    describe("timeout checks", function () {
        it("dispute.input.timeout.blockHeight += 1 -> false + TimeoutNotLinkedToLatestState", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.tamper.plantFreshTimeoutForNextWriter(0);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.input.timeout.participant).to.not.equal(
                "0x0000000000000000000000000000000000000000"
            );

            dispute.input.timeout.blockHeight =
                Number(dispute.input.timeout.blockHeight) + 1;

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutNotLinkedToLatestState
            );
        });

        it("dispute.input.timeout.participant = a peer that is not next to write -> false + TimeoutParticipantNotNext", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            await h.tamper.plantFreshTimeoutForNextWriter(0);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            const next = dispute.input.timeout.participant;
            const wrong = h.peers.find((p) => p.address !== next)!.address;
            dispute.input.timeout.participant = wrong;

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutParticipantNotNext
            );
        });

        it("window creation timestamp >= previous block timestamp + timeoutWaitTime -> timeout checks pass, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            const forkId = h.activeForkId!;
            // the committed dispute would otherwise reduce the fork mid-test,
            // and idle peers would race in their own natural timeout disputes
            for (const peer of h.peers) {
                await h.rpcStub.holdReductionRace(peer.index);
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            }

            const head = await h
                .control(h.getPeer(0))
                .query.getLatestBlockInfo(forkId)
                .request();
            const headBlock = Codec.decode(head!.encodedBlock, Type.Block);
            const headTs = Number(headBlock.transaction.header.timestamp);
            const headHeight = Number(
                headBlock.transaction.header.transactionCnt
            );
            const wait = timeoutWaitTime(
                resolveTestTimeConfig(),
                headHeight + 1
            );
            // plant first: the upload's window-created-too-early guard compares
            // against the timeout's minTimeStamp (set at plant time)
            await h.tamper.plantFreshTimeoutForNextWriter(0);
            await h.event.waitUntilTimestamp(headTs + wait + 2);

            const posted = await h.tamper.postTamperedDispute(0, () => {}, {
                markMalicious: false
            });
            // premise: the window was created after the writer's full wait
            const windowTs = Number(
                await h.channelManager.getDisputeWindowCreationTimestamp(
                    h.channelId,
                    forkId
                )
            );
            expect(windowTs).to.be.greaterThanOrEqual(headTs + wait);

            const run = await h.dispute.auditDispute(1, posted.dispute);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("window creation timestamp < previous block timestamp + timeoutWaitTime -> false + TimeoutTooEarly", async function () {
            const h = TestSession.getHarness();
            // wide wait window -> the immediate post is deterministically early
            await h.scenario.preDisputeSetup({
                timeConfig: { chainFallbackTime: 12 }
            });
            const forkId = h.activeForkId!;
            for (const peer of h.peers) {
                await h.rpcStub.holdReductionRace(peer.index);
                // live audits store the same proof and try to kill on-chain
                await h.rpcStub.suppressDisputeKill(peer.index);
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            }

            const head = await h
                .control(h.getPeer(0))
                .query.getLatestBlockInfo(forkId)
                .request();
            const headBlock = Codec.decode(head!.encodedBlock, Type.Block);
            const headTs = Number(headBlock.transaction.header.timestamp);
            const wait = timeoutWaitTime(
                resolveTestTimeConfig({ chainFallbackTime: 12 }),
                Number(headBlock.transaction.header.transactionCnt) + 1
            );

            await h.tamper.plantFreshTimeoutForNextWriter(0);
            const posted = await h.tamper.postTamperedDispute(0, () => {});
            const windowTs = Number(
                await h.channelManager.getDisputeWindowCreationTimestamp(
                    h.channelId,
                    forkId
                )
            );
            expect(windowTs).to.be.lessThan(headTs + wait);

            const run = await h.dispute.auditDispute(1, posted.dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutTooEarly
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });

        // no test: timeoutTimestamp comes from
        // getDisputeWindowCreationTimestamp and previousTimestamp from the
        // stored previous block, so hitting equality means landing the upload
        // transaction in one chosen second - only evm_setNextBlockTimestamp
        // does that, and AGENTS.md forbids node-wide time RPCs on a shared
        // node. both sides of the strict `<` are pinned by the too-early and
        // pass-through tests above, and by the three-way forfeit test which
        // moves previousTimestamp across the same comparison
        it.skip("window creation timestamp == previous block timestamp + timeoutWaitTime -> accepted", function () {});

        it("timeout.participantSignatureOnPreviousBlock: 0x / timed-out signer / other signer -> TimeoutTooEarly, none, TimeoutTooEarly", async function () {
            const h = TestSession.getHarness();
            // agreementTime 10 widens the authored->calldata gap so the window
            // deterministically lands between the two forfeit clocks
            await h.lifecycle.timeoutSetup(4, 0, {
                timeConfig: { agreementTime: 10, evidenceTime: 8 }
            });
            await h.transition.advanceState({ count: 2 });
            // height 2: peer 3 cannot confirm -> the author posts calldata
            await h
                .control(h.getPeer(3))
                .stub.stubRejectIngestedConfirmations()
                .request();
            await Promise.all(
                [0, 1, 2, 3].map((i) => h.rpcStub.suppressTimeoutCheck(i))
            );
            await h.network.disconnectPeer(3);
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1, 2],
                waitForFinalization: false
            });
            await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h
                .control(h.getPeer(3))
                .stub.restoreRejectIngestedConfirmations()
                .request();
            const forkId = h.activeForkId!;
            for (const i of [0, 1, 2, 3]) {
                await h.rpcStub.holdReductionRace(i);
            }

            const block2 = await h
                .control(h.getPeer(1))
                .query.getBlockByHeight(forkId, 2)
                .request();
            expect(block2!.onChainTimestamp).to.not.equal(null);
            const tAuth = block2!.timestamp;
            const tCal = block2!.onChainTimestamp!;
            const wait = timeoutWaitTime(
                resolveTestTimeConfig({ agreementTime: 10, evidenceTime: 8 }),
                3
            );

            // open the window inside (tAuth + wait, tCal + wait)
            await h.event.waitUntilTimestamp(tAuth + wait + 1);
            await h.control(h.getPeer(2)).dispute.setForceExit(true).request();
            await h.tamper.postTamperedDispute(2, () => {}, {
                markMalicious: false
            });
            const windowTs = Number(
                await h.channelManager.getDisputeWindowCreationTimestamp(
                    h.channelId,
                    forkId
                )
            );
            expect(windowTs).to.be.greaterThan(tAuth + wait);
            expect(windowTs).to.be.lessThan(tCal + wait);

            // disputer 0's proof heads at block 2; timeout blames height 3
            await h.tamper.plantFreshTimeoutForNextWriter(0);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(Number(dispute.input.timeout.blockHeight)).to.equal(3);
            // a calldata-committed head counts as final, so constructDispute
            // has no auditing data to post
            expect(dispute.postedAuditingData).to.equal(false);

            const prevBlock = Block.fromSignedBlock(
                Codec.decode(block2!.encodedSignedBlock, Type.SignedBlock)
            );
            const timedOut = h.peers.find(
                (p) => p.address === dispute.input.timeout.participant
            )!;
            const wrongSigner = h.peers.find(
                (p) => p.address !== dispute.input.timeout.participant
            )!;

            // no signature -> previous clock is the calldata timestamp -> early
            const noSig = await h.dispute.auditDispute(1, dispute);
            expect(noSig.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutTooEarly
            );

            // the timed-out participant's own signature forfeits the extra time
            dispute.input.timeout.participantSignatureOnPreviousBlock =
                (await prevBlock.sign(timedOut.signer)) as string;
            const validSig = await h.dispute.auditDispute(1, dispute);
            expect(validSig.outcome).to.equal("returned");
            expect(validSig.storedProof?.disputeFraudProofType).to.not.equal(
                DisputeFraudProofType.TimeoutTooEarly
            );

            // a wrong signer's signature does not forfeit -> still early
            dispute.input.timeout.participantSignatureOnPreviousBlock =
                (await prevBlock.sign(wrongSigner.signer)) as string;
            const invalidSig = await h.dispute.auditDispute(1, dispute);
            expect(invalidSig.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutTooEarly
            );
        });

        // no test: the [check] N/N Threshold check reads the block at
        // timeout.blockHeight, which the [check] isLinked to stateProof check
        // above it pins to stateProof head + 1. didEveryoneSign needs every
        // participant of that block signed, so if the disputer is one of them
        // it signed above the dispute's own snapshot height and the earlier
        // DisputeNotLatestState fires instead. that leaves only a disputer
        // outside the block's participant set, which uploadDispute rejects
        // with ErrorCantParticipateInDispute - enforced by
        // "E2E: dispute validation / uploadRevert / channelId" and
        // "... / uploadRevert / disputer".
        it.skip("block at timeout.blockHeight signed by every participant -> false + TimeoutThreshold", function () {});

        it("timeout.blockHeight = a block whose calldata is on-chain, isForced true -> false + TimeoutCalldataPosted", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(4, 0, {
                timeConfig: { evidenceTime: 8 }
            });
            await h.transition.advanceState({ count: 2 });
            const calldataAuthor = await h.query.getNextPeerToWrite();
            await h
                .control(h.getPeer(3))
                .stub.stubRejectIngestedConfirmations()
                .request();
            await Promise.all(
                [0, 1, 2, 3].map((i) => h.rpcStub.suppressTimeoutCheck(i))
            );
            await h.network.disconnectPeer(3);
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1, 2],
                waitForFinalization: false
            });
            await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h
                .control(h.getPeer(3))
                .stub.restoreRejectIngestedConfirmations()
                .request();
            const forkId = h.activeForkId!;
            for (const i of [0, 1, 2, 3]) {
                await h.rpcStub.holdReductionRace(i);
            }

            // too-early clock for coords height 2 is block 1
            const block1 = await h
                .control(h.getPeer(1))
                .query.getBlockByHeight(forkId, 1)
                .request();
            const wait = timeoutWaitTime(
                resolveTestTimeConfig({ evidenceTime: 8 }),
                2
            );
            await h.event.waitUntilTimestamp(block1!.timestamp + wait + 1);
            await h.control(h.getPeer(2)).dispute.setForceExit(true).request();
            await h.tamper.postTamperedDispute(2, () => {}, {
                markMalicious: false
            });

            // peer 3's proof stops at height 1, blaming the calldata author
            await h.tamper.plantFreshTimeoutForParticipant(
                3,
                calldataAuthor.address
            );
            const { dispute } = await h.dispute.fetchConstructedDispute(3);
            expect(Number(dispute.input.timeout.blockHeight)).to.equal(2);
            expect(dispute.postedAuditingData).to.equal(false);
            dispute.input.timeout.isForced = true; // same deviation the e2e posts

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutCalldataPosted
            );
            expect(run.storedProof?.proofParticipant).to.equal(
                h.getPeer(3).address
            );
        });

        it("stale local previousBlockCalldata -> validateTimeoutCalldataPostedProof false, audit continues without TimeoutCalldataPosted", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(4, 0, {
                timeConfig: { evidenceTime: 8 }
            });
            await h.transition.advanceState({ count: 2 });
            const calldataAuthor = await h.query.getNextPeerToWrite();
            await h
                .control(h.getPeer(3))
                .stub.stubRejectIngestedConfirmations()
                .request();
            await Promise.all(
                [0, 1, 2, 3].map((i) => h.rpcStub.suppressTimeoutCheck(i))
            );
            await h.network.disconnectPeer(3);
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1, 2],
                waitForFinalization: false
            });
            await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h
                .control(h.getPeer(3))
                .stub.restoreRejectIngestedConfirmations()
                .request();
            const forkId = h.activeForkId!;
            for (const i of [0, 1, 2, 3]) {
                await h.rpcStub.holdReductionRace(i);
            }

            const block1 = await h
                .control(h.getPeer(1))
                .query.getBlockByHeight(forkId, 1)
                .request();
            const wait = timeoutWaitTime(
                resolveTestTimeConfig({ evidenceTime: 8 }),
                2
            );
            await h.event.waitUntilTimestamp(block1!.timestamp + wait + 1);
            await h.control(h.getPeer(2)).dispute.setForceExit(true).request();
            await h.tamper.postTamperedDispute(2, () => {}, {
                markMalicious: false
            });

            await h.tamper.plantFreshTimeoutForParticipant(
                3,
                calldataAuthor.address
            );
            const { dispute } = await h.dispute.fetchConstructedDispute(3);
            expect(Number(dispute.input.timeout.blockHeight)).to.equal(2);

            // stale previous-block calldata on the auditor: its proof claims
            // timestamp 1 while the chain commitment carries the real one ->
            // the preflight commitment compare rejects the proof
            await h.control(h.getPeer(1)).stub.stubCalldataPosting().request();
            await h
                .control(h.getPeer(1))
                .stub.stageBlockCalldata(block1!.encodedSignedBlock, 1)
                .request();
            // only the block author may post its calldata on-chain
            const block1Author = h.peers.find(
                (p) => p.address === block1!.author
            )!;
            await h
                .control(block1Author)
                .stub.postBlockCalldataOnChain(block1!.encodedSignedBlock)
                .request();

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
        });

        it("timeout dispute audited before the window reaches the local chain view -> throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            for (const peer of h.peers) {
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            }
            // a planted, untampered timeout passes the linkage and next-writer
            // checks, so the audit reaches getDisputeWindowCreationTimestamp.
            // throwing is correct: the only caller applies the commit to the
            // local diamond first (EventHandler.onDisputeCommitted), so a zero
            // window means local dispute state is corrupt, not a peer race
            await h.tamper.plantFreshTimeoutForNextWriter(0);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "Timeout timestamp not found"
            );
        });
    });

    describe("race", function () {
        it("fork advances while the audit is parked at getOnChainSlashedParticipants -> false + DisputeNotLatestState", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const forkId = h.activeForkId!;
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const snapshotHeight = Number(
                auditingData.latestStateSnapshot.blockHeight
            );

            await h
                .control(h.getPeer(1))
                .stub.stubHoldOnChainSlashesQuery()
                .request();
            const auditPromise = h.dispute.auditDispute(1, dispute);
            await h
                .control(h.getPeer(1))
                .stub.waitForHeldOnChainSlashesQuery()
                .request({ timeoutMs: 15000 });

            // real state moves while the audit is parked mid-flight
            await h.transition.advanceState({ count: 2 });
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
            expect(seen.height).to.be.greaterThan(snapshotHeight);

            await h
                .control(h.getPeer(1))
                .stub.restoreOnChainSlashesQuery()
                .request();
            const run = await auditPromise;

            // the disputer signed above its own dispute snapshot while the
            // audit was parked, so the dispute is no longer the latest state
            // and the evidence (its own newer signed block) is genuine
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeNotLatestState
            );
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeNotLatestState
            );
            const newerBlock = Codec.decode(evidence.encodedBlock, Type.Block);
            expect(
                Number(newerBlock.transaction.header.transactionCnt)
            ).to.equal(seen.height);
        });
    });
});
