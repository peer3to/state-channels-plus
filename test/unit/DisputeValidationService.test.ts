import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { timeoutWaitTime } from "@/types";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Bytes, Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import {
    hash as randomHash,
    randomAddress,
    blockStructWithTransactionHeader
} from "@test/factory";
import {
    craftProofBlock,
    forgedMilestoneBelowAnchor,
    forgedTimestamp,
    omittedProof,
    postedForgedRunOnChainStart,
    postedForgedSingleton,
    postedProof,
    postedRepeatedTailDispute,
    simulatedFraudProofSlashes,
    stageAuditorBehindOnChainAnchor,
    stageExitAnchoredFork,
    stageParticipantCutOffAtChainAnchor,
    stagePendingJoinerPastStart,
    storedProofBlock
} from "@test/fixtures/DisputeAuditStaging";
import {
    stageCutOffAuditorWithValidTail,
    stageForgedTipAboveAnchorThreshold
} from "@test/fixtures/DisputeReplayStaging";
import {
    MathTestSession as TestSession,
    resolveTestTimeConfig
} from "@test/harness";
import { DisputeTampering } from "@test/harness/actions/DisputeTamperingActions";
import { expect } from "chai";
import { ZeroHash } from "ethers";

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

        it("milestones[-1].blockConfirmations += copy signed by a confirmer -> false + DisputeInvalidBlockStructure at the copy's submitted coordinates", async function () {
            const h = TestSession.getHarness();
            // the structure check walks the last milestone
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // Conditional admission supplies a reason, never an exception to proof validation.
            dispute.input.requireExistingDisputeWindow = true;
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
            expect(Number(evidence.blockIndex)).to.equal(1);
        });

        it("milestones[-1].blockConfirmations[-1].signedBlock.encodedBlock = junk -> false + one DisputeInvalidBlockStructure at that position, no throw", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const confirmations =
                dispute.input.stateProof.milestones.at(-1)!.blockConfirmations;
            const position = confirmations.length - 1;
            confirmations[position].signedBlock.encodedBlock = randomHash();
            const structureReads = await h.mirror.observe(
                1,
                "findFirstInvalidBlockStructureInStateProof"
            );

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockStructure
            );
            // acted on locally: no chain read
            expect((await structureReads.observation()).chain.reads).to.equal(
                0
            );
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockStructure
            );
            expect(Number(evidence.blockIndex)).to.equal(position);
            expect(run.disputeFraudProofCount).to.equal(1);
        });

        it("public auditor stores no structure evidence for honest compact proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 6);
            const forkId = h.activeForkId!;
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // premise: the dispute's latest state is block 5
            expect(
                Number(auditingData.latestStateSnapshot.blockHeight)
            ).to.equal(5);
            const [b1, b2, b4, b5] = await Promise.all(
                [1, 2, 4, 5].map((height) =>
                    storedProofBlock(h, 0, forkId, height)
                )
            );
            // compact and separated: two threshold milestones with a gap, the
            // second's first block has no predecessor in the proof
            const posted = postedProof(dispute, auditingData, {
                milestones: [
                    [b1.confirmation, b2.confirmation],
                    [b4.confirmation, b5.confirmation]
                ],
                milestoneSnapshots: [b1.snapshot, b4.snapshot],
                latestStateSnapshot: b5.snapshot,
                finalizedState: b4.state
            });
            const structureReads = await h.mirror.observe(
                1,
                "findFirstInvalidBlockStructureInStateProof"
            );

            const audit = await h.dispute.auditDispute(
                1,
                posted.dispute,
                posted.auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.storedProof).to.equal(undefined);
            expect(audit.disputeFraudProofCount).to.equal(0);
            expect((await structureReads.observation()).local.reads).to.equal(
                1
            );
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
            // self-removal is the dispute's stated reason
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
            const milestone = dispute.input.stateProof.milestones.at(-1)!;
            milestone.blockConfirmations[0] =
                forged.forgedBlock.blockConfirmationStruct;
            auditingData.milestoneSnapshots[
                auditingData.milestoneSnapshots.length - 1
            ] = forged.forgedSnapshot.toStruct();
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

        it("postedAuditingData true + matching auditingData -> verifyStateProof accepts, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            // self-removal is the dispute's stated reason
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
            // Conditional admission supplies a reason, never an exception to proof validation.
            dispute.input.requireExistingDisputeWindow = true;
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
            expect(run.disputeFraudProofCount).to.equal(1);
        });

        it("dispute.postedAuditingData = false on an unfinalized head -> false + DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            dispute.postedAuditingData = false;
            const walks = await h.mirror.observe(1, "verifyMilestones");
            const anchors = await h.mirror.observe(1, "getAnchorSnapshot");

            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            expect(run.disputeFraudProofCount).to.equal(1);
            // decided before the below-anchor chain read and the chain walk
            expect((await walks.observation()).chain.reads).to.equal(0);
            expect((await anchors.observation()).chain.reads).to.equal(0);
        });

        it("dispute.postedAuditingData = false on an unfinalized head + a forged tail block -> false + DisputeLastMilestoneNotFinalAndNoAuditingData only", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const milestones = dispute.input.stateProof.milestones.map(
                ({ blockConfirmations }) => [...blockConfirmations]
            );
            const tip = Block.fromBlockConfirmation(milestones.at(-1)!.at(-1)!);
            // authentic and linked, over a state no transition reaches
            const forged = await craftProofBlock(h, {
                authorIndex: 0,
                forkId,
                height: Number(tip.height) + 1,
                previousBlockHash: tip.hash,
                stateSnapshotHash: randomHash()
            });
            milestones
                .at(-1)!
                .push({ signedBlock: forged.signedBlock, signatures: [] });

            const run = await h.dispute.auditDispute(
                1,
                omittedProof(dispute, milestones)
            );
            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            expect(run.disputeFraudProofCount).to.equal(1);
        });

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

            it("settled path, unrecoverable gap -> the audit throws, zero proofs", async function () {
                const h = TestSession.getHarness();
                await h.setup(3);
                await h.lifecycle.openChannel();
                const lagging = 2;
                const held = await h.rpcStub.holdInboundMessageEvents(lagging);
                const { dispute } = await stageLaggingAuditor(h, lagging);

                const run = await h.dispute.auditDispute(lagging, dispute);

                // a gap the chain logs cannot heal is an internal failure,
                // never an abstain: our own missing history is nobody's fraud
                expect(run).to.deep.include({ outcome: "threw" });
                expect(
                    run.outcome === "threw" ? run.threwMessage : ""
                ).to.match(/inbound run is unavailable/);
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

            it("posted path with an emptied posted run + gap -> the audit throws, zero proofs", async function () {
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

                // the auditor rebuilds the run from chain logs, never from
                // the posted data
                expect(
                    run.outcome === "threw" ? run.threwMessage : ""
                ).to.match(/inbound run is unavailable/);
                expect(run.disputeFraudProofCount).to.equal(0);
                await releaseLaggingInbound?.();
            });
        });

        it("one unfinal genesis run (partial-signature fork) with posted auditing data -> replayed from block 0, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            await h.control(h.getPeer(3)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(dispute.input.stateProof.milestones.length).to.equal(1);
            expect(dispute.postedAuditingData).to.equal(true);

            const run = await h.dispute.auditDispute(0, dispute, auditingData);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("dispute.input.forkId = random on an empty stateProof -> no stored genesis, the audit throws", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // empty proof -> genesis snapshot branch
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = false;
            // no reason stated -> the audited path ends in InvalidDisputeReason
            const audited = await h.dispute.auditDispute(1, dispute);
            expect(audited).to.include({ outcome: "returned", isValid: false });
            expect(audited.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.InvalidDisputeReason
            );

            // an unknown fork keeps passing the channel-scoped inbound check
            // (StateChannelCommon.sol:578-594) but has no stored genesis: an
            // auditor audits only its current fork, so this is an invariant
            dispute.input.forkId = randomHash();
            const unknown = await h.dispute.auditDispute(1, dispute);
            expect(
                unknown.outcome === "threw" ? unknown.threwMessage : ""
            ).to.match(/without the genesis of fork/);
            expect(unknown.disputeFraudProofCount).to.equal(1); // from the audit above
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
                .request({
                    timeoutMs: h.event.hostExecTimeoutMs()
                });
            expect(sources).to.deep.equal({ local: false, rpc: true });

            const run = await h.dispute.auditDispute(1, dispute, auditingData);
            expect(run.outcome).to.equal("returned");
            expect(run.storedProof?.disputeFraudProofType).to.not.equal(
                DisputeFraudProofType.DisputeInboundHashNotInChain
            );
        });

        // the required set is the historic on-chain set plus the pending
        // joins through the dispute's inbound hash, whatever the proof start
        it("normal anchor does not waive pending Charlie signature", async function () {
            const h = TestSession.getHarness();
            const { participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            // no block seats Charlie: an idle writer slot would open a
            // participant-timeout dispute
            for (const index of participants)
                await h.rpcStub.suppressTimeoutCheck(index);
            // Charlie: a fresh wallet whose join reaches the inbound chain
            const { participant: charlie } = await h.join.forceInboundJoinWait({
                observePeerIndices: participants
            });
            const { dispute } =
                await h.dispute.fetchConstructedDispute(disputer);
            const milestones = dispute.input.stateProof.milestones;
            // premises: the proof runs from the normal anchor, Charlie signed
            // none of its last milestone, and the construction posted data
            expect(
                Block.fromBlockConfirmation(milestones[0].blockConfirmations[0])
                    .height
            ).to.be.at.least(anchorHeight);
            const lastMilestoneSigners = milestones
                .at(-1)!
                .blockConfirmations.flatMap((confirmation) => [
                    ...Block.fromBlockConfirmation(confirmation)
                        .allSignerAddresses
                ]);
            expect(lastMilestoneSigners).to.not.include(charlie);
            expect(dispute.postedAuditingData).to.equal(true);
            dispute.postedAuditingData = false;

            const audit = await h.dispute.auditDispute(auditor, dispute);

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            expect(audit.storedProof?.proofParticipant).to.equal(
                h.getPeer(disputer).address
            );
            expect(audit.disputeFraudProofCount).to.equal(1);
        });
    });

    // Data availability comes before verification; only the chain's verdict
    // on a kept part proves an invalid proof; only the last milestone's tail
    // from the walk's start is replayed. Tier one starts above an earlier
    // milestone and never reads it, so cases about one fail tier one's read.
    describe("state-proof verdicts", function () {
        it("malformed confirmation signature in a proof block still stores DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            // no signer recovers from it: logging the rejection must not throw
            const last = dispute.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.at(-1)!;
            last.signatures = [...last.signatures, "0x00"];

            const audit = await h.dispute.auditDispute(
                1,
                dispute,
                auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("valid no-data start-only proof passes linkage", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // no blocks -> empty proof
            const forkId = h.activeForkId!;
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.input.stateProof.milestones.length).to.equal(0);

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

            const audit = await h.dispute.auditDispute(1, dispute);
            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
        });

        it("omitted data with valid last DA milestone and broken earlier kept run yields invalid-state-proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: true
            });
            const forkId = h.activeForkId!;
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            // premise: the last milestone is final by everyone, so the
            // dispute omits its data
            expect(dispute.postedAuditingData).to.equal(false);
            const last =
                dispute.input.stateProof.milestones.at(-1)!.blockConfirmations;
            const tip = Block.fromBlockConfirmation(last.at(-1)!);
            // the same run continued by a block linked to nothing: it reaches
            // above every local threshold-final point, so no tier skips it
            const unlinked = await craftProofBlock(h, {
                authorIndex: 0,
                forkId,
                height: tip.height + 1
            });
            const broken = [
                ...last,
                { signedBlock: unlinked.signedBlock, signatures: [] }
            ];
            const linkage = await h.mirror.observe(1, "isStateProofLinked");

            const audit = await h.dispute.auditDispute(
                1,
                omittedProof(dispute, [broken, last])
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(audit.storedProof?.proofParticipant).to.equal(
                h.getPeer(0).address
            );
            // the chain confirms the broken link
            const { local, chain } = await linkage.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("DA-eligible omitted wrong genesis link yields invalid-state-proof", async function () {
            const h = TestSession.getHarness();
            // no block yet: the auditor has no local threshold-final point
            await h.lifecycle.start(3, 0);
            const forkId = h.activeForkId!;
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            // block 0 linked to a random predecessor instead of the genesis,
            // signed by every participant
            const zero = await craftProofBlock(h, {
                authorIndex: 0,
                forkId,
                height: 0
            });
            const signatures = await Promise.all(
                [1, 2].map(
                    async (index) =>
                        (await zero.block.sign(
                            h.getPeer(index).signer
                        )) as string
                )
            );
            const finality = await h.mirror.observe(
                1,
                "isLastMilestoneFinalByEveryone"
            );
            const linkage = await h.mirror.observe(1, "isStateProofLinked");

            const audit = await h.dispute.auditDispute(
                1,
                omittedProof(dispute, [
                    [{ signedBlock: zero.signedBlock, signatures }]
                ])
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            // the omission is allowed: the milestone is final by everyone
            expect((await finality.observation()).local.answers).to.deep.equal([
                true
            ]);
            const { local, chain } = await linkage.observation();
            expect(local.answers).to.deep.equal([false]);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("omitted data full-finality false with linkage and DA true stores no unsupported counter", async function () {
            const h = TestSession.getHarness();
            // peer 2 cut off before block 0: no block is final by everyone,
            // so the auditor has no local threshold-final point
            await h.scenario.preDisputeSetupDisconnectedPeer();
            // the next writer may be the cut-off peer: no participant-timeout
            // dispute while the audit runs
            for (const index of [0, 1, 3])
                await h.rpcStub.suppressTimeoutCheck(index);
            const forkId = h.activeForkId!;
            await h.control(h.getPeer(3)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            // premise: the dispute's latest state is block 1
            expect(
                Number(auditingData.latestStateSnapshot.blockHeight)
            ).to.equal(1);
            const [b0, b1] = (
                await Promise.all(
                    [0, 1].map((height) =>
                        storedProofBlock(h, 0, forkId, height)
                    )
                )
            ).map(({ confirmation }) => confirmation);
            // the earlier milestone stripped of its confirmations; every other
            // participant's own key, peer 2's included, confirms block 1, so
            // the last milestone is final by everyone
            const latest = Block.fromBlockConfirmation(b1);
            const confirmations = await Promise.all(
                [0, 1, 2, 3]
                    .filter(
                        (index) => h.getPeer(index).address !== latest.author
                    )
                    .map(
                        async (index) =>
                            (await latest.sign(
                                h.getPeer(index).signer
                            )) as string
                    )
            );
            const stripped = [{ ...b0, signatures: [] }];
            const last = [{ ...b1, signatures: confirmations }];
            const linkage = await h.mirror.observe(0, "isStateProofLinked");
            const finality = await h.mirror.observe(
                0,
                "isLastMilestoneFinalByEveryone"
            );

            const audit = await h.dispute.auditDispute(
                0,
                omittedProof(dispute, [stripped, last])
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.storedProof).to.equal(undefined);
            expect(audit.disputeFraudProofCount).to.equal(0);
            // without data only linkage and DA are judged: both true locally
            expect((await linkage.observation()).local.answers).to.deep.equal([
                true
            ]);
            expect((await finality.observation()).local.answers).to.deep.equal([
                true
            ]);
        });

        it("unseen forged zero executes transition before successful state adoption", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            const forkId = h.activeForkId!;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const genesis = StateSnapshot.from(
                auditingData.latestStateSnapshot
            );
            const latest = forgedTimestamp(genesis.toStruct());
            const leader = await h.query.getNextPeerToWrite();
            const offender = [0, 1, 2].find(
                (index) => h.getPeer(index).address !== leader.address
            )!;
            const auditor = [0, 1, 2].find((index) => index !== offender)!;
            const forged = await craftProofBlock(h, {
                authorIndex: offender,
                forkId,
                height: 0,
                previousBlockHash: genesis.hash,
                stateSnapshotHash: StateSnapshot.from(latest).hash
            });
            const posted = postedProof(dispute, auditingData, {
                milestones: [
                    [{ signedBlock: forged.signedBlock, signatures: [] }]
                ],
                milestoneSnapshots: [latest],
                latestStateSnapshot: latest
            });

            const audit = await h.dispute.auditDispute(
                auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            const evidence = Codec.decode(
                audit.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(evidence.blockIndex)).to.equal(0);
            const slashed = await simulatedFraudProofSlashes(
                h,
                auditor,
                evidence.fraudProof
            );
            expect(slashed).to.include(h.getPeer(offender).address);
            expect(slashed).to.not.include(h.getPeer(auditor).address);
            expect(
                await h
                    .control(h.getPeer(auditor))
                    .query.getBlockByHash(forged.block.hash)
                    .request()
            ).to.equal(null);
        });

        it("later threshold replay starts after proven point", async function () {
            const h = TestSession.getHarness();
            const staged = await stageForgedTipAboveAnchorThreshold(h);
            // one run: the threshold-final point above the anchor, then the
            // unseen forged block
            const posted = postedProof(staged.dispute, staged.auditingData, {
                milestones: [staged.run],
                milestoneSnapshots: [staged.point.snapshot],
                latestStateSnapshot: staged.latest,
                finalizedState: staged.point.state
            });

            const audit = await h.dispute.auditDispute(
                staged.auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(
                audit,
                audit.outcome === "threw" ? audit.threwMessage : undefined
            ).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            const evidence = Codec.decode(
                audit.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            // the proven point is final history; the replay starts after it
            expect(Number(evidence.blockIndex)).to.equal(1);
            const slashed = await simulatedFraudProofSlashes(
                h,
                staged.auditor,
                evidence.fraudProof
            );
            expect(slashed).to.include(h.getPeer(staged.offenderIndex).address);
            expect(slashed).to.not.include(h.getPeer(staged.auditor).address);
            expect(
                await h
                    .control(h.getPeer(staged.auditor))
                    .query.getBlockByHash(staged.forged.hash)
                    .request()
            ).to.equal(null);
        });

        it("omitted all-dropped claim counters without old snapshots", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            const { dispute } =
                await h.dispute.fetchConstructedDispute(disputer);
            expect(anchorHeight).to.be.at.least(2);
            // real blocks below the anchor, final by everyone
            const below = await storedProofBlock(
                h,
                auditor,
                forkId,
                anchorHeight - 2
            );
            const { confirmation } = await storedProofBlock(
                h,
                auditor,
                forkId,
                anchorHeight - 1
            );
            const pointWalks = await h.mirror.observe(
                auditor,
                "verifyMilestonesFromTrustedStart"
            );
            const storageWalks = await h.mirror.observe(
                auditor,
                "verifyMilestones"
            );

            // the singleton and the multiblock shape
            const singleton = await h.dispute.auditDispute(
                auditor,
                omittedProof(dispute, [[confirmation]])
            );
            const multiblock = await h.dispute.auditDispute(
                auditor,
                omittedProof(dispute, [[below.confirmation, confirmation]])
            );

            for (const audit of [singleton, multiblock]) {
                expect(audit).to.include({
                    outcome: "returned",
                    isValid: false
                });
                expect(audit.storedProof?.disputeFraudProofType).to.equal(
                    DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
                );
                expect(audit.storedProof?.proofParticipant).to.equal(
                    h.getPeer(disputer).address
                );
            }
            expect(multiblock.disputeFraudProofCount).to.equal(2);
            // decided from the chain anchor: no walk reads a milestone snapshot
            expect((await pointWalks.observation()).local.reads).to.equal(0);
            expect((await storageWalks.observation()).local.reads).to.equal(0);
        });

        it("posted all-dropped claim counters without old snapshots", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(disputer);
            expect(anchorHeight).to.be.at.least(2);
            // a real two-block run below the anchor, posted with its real
            // snapshots
            const below = await storedProofBlock(
                h,
                auditor,
                forkId,
                anchorHeight - 2
            );
            const latest = await storedProofBlock(
                h,
                auditor,
                forkId,
                anchorHeight - 1
            );
            const posted = postedProof(dispute, auditingData, {
                milestones: [[below.confirmation, latest.confirmation]],
                milestoneSnapshots: [below.snapshot],
                latestStateSnapshot: latest.snapshot
            });
            const pointWalks = await h.mirror.observe(
                auditor,
                "verifyMilestonesFromTrustedStart"
            );
            const storageWalks = await h.mirror.observe(
                auditor,
                "verifyMilestones"
            );

            const audit = await h.dispute.auditDispute(
                auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            );
            expect(audit.storedProof?.proofParticipant).to.equal(
                h.getPeer(disputer).address
            );
            expect(audit.disputeFraudProofCount).to.equal(1);
            // decided from the chain anchor: no walk reads the posted snapshots
            expect((await pointWalks.observation()).local.reads).to.equal(0);
            expect((await storageWalks.observation()).local.reads).to.equal(0);
        });

        it("decode error alone is not header-mismatch evidence", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.stateProof.milestones[0].blockConfirmations[0].signedBlock.encodedBlock =
                randomHash();

            const audit = await h.dispute.auditDispute(1, dispute);

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockStructure
            );
        });

        it("dropped undecodable interior creates no invalid-state-proof evidence", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            await h
                .control(h.getPeer(disputer))
                .dispute.setForceExit(true)
                .request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(disputer);
            // [0, malformed, anchor - 1]: wholly below the start, its interior
            // never decodes
            const last = await forgedMilestoneBelowAnchor(h, {
                forkId,
                anchorHeight,
                participants
            });
            const first = await craftProofBlock(h, {
                authorIndex: disputer,
                forkId,
                height: 0,
                stateSnapshotHash: StateSnapshot.from(last.snapshot).hash
            });
            const malformed = {
                signedBlock: {
                    encodedBlock: randomHash(),
                    signature: first.signedBlock.signature
                },
                signatures: []
            };
            const posted = postedProof(dispute, auditingData, {
                milestones: [
                    [
                        { signedBlock: first.signedBlock, signatures: [] },
                        malformed,
                        last.confirmation
                    ],
                    ...dispute.input.stateProof.milestones.map(
                        ({ blockConfirmations }) => blockConfirmations
                    )
                ],
                milestoneSnapshots: [
                    last.snapshot,
                    ...auditingData.milestoneSnapshots
                ],
                latestStateSnapshot: auditingData.latestStateSnapshot
            });

            const audit = await h.dispute.auditDispute(
                auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.storedProof).to.equal(undefined);
            expect(audit.disputeFraudProofCount).to.equal(0);
            // the dropped prefix is not persisted
            const query = h.control(h.getPeer(auditor)).query;
            for (const block of [first.block, last.block]) {
                expect(
                    await query.getBlockByHash(block.hash).request()
                ).to.equal(null);
            }
            expect(
                await query
                    .getStateSnapshotStructByHash(
                        StateSnapshot.from(last.snapshot).hash
                    )
                    .request()
            ).to.equal(null);
        });

        it("skipped prefix does not suppress independent supported fraud check", async function () {
            const h = TestSession.getHarness();
            const staged = await stageForgedTipAboveAnchorThreshold(h);
            // a forged milestone below the anchor ahead of the run
            const prefix = await forgedMilestoneBelowAnchor(h, staged);
            const posted = postedProof(staged.dispute, staged.auditingData, {
                milestones: [[prefix.confirmation], staged.run],
                milestoneSnapshots: [prefix.snapshot, staged.point.snapshot],
                latestStateSnapshot: staged.latest
            });

            const audit = await h.dispute.auditDispute(
                staged.auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(
                audit,
                audit.outcome === "threw" ? audit.threwMessage : undefined
            ).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            // the original index in the last milestone
            const evidence = Codec.decode(
                audit.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(evidence.blockIndex)).to.equal(1);
            const slashed = await simulatedFraudProofSlashes(
                h,
                staged.auditor,
                evidence.fraudProof
            );
            expect(slashed).to.include(h.getPeer(staged.offenderIndex).address);
            expect(slashed).to.not.include(h.getPeer(staged.auditor).address);
            // the skipped prefix is not persisted
            const query = h.control(h.getPeer(staged.auditor)).query;
            expect(
                await query.getBlockByHash(prefix.block.hash).request()
            ).to.equal(null);
            expect(
                await query
                    .getStateSnapshotStructByHash(
                        StateSnapshot.from(prefix.snapshot).hash
                    )
                    .request()
            ).to.equal(null);
        });

        // a failed read throws and caches nothing: an explicit retry after
        // the repair decides
        it("repaired data permits explicit dispute retry", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            // a block above the tip: no threshold proves it from any start
            const { dispute, auditingData } = await postedForgedSingleton(h);
            const walks = await h.mirror.observe(1, "verifyStateProof");
            // the chain's verification gets no verdict
            await h.mirror.failNextChainRead(
                1,
                "verifyStateProof",
                "transport"
            );

            const failed = await h.dispute.auditDispute(
                1,
                dispute,
                auditingData
            );

            expect(failed.outcome).to.equal("threw");
            expect(failed.storedProof).to.equal(undefined);
            expect(failed.disputeFraudProofCount).to.equal(0);

            // the connection is back: the explicit repeat audit gets the
            // chain's verdict
            const retried = await h.dispute.auditDispute(
                1,
                dispute,
                auditingData
            );

            expect(retried).to.include({ outcome: "returned", isValid: false });
            expect(retried.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(retried.disputeFraudProofCount).to.equal(1);
            const { chain } = await walks.observation();
            expect(chain.failures).to.have.length(1);
            expect(chain.answers).to.deep.equal([false]);
        });

        it("exit-anchored fork, empty stateProof -> false + DisputeStateProofBelowOnChainAnchor naming the disputer", async function () {
            const h = TestSession.getHarness();
            const { participants } = await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            const { dispute } =
                await h.dispute.fetchConstructedDispute(disputer);

            const audit = await h.dispute.auditDispute(auditor, {
                ...dispute,
                postedAuditingData: false,
                input: { ...dispute.input, stateProof: { milestones: [] } }
            });

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            );
            expect(audit.storedProof?.proofParticipant).to.equal(
                h.getPeer(disputer).address
            );
            expect(audit.disputeFraudProofCount).to.equal(1);
        });

        it("on-chain snapshot on the previous fork above the new fork's heights, empty stateProof on the new fork -> no DisputeStateProofBelowOnChainAnchor", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor, attacker] = participants;
            await h.byzantine.submitInvalidStateTransitionBlock(attacker);
            const { newForkId } = await h.dispute.resolveDisputeWait({
                forkId
            });
            // premise: the chain's snapshot still lies on the old fork
            const onChain = await h.channelManager.getStateSnapshot(
                h.channelId
            );
            expect(onChain.forkId).to.equal(forkId);
            expect(Number(onChain.blockHeight)).to.equal(anchorHeight);
            await h
                .control(h.getPeer(disputer))
                .dispute.setForceExit(true)
                .request();
            const { dispute } =
                await h.dispute.fetchConstructedDispute(disputer);
            expect(dispute.input.forkId).to.equal(newForkId);

            const audit = await h.dispute.auditDispute(auditor, {
                ...dispute,
                postedAuditingData: false,
                input: { ...dispute.input, stateProof: { milestones: [] } }
            });

            expect(audit.outcome).to.equal("returned");
            expect(audit.storedProof?.disputeFraudProofType).to.not.equal(
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            );
        });

        it("exit-anchored fork, last block at the on-chain snapshot height -> no DisputeStateProofBelowOnChainAnchor, the audit continues", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            const { dispute } =
                await h.dispute.fetchConstructedDispute(disputer);
            const { confirmation } = await storedProofBlock(
                h,
                auditor,
                forkId,
                anchorHeight
            );

            const audit = await h.dispute.auditDispute(
                auditor,
                omittedProof(dispute, [[confirmation]])
            );

            expect(audit.outcome).to.equal("returned");
            // no verdict of the below-anchor check or of a check before it
            expect(audit.storedProof?.disputeFraudProofType).to.not.be.oneOf([
                DisputeFraudProofType.DisputeInboundHashNotInChain,
                DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                DisputeFraudProofType.DisputeInvalidBlockStructure,
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData,
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            ]);
        });

        it("mirror missed the same-fork on-chain snapshot, proof below it -> the chain start decides: false + DisputeStateProofBelowOnChainAnchor", async function () {
            const h = TestSession.getHarness();
            const { auditorIndex, anchorHeight } =
                await stageAuditorBehindOnChainAnchor(h);
            const forkId = h.activeForkId!;
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const { confirmation } = await storedProofBlock(
                h,
                0,
                forkId,
                anchorHeight - 1
            );
            const anchors = await h.mirror.observe(
                auditorIndex,
                "getAnchorSnapshot"
            );

            const audit = await h.dispute.auditDispute(
                auditorIndex,
                omittedProof(dispute, [[confirmation]])
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            );
            expect(audit.storedProof?.proofParticipant).to.equal(
                h.getPeer(0).address
            );
            expect((await anchors.observation()).chain.reads).to.equal(1);
        });

        it("exit-anchored fork, no auditing data, an unlinked non-author block below the start ahead of the kept run -> never replayed: true, zero proofs, the block not stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            // a final head, so the dispute omits its auditing data
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: true,
                waitForPeers: participants
            });
            await h
                .control(h.getPeer(disputer))
                .dispute.setForceExit(true)
                .request();
            const { dispute } =
                await h.dispute.fetchConstructedDispute(disputer);
            expect(dispute.postedAuditingData).to.equal(false);
            const forged = await forgedMilestoneBelowAnchor(h, {
                forkId,
                anchorHeight,
                participants
            });
            const kept = dispute.input.stateProof.milestones.map(
                ({ blockConfirmations }) => blockConfirmations
            );

            const audit = await h.dispute.auditDispute(
                auditor,
                omittedProof(dispute, [[forged.confirmation], ...kept])
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
            expect(
                await h
                    .control(h.getPeer(auditor))
                    .query.getBlockByHash(forged.block.hash)
                    .request()
            ).to.equal(null);
        });

        it("exit-anchored fork, posted auditing data with a forged milestone wholly below the start ahead of the kept ones -> dropped: true, zero proofs, its block and snapshot not stored", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            await h
                .control(h.getPeer(disputer))
                .dispute.setForceExit(true)
                .request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(disputer);
            const forged = await forgedMilestoneBelowAnchor(h, {
                forkId,
                anchorHeight,
                participants
            });
            const posted = postedProof(dispute, auditingData, {
                milestones: [
                    [forged.confirmation],
                    ...dispute.input.stateProof.milestones.map(
                        ({ blockConfirmations }) => blockConfirmations
                    )
                ],
                milestoneSnapshots: [
                    forged.snapshot,
                    ...auditingData.milestoneSnapshots
                ],
                latestStateSnapshot: auditingData.latestStateSnapshot
            });

            const audit = await h.dispute.auditDispute(
                auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
            const query = h.control(h.getPeer(auditor)).query;
            expect(
                await query.getBlockByHash(forged.block.hash).request()
            ).to.equal(null);
            expect(
                await query
                    .getStateSnapshotStructByHash(
                        StateSnapshot.from(forged.snapshot).hash
                    )
                    .request()
            ).to.equal(null);
        });

        it("exit-anchored fork, a pending participant synced past the start without the start-height block audits an honest posted proof in full -> true, zero proofs, no throw", async function () {
            const h = TestSession.getHarness();
            const { participants, joiner } =
                await stagePendingJoinerPastStart(h);
            const [disputer] = participants;
            await h
                .control(h.getPeer(disputer))
                .dispute.setForceExit(true)
                .request();
            const constructed =
                await h.dispute.fetchConstructedDispute(disputer);
            // the honest proof with its auditing data posted
            const { dispute, auditingData } = postedProof(
                constructed.dispute,
                constructed.auditingData,
                {
                    milestones:
                        constructed.dispute.input.stateProof.milestones.map(
                            ({ blockConfirmations }) => blockConfirmations
                        ),
                    milestoneSnapshots:
                        constructed.auditingData.milestoneSnapshots,
                    latestStateSnapshot:
                        constructed.auditingData.latestStateSnapshot
                }
            );

            const audit = await h.dispute.auditDispute(
                joiner.index,
                dispute,
                auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
        });

        it("a participant cut off at the chain anchor audits an unlinked block at the anchor height that commits the anchor, then a non-leader block linked to it -> false at the second block, its proof built from the proof's anchor-height block slashes that author and not the auditor", async function () {
            const h = TestSession.getHarness();
            const staged = await stageParticipantCutOffAtChainAnchor(h);
            const posted = await postedForgedRunOnChainStart(h, {
                forkId: staged.forkId,
                anchorHeight: staged.anchorHeight,
                participants: [0, 1, 2]
            });
            const run =
                posted.dispute.input.stateProof.milestones[0]
                    .blockConfirmations;
            const offender = Block.fromBlockConfirmation(run[1]).author;
            // the participant holds the anchor; peers 0 and 1 author on
            // without it
            expect(staged.head).to.be.at.least(staged.anchorHeight);

            const audit = await h.dispute.auditDispute(
                staged.auditor.index,
                posted.dispute,
                posted.auditingData
            );

            expect(
                audit,
                audit.outcome === "threw" ? audit.threwMessage : undefined
            ).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            const evidence = Codec.decode(
                audit.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(evidence.blockIndex)).to.equal(1);
            const slashed = await simulatedFraudProofSlashes(
                h,
                staged.auditor.index,
                evidence.fraudProof
            );
            expect(slashed).to.include(String(offender));
            expect(slashed).to.not.include(
                h.getPeer(staged.auditor.index).address
            );
        });

        it("exit-anchored fork, posted proof wholly below the auditor's local final point by a disputer that signed later blocks -> replayed on the dispute's own chain: false + the non-leader block's apply proof, no throw", async function () {
            const h = TestSession.getHarness();
            const staged = await stageExitAnchoredFork(h);
            const [disputer, auditor] = staged.participants;
            const posted = await postedForgedRunOnChainStart(h, staged);

            const audit = await h.dispute.auditDispute(
                auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(
                audit,
                audit.outcome === "threw" ? audit.threwMessage : undefined
            ).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(audit.storedProof?.proofParticipant).to.equal(
                h.getPeer(disputer).address
            );
            expect(audit.disputeFraudProofCount).to.equal(1);
        });
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

        it("requireExistingDisputeWindow true with no other reason -> valid without a fraud proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.input.timeout.participant).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
            expect(dispute.input.onChainSlashes).to.have.length(0);
            expect(dispute.input.selfRemoval).to.equal(false);
            dispute.input.requireExistingDisputeWindow = true;
            const run = await h.dispute.auditDispute(1, dispute);
            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("timeout.participant = 0 AND onChainSlashes = [] AND selfRemoval false -> false + InvalidDisputeReason", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = false;
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

        it("an honest posted unfinal run the auditor already validated → fast-forwarded: no block replayed, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            // premise: the whole run is the unfinal tail, from block 0
            expect(dispute.input.stateProof.milestones).to.have.length(1);
            const replay = await h.rpcStub.holdBlockWork(
                0,
                "proofConfirmationValidation"
            );
            try {
                const audit = await h.dispute.auditDispute(
                    0,
                    dispute,
                    auditingData
                );

                expect(audit).to.include({
                    outcome: "returned",
                    isValid: true
                });
                expect(await replay.entered()).to.equal(0);
            } finally {
                await replay.release();
            }
        });

        it("omitted data whose final-by-everyone replay base the auditor does not hold → throws, no proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const head = await h
                .control(h.getPeer(1))
                .query.getLatestBlockBundle(forkId)
                .request();
            // linked to the head, committing a snapshot no peer holds, signed
            // by every participant: only a forged own signature makes an
            // honest auditor's base unheld
            const base = await craftProofBlock(h, {
                authorIndex: 0,
                forkId,
                height: head!.height + 1,
                previousBlockHash: head!.hash as Hash
            });
            const signatures = await Promise.all(
                [1, 2].map(
                    async (index) =>
                        (await base.block.sign(
                            h.getPeer(index).signer
                        )) as string
                )
            );

            const audit = await h.dispute.auditDispute(
                1,
                omittedProof(dispute, [
                    [{ signedBlock: base.signedBlock, signatures }]
                ])
            );

            expect(
                audit.outcome === "threw" ? audit.threwMessage : ""
            ).to.match(/Dispute replay base at block 0 .* is not held/);
            expect(audit.disputeFraudProofCount).to.equal(0);
        });
    });

    // An honest auditor audits in full and persists every replayed block,
    // snapshot and state by hash, so it can reduce later.
    describe("audit persistence", function () {
        it("a peer that missed an honest unfinal run audits it → valid, every replayed block and the latest snapshot stored", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(
                dispute.input.stateProof.milestones[0].blockConfirmations.length
            ).to.be.greaterThan(1);

            const p = await h.dispute.auditPersistence(
                2,
                dispute,
                auditingData
            );

            expect(p.isValid, p.threwMessage).to.equal(true);
            // the disconnected peer never saw these blocks - the replay is
            // what puts them (and the head snapshot) into its storage
            for (const item of p.milestoneBlocks) {
                expect(item.storedBefore, item.key).to.equal(false);
                expect(item.storedAfter, item.key).to.equal(true);
            }
            expect(p.snapshots[0].storedBefore).to.equal(false);
            expect(p.snapshots[0].storedAfter).to.equal(true);
        });

        it("posted finalized state of another real state → false + DisputeInvalidStateProof, the honest snapshot's key untouched; the right state → true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const auditor = h.control(h.getPeer(1));
            const firstOfLast = Block.fromBlockConfirmation(
                dispute.input.stateProof.milestones.at(-1)!
                    .blockConfirmations[0]
            );
            const finalized = await storedProofBlock(
                h,
                1,
                forkId,
                firstOfLast.height
            );
            const other = await storedProofBlock(
                h,
                1,
                forkId,
                firstOfLast.height === 0 ? 1 : 0
            );
            // premise: the substituted bytes really are a different state
            expect(other.state).to.not.equal(finalized.state);
            const posted = (finalizedState: Bytes) =>
                postedProof(dispute, auditingData, {
                    milestones: dispute.input.stateProof.milestones.map(
                        (milestone) => milestone.blockConfirmations
                    ),
                    milestoneSnapshots: auditingData.milestoneSnapshots,
                    latestStateSnapshot: auditingData.latestStateSnapshot,
                    finalizedState
                });
            const forged = posted(other.state);

            const run = await h.dispute.auditDispute(
                1,
                forged.dispute,
                forged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(
                await auditor.query
                    .getStateMachineState(
                        finalized.snapshot.snapshotData
                            .stateMachineStateHash as Hash
                    )
                    .request()
            ).to.equal(finalized.state);
            const honest = posted(finalized.state);
            expect(
                await h.dispute.auditDispute(
                    1,
                    honest.dispute,
                    honest.auditingData
                )
            ).to.include({ outcome: "returned", isValid: true });
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

            const p = await h.dispute.auditPersistence(
                1,
                dispute,
                auditingData
            );
            expect(p.isValid, p.threwMessage).to.equal(true);
            // content-addressing lands on the same word for honest data
            expect(p.stateMachineState?.key).to.equal(committedStateHash);
            expect(p.stateMachineState?.storedAfter).to.equal(true);
            expect(
                hash(auditingData.latestFinalizedStateStateMachineState)
            ).to.equal(committedStateHash);
        });

        it("posted auditing data for a forged block above the tip, final by no threshold -> false + DisputeInvalidStateProof: no block, no snapshot stored", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute, auditingData } = await postedForgedSingleton(h);
            const p = await h.dispute.auditPersistence(
                1,
                dispute,
                auditingData
            );
            expect(p.isValid, p.threwMessage).to.equal(false);
            expect(p.milestoneBlocks.length).to.be.greaterThan(0);
            for (const item of [...p.milestoneBlocks, ...p.snapshots]) {
                expect(item.storedAfter, item.key).to.equal(false);
            }
        });
    });

    // Verified persistence stores what the walk proves from its start: never
    // the replay tail before its replay, a dropped part, or a snapshot no
    // stored block commits.
    describe("verified proof persistence", function () {
        it("DisputeValidationService threshold snapshot is commitment-bound", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // the threshold milestone's entry, not committed by its block
            auditingData.milestoneSnapshots[0] = forgedTimestamp(
                auditingData.milestoneSnapshots[0]
            );

            const p = await h.dispute.auditPersistence(
                1,
                dispute,
                auditingData
            );

            expect(p.isValid, p.threwMessage).to.equal(false);
            // snapshots: the latest first, then the milestone entries
            expect(p.snapshots[1]).to.include({
                storedBefore: false,
                storedAfter: false
            });
        });

        it("DisputeValidationService ignored forged height leaves snapshot maps unchanged", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(disputer);
            // a milestone below the anchor with a snapshot of a forged height
            const forgedSnapshot = StateSnapshot.from({
                ...auditingData.milestoneSnapshots[0],
                blockHeight: anchorHeight - 1
            });
            const forged = await craftProofBlock(h, {
                authorIndex: disputer,
                forkId,
                height: anchorHeight - 1,
                stateSnapshotHash: forgedSnapshot.hash
            });
            const posted = postedProof(dispute, auditingData, {
                milestones: [
                    [{ signedBlock: forged.signedBlock, signatures: [] }],
                    dispute.input.stateProof.milestones[0].blockConfirmations
                ],
                milestoneSnapshots: [
                    forgedSnapshot.toStruct(),
                    ...auditingData.milestoneSnapshots
                ],
                latestStateSnapshot: auditingData.latestStateSnapshot
            });

            const audit = await h.dispute.auditDispute(
                auditor,
                posted.dispute,
                posted.auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
            const auditorQuery = h.control(h.getPeer(auditor)).query;
            expect(
                await auditorQuery.getBlockByHash(forged.block.hash).request()
            ).to.equal(null);
            expect(
                await auditorQuery
                    .getStateSnapshotStructByHash(forgedSnapshot.hash)
                    .request()
            ).to.equal(null);
        });

        it("DisputeValidationService last-tail blocks are absent from storage before their own replay", async function () {
            const h = TestSession.getHarness();
            const {
                auditorIndex,
                dispute,
                auditingData,
                support,
                tail,
                tailBlock
            } = await stageCutOffAuditorWithValidTail(h);
            const posted = postedProof(dispute, auditingData, {
                milestones: [[support.confirmation, tail.confirmation]],
                milestoneSnapshots: [support.snapshot],
                latestStateSnapshot: tail.snapshot,
                finalizedState: support.state
            });
            const query = h.control(h.getPeer(auditorIndex)).query;
            const replay = await h.rpcStub.holdBlockWork(
                auditorIndex,
                "proofConfirmationValidation"
            );

            const auditing = h.dispute.auditDispute(
                auditorIndex,
                posted.dispute,
                posted.auditingData
            );
            // the proof is verified and persisted; the tail waits for its
            // own replay
            await replay.waitUntilEntered();
            const heldBlock = await query
                .getBlockByHash(tailBlock.hash)
                .request();
            const heldSnapshot = await query
                .getStateSnapshotStructByHash(tailBlock.stateSnapshotHash)
                .request();
            await replay.release();
            const audit = await auditing;

            expect(heldBlock).to.equal(null);
            expect(heldSnapshot).to.equal(null);
            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
            // the replay stored the block and the state it computed
            expect(
                await query.getBlockByHash(tailBlock.hash).request()
            ).to.not.equal(null);
            expect(
                await query
                    .getStateSnapshotStructByHash(tailBlock.stateSnapshotHash)
                    .request()
            ).to.not.equal(null);
        });

        it("DisputeValidationService anchor offset zero selects actual anchor", async function () {
            const h = TestSession.getHarness();
            const { forkId, auditor, anchorHeight } =
                await stageParticipantCutOffAtChainAnchor(h);
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const anchor = await storedProofBlock(h, 0, forkId, anchorHeight);
            const next = await storedProofBlock(h, 0, forkId, anchorHeight + 1);
            // the run starts at the anchor; its supplied entry, a re-timed
            // copy of the anchor state, is never the start
            const supplied = forgedTimestamp(anchor.snapshot);
            const posted = postedProof(dispute, auditingData, {
                milestones: [[anchor.confirmation, next.confirmation]],
                milestoneSnapshots: [supplied],
                latestStateSnapshot: next.snapshot,
                finalizedState: anchor.state
            });

            const p = await h.dispute.auditPersistence(
                auditor.index,
                posted.dispute,
                posted.auditingData
            );

            expect(p.isValid, p.threwMessage).to.equal(true);
            // snapshots: the latest first, then the supplied entry
            expect(p.snapshots[1]).to.include({
                storedBefore: false,
                storedAfter: false
            });
            // the replay stores the latest state the tail commits
            expect(p.snapshots[0].storedAfter).to.equal(true);
            expect(
                await h
                    .control(auditor)
                    .query.getStateSnapshotStructByHash(
                        StateSnapshot.from(anchor.snapshot).hash
                    )
                    .request()
            ).to.not.equal(null);
        });

        it("DisputeValidationService interior anchor selects actual anchor", async function () {
            const h = TestSession.getHarness();
            const { forkId, auditor, anchorHeight } =
                await stageParticipantCutOffAtChainAnchor(h);
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const [previous, anchor, next] = await Promise.all(
                [anchorHeight - 1, anchorHeight, anchorHeight + 1].map(
                    (height) => storedProofBlock(h, 0, forkId, height)
                )
            );
            // the anchor inside the run; the supplied entry for the run's
            // first block, a re-timed copy of its state, lies below the start
            const supplied = forgedTimestamp(previous.snapshot);
            const posted = postedProof(dispute, auditingData, {
                milestones: [
                    [
                        previous.confirmation,
                        anchor.confirmation,
                        next.confirmation
                    ]
                ],
                milestoneSnapshots: [supplied],
                latestStateSnapshot: next.snapshot,
                finalizedState: anchor.state
            });

            const p = await h.dispute.auditPersistence(
                auditor.index,
                posted.dispute,
                posted.auditingData
            );

            expect(p.isValid, p.threwMessage).to.equal(true);
            expect(p.snapshots[1]).to.include({
                storedBefore: false,
                storedAfter: false
            });
            expect(p.snapshots[0].storedAfter).to.equal(true);
            expect(
                await h
                    .control(auditor)
                    .query.getStateSnapshotStructByHash(
                        StateSnapshot.from(anchor.snapshot).hash
                    )
                    .request()
            ).to.not.equal(null);
        });

        it("DisputeValidationService all-dropped proof installs no supplied snapshot", async function () {
            const h = TestSession.getHarness();
            const { forkId, participants, anchorHeight } =
                await stageExitAnchoredFork(h);
            const [disputer, auditor] = participants;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(disputer);
            // the only milestone lies wholly below the anchor
            const forged = await forgedMilestoneBelowAnchor(h, {
                forkId,
                anchorHeight,
                participants
            });
            const posted = postedProof(dispute, auditingData, {
                milestones: [[forged.confirmation]],
                milestoneSnapshots: [forged.snapshot],
                latestStateSnapshot: forged.snapshot
            });

            const p = await h.dispute.auditPersistence(
                auditor,
                posted.dispute,
                posted.auditingData
            );

            // a latest state below the chain's start is its own counter
            expect(p.isValid, p.threwMessage).to.equal(false);
            for (const item of [...p.milestoneBlocks, ...p.snapshots]) {
                expect(item.storedAfter, item.key).to.equal(false);
            }
        });

        it("DisputeValidationService ignored forged timestamp leaves genesis unchanged", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // empty proof: the latest state is the genesis
            const forkId = h.activeForkId!;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            const query = h.control(h.getPeer(1)).query;
            const genesisHash = await query
                .getGenesisSnapshotHash(forkId)
                .request();
            const genesisTimestamp = await query
                .getGenesisSnapshotTimestamp(forkId)
                .request();
            // premise: the dispute names the genesis
            expect(
                StateSnapshot.from(auditingData.latestStateSnapshot).hash
            ).to.equal(genesisHash);
            // the genesis data under a later timestamp
            const supplied = {
                ...auditingData,
                latestStateSnapshot: forgedTimestamp(
                    auditingData.latestStateSnapshot
                )
            };

            const p = await h.dispute.auditPersistence(1, dispute, supplied);

            expect(p.isValid, p.threwMessage).to.equal(false);
            // snapshots: the supplied latest state only
            expect(p.snapshots).to.have.length(1);
            expect(p.snapshots[0]).to.include({
                storedBefore: false,
                storedAfter: false
            });
            expect(
                await query.getGenesisSnapshotHash(forkId).request()
            ).to.equal(genesisHash);
            expect(
                await query.getGenesisSnapshotTimestamp(forkId).request()
            ).to.equal(genesisTimestamp);
        });
    });

    // Block 3 occurs twice: as support in the first milestone and in the
    // second milestone's replay tail. Identity keeps it out of storage until
    // its own replay, which runs its transition.
    describe("repeated support and tail identity", function () {
        it("DisputeValidationService repeated support and tail identity still executes bad transition", async function () {
            const h = TestSession.getHarness();
            const { dispute, auditingData, tail, offenderIndex } =
                await postedRepeatedTailDispute(h);

            const audit = await h.dispute.auditDispute(
                2,
                dispute,
                auditingData
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            const evidence = Codec.decode(
                audit.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(evidence.blockIndex)).to.equal(1);
            const slashed = await simulatedFraudProofSlashes(
                h,
                2,
                evidence.fraudProof
            );
            expect(slashed).to.include(h.getPeer(offenderIndex!).address);
            expect(slashed).to.not.include(h.getPeer(2).address);
            expect(
                await h
                    .control(h.getPeer(2))
                    .query.getBlockByHash(tail.hash)
                    .request()
            ).to.equal(null);
        });

        it("DisputeValidationService repeated support and tail identity executes valid transition before storage", async function () {
            const h = TestSession.getHarness();
            const {
                auditorIndex,
                dispute,
                auditingData,
                support,
                tail,
                tailBlock
            } = await stageCutOffAuditorWithValidTail(h);
            const run = [support.confirmation, tail.confirmation];
            const posted = postedProof(dispute, auditingData, {
                milestones: [run, run],
                milestoneSnapshots: [support.snapshot, support.snapshot],
                latestStateSnapshot: tail.snapshot,
                finalizedState: support.state
            });
            const query = h.control(h.getPeer(auditorIndex)).query;
            const replay = await h.rpcStub.holdBlockWork(
                auditorIndex,
                "proofConfirmationValidation"
            );

            const auditing = h.dispute.auditDispute(
                auditorIndex,
                posted.dispute,
                posted.auditingData
            );
            // its earlier occurrence as support does not store block 3
            await replay.waitUntilEntered();
            const heldBlock = await query
                .getBlockByHash(tailBlock.hash)
                .request();
            const heldSnapshot = await query
                .getStateSnapshotStructByHash(tailBlock.stateSnapshotHash)
                .request();
            await replay.release();
            const audit = await auditing;

            expect(heldBlock).to.equal(null);
            expect(heldSnapshot).to.equal(null);
            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
            // the replay ran the transition, then stored the exact block with
            // its confirmations
            const stored = await query.getBlockByHash(tailBlock.hash).request();
            expect(stored?.hash).to.equal(tailBlock.hash);
            expect(stored?.confirmationSignerAddresses).to.include.members([
                ...tailBlock.confirmationSignerAddresses
            ]);
            expect(
                await query
                    .getStateSnapshotStructByHash(tailBlock.stateSnapshotHash)
                    .request()
            ).to.not.equal(null);
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
            await h.network.blacklistAndDisconnectPeer(3);
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 1, 2],
                waitForFinalization: false
            });
            await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2], 1, {
                mode: "atLeast"
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
                .request({ timeoutMs: h.event.protocolEventTimeoutMs() });

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
