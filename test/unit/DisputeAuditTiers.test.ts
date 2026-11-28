import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import { DisputeFraudProofType } from "@/types/sol-enums";
import type { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { hash as randomHash, randomAddress } from "@test/factory";
import { stageConsumedTopUpAfterSetup } from "@test/fixtures/ConsumedInboundStaging";
import {
    blockConfirmationAt,
    runConcurrentVirtualFinalAudits,
    craftInvalidBlockAfter,
    craftInvalidLinkedBlock,
    holdsState,
    localFinalizedHeight,
    postSnapshotWaitingForPeers,
    replaceStateProof,
    runWithInvalidBlock,
    snapshotAt,
    stageAnchorAtLatestBlock,
    stageAuditorBelowAnchor,
    stageFrozenViewBehindDisputeTail,
    stagePendingJoinerMissingHopBase,
    unsignedOwnMilestonesThrough
} from "@test/fixtures/DisputeAuditStaging";
import { killSpamDispute } from "@test/fixtures/EvidenceComparisonStaging";
import { syncSpectatorOnServedPayload } from "@test/fixtures/MilestoneSyncStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import {
    craftConflictingAnchorRun,
    stageFinalBlocks,
    stageFinalityFromNextBlock,
    stageJoinHopWithLaterFinalPoint
} from "@test/fixtures/ProofOwnerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import type { DisputeStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ethers } from "ethers";

// The auditor verifies a dispute's proof and replays its tail from the latest
// locally finalized state, then the chain's anchor. Each case observes the
// auditor's `verifyMilestones` walks: the chain tier reads the chain, the
// first tier reads neither, and the mirror is never read.
describe("Unit: DisputeValidationService trusted-start tiers", function () {
    it("FR1: a conflict at a virtually final point produces an on-chain-valid counter", async function () {
        const h = TestSession.getHarness();
        const { observerIndex } = await stageFinalityFromNextBlock(h);
        const stateProof = await craftConflictingAnchorRun(h, {
            observerIndex,
            anchorHeight: 1,
            linked: true
        });
        const { dispute, disputeConfirmation } =
            await h.dispute.fetchConstructedDispute(0);
        await h.dispute.suppressDisputeInitiation([0, 1, 2]);
        await h.rpcStub.suppressDisputeKill(0);
        await h.rpcStub.suppressDisputeKill(2);
        replaceStateProof(dispute, stateProof.milestones);
        const audit = await h.dispute.auditDispute(observerIndex, dispute);
        expect(audit).to.include({ outcome: "returned", isValid: false });
        expect(audit.storedProof?.disputeFraudProofType).to.equal(
            DisputeFraudProofType.DisputeConflictsWithFinalState
        );
        const proof = Codec.decode(
            audit.storedProof!.encodedProof,
            DisputeFraudProofType.DisputeConflictsWithFinalState
        );
        expect(
            await h.channelManager.isDisputeConflictingWithFinalState.staticCall(
                dispute,
                proof
            )
        ).to.equal(true);
        const walk = await h.channelManager.verifyMilestones.staticCall(
            proof.finalProof
        );
        expect(walk.valid).to.equal(true);
        expect(Number(walk.finalizedSnapshot.blockHeight)).to.equal(2);
        dispute.input.selfRemoval = true;
        dispute.input.requireExistingDisputeWindow = false;
        await h.tamper.resignDispute(
            h.getPeer(0).signer,
            dispute,
            disputeConfirmation
        );
        await (
            await h
                .getPeer(0)
                .p2pInstance.stateChannelManagerContract.uploadDispute(
                    disputeConfirmation
                )
        ).wait();
        await h.event.waitForPeers("onDisputeKilled", [observerIndex], 1, {
            mode: "atLeast"
        });
        const kill = await readDisputeKill(h, h.getPeer(0).address);
        expect(kill.killer).to.equal(h.getPeer(observerIndex).address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeConflictsWithFinalState
        ]);
    });

    it("FR1: an audit retains virtual votes above a frozen view for a later final-conflict counter", async function () {
        const h = TestSession.getHarness();
        let served = "";
        const { forkId, observerIndex } = await stageFinalityFromNextBlock(
            h,
            async () => {
                const payload = await h
                    .control(h.getPeer(1))
                    .spectate.generateSyncPayload(
                        h.channelId,
                        h.activeForkId!,
                        1
                    )
                    .request();
                if (!payload)
                    throw new Error(
                        "The initial finalized state was not served"
                    );
                served = payload.encodedSyncPayload;
            }
        );
        const auditor = await syncSpectatorOnServedPayload(
            h,
            served,
            [0, 1, 2],
            [],
            async (peer) => {
                await h.rpcStub.dropNetworkConfirmations(peer.index);
            }
        );
        const before = await h
            .control(auditor)
            .query.getNextBlockHeight(forkId)
            .request();
        expect(before).to.equal(2);
        const original = await h.dispute.fetchConstructedDispute(observerIndex);
        expect(
            original.dispute.input.stateProof.milestones.map((milestone) =>
                milestone.blockConfirmations.map(
                    (confirmation) =>
                        Block.fromBlockConfirmation(confirmation).height
                )
            ),
            "the stored audit evidence must prove 2 through 3"
        ).to.deep.equal([[2, 3]]);
        const accepted = await h.dispute.auditDispute(
            auditor.index,
            original.dispute,
            original.auditingData
        );
        expect(accepted).to.include({ outcome: "returned", isValid: true });
        expect(
            await h.control(auditor).query.getNextBlockHeight(forkId).request()
        ).to.equal(before);
        const stateProof = await craftConflictingAnchorRun(h, {
            observerIndex,
            anchorHeight: 1,
            linked: true
        });
        const { dispute } = await h.dispute.fetchConstructedDispute(0);
        replaceStateProof(dispute, stateProof.milestones);
        const audit = await h.dispute.auditDispute(auditor.index, dispute);
        expect(audit).to.include({ outcome: "returned", isValid: false });
        expect(audit.storedProof?.disputeFraudProofType).to.equal(
            DisputeFraudProofType.DisputeConflictsWithFinalState
        );
        const proof = Codec.decode(
            audit.storedProof!.encodedProof,
            DisputeFraudProofType.DisputeConflictsWithFinalState
        );
        expect(
            await h.channelManager.isDisputeConflictingWithFinalState.staticCall(
                dispute,
                proof
            )
        ).to.equal(true);
        expect(
            await h.control(auditor).query.getNextBlockHeight(forkId).request()
        ).to.equal(before);
    });

    it("FR1: concurrent virtual-final audits keep the real proof first and counter the conflicting proof", async function () {
        await runConcurrentVirtualFinalAudits(TestSession.getHarness(), false);
    });

    it("FR1: concurrent virtual-final audits keep the forged proof first and counter the conflicting proof", async function () {
        await runConcurrentVirtualFinalAudits(TestSession.getHarness(), true);
    });

    describe("tier order", function () {
        it("U26: the latest locally finalized state verifies the proof -> accepted there, no chain walk, true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(
                await localFinalizedHeight(h, 1),
                "the auditor knows a final point"
            ).to.not.equal(null);
            const walks = await h.mirror.observe(1, "verifyMilestones");
            const trustedWalks = await h.mirror.observe(
                1,
                "verifyMilestonesFromTrustedStart"
            );

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await walks.observation();
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.equal(0);
            // the local final point is proven twice (conflict check, tier
            // start), then the first tier walks the dispute's proof from it
            const trusted = (await trustedWalks.observation()).chain;
            expect(trusted.reads).to.be.at.least(3);
            expect(trusted.answers.at(-1)).to.equal(true);
        });

        it("U27: no locally finalized state -> the chain's walk accepts, true", async function () {
            const h = TestSession.getHarness();
            // nothing is final while peer 2 is away
            await h.scenario.preDisputeSetupDisconnectedPeer();
            await h.control(h.getPeer(3)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(await localFinalizedHeight(h, 0)).to.equal(null);
            const walks = await h.mirror.observe(0, "verifyMilestones");

            const run = await h.dispute.auditDispute(0, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await walks.observation();
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.equal(1);
            expect(chain.failures).to.deep.equal([]);
        });

        it("D4: an authentic block conflicts with the local final point -> the conflict counter is stored before any tier walk", async function () {
            const h = TestSession.getHarness();
            const { anchor } = await stageFinalBlocks(h, {
                postAnchor: true,
                finalBlocks: 1
            });
            expect(await localFinalizedHeight(h, 0)).to.equal(
                anchor!.height + 1
            );
            // the author of anchor + 1 also signed a different, linked block
            const stateProof = await craftConflictingAnchorRun(h, {
                observerIndex: 0,
                anchorHeight: anchor!.height,
                linked: true
            });
            const { dispute } = await h.dispute.fetchConstructedDispute(1);
            replaceStateProof(dispute, stateProof.milestones);
            const walks = await h.mirror.observe(0, "verifyMilestones");
            const trustedWalks = await h.mirror.observe(
                0,
                "verifyMilestonesFromTrustedStart"
            );

            const run = await h.dispute.auditDispute(0, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeConflictsWithFinalState
            );
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
            // only the local final point's own proofs ran, never a walk of
            // the dispute's proof from it
            const trusted = (await trustedWalks.observation()).chain;
            expect(trusted.answers.every((answer) => answer === true)).to.equal(
                true
            );
        });

        it("U28 (audit entry): an auditor whose own finalized state is below the chain anchor -> the chain's anchor walk accepts, true", async function () {
            const h = TestSession.getHarness();
            const { anchor, belowAnchorIndex } =
                await stageAuditorBelowAnchor(h);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            const head = Block.fromBlockConfirmation(
                dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            expect(head.height).to.equal(anchor.blockHeight);
            const walks = await h.mirror.observe(
                belowAnchorIndex,
                "verifyMilestones"
            );

            const run = await h.dispute.auditDispute(belowAnchorIndex, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await walks.observation();
            expect(local.reads).to.equal(0);
            expect(chain.answers).to.deep.equal([true]);
        });

        it("U29: every walked tier rejects the proof (the posted snapshot of block 0 is block 1's) -> invalid at the chain, false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupDisconnectedPeer();
            await h.control(h.getPeer(3)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(dispute.input.stateProof.milestones).to.have.length(1);
            // the disputer commits to evidence its block 0 does not commit
            auditingData.milestoneSnapshots[0] = (
                await snapshotAt(h, 3, 1)
            ).toStruct();
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
            const walks = await h.mirror.observe(0, "verifyMilestones");

            const run = await h.dispute.auditDispute(0, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            const { local, chain } = await walks.observation();
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.equal(1);
        });
    });

    describe("thrown errors are fatal", function () {
        it("U30 (audit entry): storage lacks a required participant-change block of the local final point -> the audit throws, no walk runs, no proof", async function () {
            const h = TestSession.getHarness();
            const { forkId, joinHeight, observerIndex } =
                await stageJoinHopWithLaterFinalPoint(h, { postAnchor: true });
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(observerIndex);
            await h
                .control(h.getPeer(observerIndex))
                .stub.pruneStoredBlocksBelowAnchor(forkId, joinHeight + 1)
                .request();
            const walks = await h.mirror.observe(
                observerIndex,
                "verifyMilestones"
            );

            const run = await h.dispute.auditDispute(
                observerIndex,
                dispute,
                dispute.postedAuditingData ? auditingData : undefined
            );

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.match(
                /missing the participant-change block/
            );
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
        });

        it("U30: the chain's walk cannot reach the RPC node -> the audit throws it, no proof", async function () {
            const h = TestSession.getHarness();
            // nothing is final while peer 2 is away: the chain tier is asked
            await h.scenario.preDisputeSetupDisconnectedPeer();
            await h.control(h.getPeer(3)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(3);
            expect(await localFinalizedHeight(h, 0)).to.equal(null);
            const walks = await h.mirror.observe(0, "verifyMilestones");
            await h.mirror.failNextChainRead(
                0,
                "verifyMilestones",
                "transport"
            );

            const run = await h.dispute.auditDispute(0, dispute, auditingData);

            expect(run.outcome).to.equal("threw");
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await walks.observation();
            expect(local.reads).to.equal(0);
            expect(chain.failures).to.have.length(1);
            expect(chain.failureCodes).to.not.include("CALL_EXCEPTION");
        });
    });

    describe("trusted start and earlier history", function () {
        it("U31: an unproven earlier hop below the auditor's final point -> the auditor walks from its final point, never reads it, true", async function () {
            const h = TestSession.getHarness();
            await stageConsumedTopUpAfterSetup(h);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const invalidPrefix = await unsignedOwnMilestonesThrough(h, 0, 1);
            dispute.input.stateProof.milestones = [
                ...invalidPrefix,
                ...dispute.input.stateProof.milestones
            ];
            // premise: peer 2 knows a final point above the invalid hop
            expect(await localFinalizedHeight(h, 2)).to.be.greaterThan(1);
            const walks = await h.mirror.observe(2, "verifyMilestones");
            const trustedWalks = await h.mirror.observe(
                2,
                "verifyMilestonesFromTrustedStart"
            );

            const run = await h.dispute.auditDispute(2, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await walks.observation();
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.equal(0);
            // the walk from the final point ran and accepted the proof
            const trusted = (await trustedWalks.observation()).chain;
            expect(trusted.reads).to.be.at.least(3);
            expect(trusted.answers.at(-1)).to.equal(true);
        });

        it("U42: a hop whose committed snapshot no tier can supply, at a height the auditor holds no block for, with omitted data -> the audit throws, no unsupported counter", async function () {
            const h = TestSession.getHarness();
            await stageConsumedTopUpAfterSetup(h, {
                suppressWriterTimeouts: true
            });
            const forkId = h.activeForkId!;
            // peer 1 must not author the hop's height: a peer always holds
            // its own block. Round-robin puts another author after it.
            if ((await h.query.getNextPeerToWrite()).index === 1)
                await h.transition.advanceState({
                    count: 1,
                    waitForFinalization: true
                });
            // peer 1 stops receiving blocks: the next height is one it never
            // holds, so no final block of its own conflicts with the hop
            await h.rpcStub.dropNetworkConfirmations(1);
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [0, 2],
                waitForFinalization: false
            });
            const hopHeight = Number(
                await h
                    .control(h.getPeer(0))
                    .query.getLatestBlockHeight(forkId)
                    .request()
            );
            expect(
                await h
                    .control(h.getPeer(1))
                    .query.getBlockHashAt(forkId, hopHeight)
                    .request(),
                "the auditor holds no block at the hop's height"
            ).to.equal(null);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const previous = Block.fromBlockConfirmation(
                await blockConfirmationAt(h, 0, hopHeight - 1)
            );
            const real = Block.fromBlockConfirmation(
                await blockConfirmationAt(h, 0, hopHeight)
            );
            expect(
                real.author,
                "another peer authored the hop's height"
            ).to.not.equal(h.getPeer(1).address);
            // a hop committing a snapshot nobody holds
            const forgedHop = await craftInvalidLinkedBlock(h, {
                height: hopHeight,
                previousBlockHash: previous.hash,
                notAuthor: real.author
            });
            dispute.input.stateProof.milestones = [
                { blockConfirmations: [forgedHop] },
                ...dispute.input.stateProof.milestones
            ];

            const lagging = await h.dispute.auditDispute(1, dispute);

            expect(lagging.outcome).to.equal("threw");
            expect(
                lagging.outcome === "threw" ? lagging.threwMessage : ""
            ).to.contain("lacks the milestone snapshots");
            expect(lagging.disputeFraudProofCount).to.equal(0);
        });

        it("U42: an auditor holding a final block at the hop's height kills the dispute with DisputeConflictsWithFinalState, which the chain accepts", async function () {
            const h = TestSession.getHarness();
            await stageConsumedTopUpAfterSetup(h);
            const forkId = h.activeForkId!;
            const disputer = h.getPeer(0);
            const kills = await Promise.all(
                h.peers.map((peer) => h.rpcStub.suppressDisputeKill(peer.index))
            );
            // the lagging peer is not under test: it misses the dispute log
            await h.rpcStub.holdDisputeCommittedEvents(1, { passFirst: false });
            const block0 = Block.fromBlockConfirmation(
                await blockConfirmationAt(h, 0, 0)
            );
            const block1 = Block.fromBlockConfirmation(
                await blockConfirmationAt(h, 0, 1)
            );
            // a hop at height 1 committing a snapshot nobody holds
            const forgedHop = await craftInvalidLinkedBlock(h, {
                height: 1,
                previousBlockHash: block0.hash,
                notAuthor: block1.author
            });
            const { dispute } = await h.tamper.postTamperedDispute(
                disputer.index,
                (posted) => {
                    posted.input.stateProof.milestones = [
                        { blockConfirmations: [forgedHop] },
                        ...posted.input.stateProof.milestones
                    ];
                }
            );
            const walks = await h.mirror.observe(2, "verifyMilestones");

            const run = await h.dispute.auditDispute(2, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeConflictsWithFinalState
            );
            const proof = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeConflictsWithFinalState
            );
            expect(Number(proof.milestoneIndex)).to.equal(0);
            expect(Number(proof.blockIndex)).to.equal(0);
            // the conflict needs no walk of the dispute's proof
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
            // the auditor's own kill transaction lands on chain
            await kills[2]!.restore();
            await killSpamDispute(h, 2, disputer.address, forkId);
            const kill = await readDisputeKill(h, disputer.address);
            expect(kill.killer).to.equal(h.getPeer(2).address);
            expect(kill.appliedProofTypes).to.deep.equal([
                DisputeFraudProofType.DisputeConflictsWithFinalState
            ]);
            await h.assert.dispute.slashedOnChain(disputer.address);
        });
    });

    describe("independent checks after a successful walk", function () {
        it("U33/U90: the proof verifies at the first tier, but the dispute names an earlier real state as its latest -> false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const walks = await h.mirror.observe(1, "verifyMilestones");
            const honest = await h.dispute.auditDispute(1, dispute);
            expect(honest).to.include({ outcome: "returned", isValid: true });
            const honestWalks = await walks.observation();
            expect(honestWalks.local.reads + honestWalks.chain.reads).to.equal(
                0
            );

            const substituted: DisputeStruct =
                globalThis.structuredClone(dispute);
            substituted.input.latestStateSnapshotHash = (
                await snapshotAt(h, 0, 1)
            ).hash;
            const run = await h.dispute.auditDispute(1, substituted);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("U33: the proof verifies at the first tier, but the auditing data is omitted without the omission rule -> false + DisputeLastMilestoneNotFinalAndNoAuditingData", async function () {
            const h = TestSession.getHarness();
            // the pending joiner never signs: the data must be posted
            await h.scenario.preDisputeSetupCalldataPath();
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            const walks = await h.mirror.observe(1, "verifyMilestones");
            const posted = await h.dispute.auditDispute(
                1,
                dispute,
                auditingData
            );
            expect(posted).to.include({ outcome: "returned", isValid: true });
            const postedWalks = await walks.observation();
            expect(postedWalks.local.reads + postedWalks.chain.reads).to.equal(
                0
            );

            const omitted: DisputeStruct = globalThis.structuredClone(dispute);
            omitted.postedAuditingData = false;
            const run = await h.dispute.auditDispute(1, omitted);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
        });

        it("U33: the first tier accepts the proof, but the dispute's slash list names an unslashed address -> false + DisputeOnChainSlashesNotSubset", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.onChainSlashes = [
                ...dispute.input.onChainSlashes,
                randomAddress()
            ];
            const walks = await h.mirror.observe(1, "verifyMilestones");

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeOnChainSlashesNotSubset
            );
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
        });
    });

    describe("substituted latest state", function () {
        it("U90: posted auditing data names an earlier real snapshot as the latest state -> false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = true;
            expect(dispute.postedAuditingData).to.equal(true);
            auditingData.latestStateSnapshot = (
                await snapshotAt(h, 0, 0)
            ).toStruct();
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("U90: an empty genesis proof names a later real snapshot as the latest state -> false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            dispute.input.stateProof.milestones = [];
            dispute.input.latestStateSnapshotHash = (
                await snapshotAt(h, 0, 1)
            ).hash;

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("U90: posted auditing data names the real latest snapshot with another state's application-state bytes -> false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = true;
            expect(dispute.postedAuditingData).to.equal(true);
            const latest = StateSnapshot.from(auditingData.latestStateSnapshot);
            const other = await snapshotAt(h, 0, 0);
            expect(other.stateMachineStateHash).to.not.equal(
                latest.stateMachineStateHash
            );
            auditingData.latestStateSnapshot = h.byzantine.withStateHash(
                latest,
                other.stateMachineStateHash
            );
            dispute.input.latestStateSnapshotHash = StateSnapshot.from(
                auditingData.latestStateSnapshot
            ).hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("U90: an empty genesis proof names the genesis snapshot with another state's application-state bytes -> false + DisputeInvalidStateProof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const genesis = await h
                .control(h.getPeer(0))
                .dispute.getGenesisSnapshotStruct(h.activeForkId!)
                .request();
            if (!genesis) throw new Error("peer 0 holds no genesis snapshot");
            const genesisSnapshot = StateSnapshot.from(
                Codec.decode(genesis.encodedSnapshot, Type.StateSnapshot)
            );
            const other = await snapshotAt(h, 0, 1);
            expect(other.stateMachineStateHash).to.not.equal(
                genesisSnapshot.stateMachineStateHash
            );
            dispute.input.stateProof.milestones = [];
            dispute.input.latestStateSnapshotHash = StateSnapshot.from(
                h.byzantine.withStateHash(
                    genesisSnapshot,
                    other.stateMachineStateHash
                )
            ).hash;

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("U124: posted finalized-state bytes of the state the walk proves, which the auditor never held -> the replay starts from those verified bytes, no accusation, true", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingJoinerMissingHopBase(h);

            const run = await h.dispute.auditDispute(
                staged.charlieIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            // the verified posted state is kept and the tail replayed from it
            expect(
                await holdsState(h, staged.charlieIndex, staged.baseSnapshot)
            ).to.equal(true);
            expect(
                await holdsState(
                    h,
                    staged.charlieIndex,
                    await snapshotAt(h, 0, staged.hopHeight)
                )
            ).to.equal(true);
        });

        it("U124: posted finalized-state bytes of another state at that height, which the auditor never held -> the bytes are not used, the missing replay state is fatal, no accusation", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingJoinerMissingHopBase(h);
            const { dispute, auditingData } = staged;
            // the disputer commits other state bytes for the final point
            const real = String(
                auditingData.latestFinalizedStateStateMachineState
            );
            auditingData.latestFinalizedStateStateMachineState =
                real.slice(0, -2) + (real.endsWith("00") ? "01" : "00");
            expect(
                hash(auditingData.latestFinalizedStateStateMachineState)
            ).to.not.equal(staged.baseSnapshot.stateMachineStateHash);
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );

            const run = await h.dispute.auditDispute(
                staged.charlieIndex,
                dispute,
                auditingData
            );

            expect(run.outcome).to.equal("threw");
            expect(run.outcome === "threw" ? run.threwMessage : "").to.contain(
                "is not held"
            );
            expect(run.storedProof).to.equal(undefined);
            expect(run.disputeFraudProofCount).to.equal(0);
            expect(
                await holdsState(h, staged.charlieIndex, staged.baseSnapshot)
            ).to.equal(false);
        });
    });

    describe("malformed retained proof material", function () {
        it("U96/U116: an undecodable block after the last milestone's head, posted auditing data -> false + DisputeInvalidStateProof, no crash", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = true;
            expect(dispute.postedAuditingData).to.equal(true);
            const run0 = dispute.input.stateProof.milestones.at(-1)!;
            const head = run0.blockConfirmations.at(-1)!;
            run0.blockConfirmations.push({
                signedBlock: {
                    encodedBlock: randomHash(),
                    signature: head.signedBlock.signature
                },
                signatures: []
            });

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("U96/U116: an undecodable block after the anchor of an anchored last milestone, omitted auditing data -> false + DisputeInvalidStateProof, no crash", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            await postSnapshotWaitingForPeers(h);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            const run0 = dispute.input.stateProof.milestones.at(-1)!;
            const head = run0.blockConfirmations.at(-1)!;
            run0.blockConfirmations.push({
                signedBlock: {
                    encodedBlock: randomHash(),
                    signature: head.signedBlock.signature
                },
                signatures: []
            });

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
        });

        it("U96: a tail block whose author signature is another participant's real signature over it, audited by a participant that missed the tail -> false + DisputeInvalidBlockStructure at that block, no crash, nothing of the tail stored", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const tail = staged.dispute.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.filter(
                    (confirmation) =>
                        Block.fromBlockConfirmation(confirmation).height >
                        staged.frozenHeight
                );
            const tailHashes = tail.map((confirmation) =>
                String(Block.fromBlockConfirmation(confirmation).hash)
            );
            // a real signature over the block by a participant that is not its author
            const target = tail.find((confirmation) => {
                const block = Block.fromBlockConfirmation(confirmation);
                return confirmation.signatures.some(
                    (signature) =>
                        block.signatureToAddress(signature as string) !==
                        block.author
                );
            });
            expect(target, "a tail block with a non-author signature").to.not.be
                .undefined;
            const block = Block.fromBlockConfirmation(target!);
            target!.signedBlock.signature = target!.signatures.find(
                (signature) =>
                    block.signatureToAddress(signature as string) !==
                    block.author
            )!;

            const run = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockStructure
            );
            const query = h.control(h.getPeer(staged.frozenIndex)).query;
            for (const blockHash of tailHashes)
                expect(
                    await query.getBlockByHash(blockHash as Hash).request(),
                    `tail block ${blockHash} is not stored`
                ).to.be.null;
        });

        it("U96: the last milestone's first block carries a confirmation signature that recovers no signer, audited by a participant that missed the tail -> false + DisputeInvalidStateProof, no crash, nothing of the tail stored", async function () {
            const h = TestSession.getHarness();
            const staged = await stageFrozenViewBehindDisputeTail(h);
            const lastRun =
                staged.dispute.input.stateProof.milestones.at(
                    -1
                )!.blockConfirmations;
            const tailHashes = lastRun
                .map((confirmation) =>
                    Block.fromBlockConfirmation(confirmation)
                )
                .filter((block) => block.height > staged.frozenHeight)
                .map((block) => String(block.hash));
            expect(tailHashes).to.not.be.empty;
            expect(lastRun[0].signatures.length).to.be.greaterThan(0);
            // 65 bytes that are no ECDSA signature
            lastRun[0].signatures[0] = ethers.concat([
                ethers.id("not a signature"),
                ethers.id("not a signature either"),
                "0x05"
            ]);

            const run = await h.dispute.auditDispute(
                staged.frozenIndex,
                staged.dispute,
                staged.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            const query = h.control(h.getPeer(staged.frozenIndex)).query;
            for (const blockHash of tailHashes)
                expect(
                    await query.getBlockByHash(blockHash as Hash).request(),
                    `tail block ${blockHash} is not stored`
                ).to.be.null;
        });

        it("U96: an undecodable inner block of a milestone wholly below the chain anchor -> skipped history, true", async function () {
            const h = TestSession.getHarness();
            const { anchorHeight } = await stageAnchorAtLatestBlock(h);
            expect(anchorHeight).to.be.greaterThan(1);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const block0 = await blockConfirmationAt(h, 0, 0);
            const block1 = await blockConfirmationAt(h, 0, 1);
            dispute.input.stateProof.milestones = [
                {
                    blockConfirmations: [
                        block0,
                        {
                            signedBlock: {
                                encodedBlock: randomHash(),
                                signature: block0.signedBlock.signature
                            },
                            signatures: []
                        },
                        block1
                    ]
                },
                ...dispute.input.stateProof.milestones
            ];

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });

    // A block-specific challenge names its block by its position from the
    // start of the last milestone; the chain's anchor protects it and every
    // block before it.
    describe("block-specific challenge target", function () {
        it("U88: a fault right after the chain anchor, audited by an auditor on its own finalized state and by one on the chain tier, after pruning below the anchor -> both challenge last-milestone position 1", async function () {
            const h = TestSession.getHarness();
            const { anchor, currentIndex, belowAnchorIndex } =
                await stageAuditorBelowAnchor(h);
            const forkId = h.activeForkId!;
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const run = [await blockConfirmationAt(h, 0, anchor.blockHeight)];
            run.push(await craftInvalidBlockAfter(h, run));
            replaceStateProof(dispute, [{ blockConfirmations: run }]);
            for (const index of [currentIndex, belowAnchorIndex])
                await h
                    .control(h.getPeer(index))
                    .stub.pruneStoredBlocksBelowAnchor(
                        forkId,
                        anchor.blockHeight
                    )
                    .request();
            const isEligible = (blockIndex: number) =>
                h.channelManager.isBlockChallengeEligible.staticCall(
                    dispute,
                    blockIndex
                );
            expect(await isEligible(0)).to.equal(false);
            expect(await isEligible(1)).to.equal(true);
            expect(await isEligible(2)).to.equal(false);
            // both replay from the chain's anchor
            for (const index of [currentIndex, belowAnchorIndex]) {
                const walks = await h.mirror.observe(index, "verifyMilestones");
                const audit = await h.dispute.auditDispute(index, dispute);
                expect(audit).to.include({
                    outcome: "returned",
                    isValid: false
                });
                expect(audit.storedProof?.disputeFraudProofType).to.equal(
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                );
                const evidence = Codec.decode(
                    audit.storedProof!.encodedProof,
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                );
                expect(Number(evidence.blockIndex)).to.equal(1);
                const { local, chain } = await walks.observation();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([true]);
            }
        });

        it("U88: an invalid block below the chain anchor inside one genesis-linked last milestone -> the chain tier replays from the anchor; neither auditor challenges, true", async function () {
            const h = TestSession.getHarness();
            const { anchor, currentIndex, belowAnchorIndex } =
                await stageAuditorBelowAnchor(h);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const run = await runWithInvalidBlock(h, {
                fromHeight: 0,
                invalidHeight: 1,
                toHeight: anchor.blockHeight
            });
            replaceStateProof(dispute, [{ blockConfirmations: run }]);
            expect(dispute.input.latestStateSnapshotHash).to.equal(anchor.hash);
            for (let blockIndex = 0; blockIndex < run.length; blockIndex++)
                expect(
                    await h.channelManager.isBlockChallengeEligible.staticCall(
                        dispute,
                        blockIndex
                    )
                ).to.equal(false);
            // both replay from the chain's anchor
            for (const index of [currentIndex, belowAnchorIndex]) {
                const walks = await h.mirror.observe(index, "verifyMilestones");
                const audit = await h.dispute.auditDispute(index, dispute);
                expect(audit).to.include({
                    outcome: "returned",
                    isValid: true
                });
                expect(audit.disputeFraudProofCount).to.equal(0);
                const { local, chain } = await walks.observation();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([true]);
            }
        });

        it("U88: the chain anchor in the middle of the last milestone, an invalid block before it and a fault after it -> both auditors challenge the fault's position, never the protected block", async function () {
            const h = TestSession.getHarness();
            const { anchor, currentIndex, belowAnchorIndex } =
                await stageAuditorBelowAnchor(h);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const run = await runWithInvalidBlock(h, {
                fromHeight: 0,
                invalidHeight: 1,
                toHeight: anchor.blockHeight
            });
            run.push(await craftInvalidBlockAfter(h, run));
            replaceStateProof(dispute, [{ blockConfirmations: run }]);
            const faultIndex = run.length - 1;
            const isEligible = (blockIndex: number) =>
                h.channelManager.isBlockChallengeEligible.staticCall(
                    dispute,
                    blockIndex
                );
            // the boundary position, the one after it, and past the run
            expect(await isEligible(faultIndex - 1)).to.equal(false);
            expect(await isEligible(faultIndex)).to.equal(true);
            expect(await isEligible(faultIndex + 1)).to.equal(false);
            for (const index of [currentIndex, belowAnchorIndex]) {
                const walks = await h.mirror.observe(index, "verifyMilestones");
                const audit = await h.dispute.auditDispute(index, dispute);
                expect(audit).to.include({
                    outcome: "returned",
                    isValid: false
                });
                expect(audit.storedProof?.disputeFraudProofType).to.equal(
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                );
                const evidence = Codec.decode(
                    audit.storedProof!.encodedProof,
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                );
                expect(Number(evidence.blockIndex)).to.equal(faultIndex);
                const { local, chain } = await walks.observation();
                expect(local.reads).to.equal(0);
                expect(chain.answers).to.deep.equal([true]);
            }
        });
    });

    // The replay runs from the chain's anchor, and only that replay can accuse.
    describe("replay precedence", function () {
        it("an invalid block below the chain anchor, audited by an auditor whose own finalized state is below it -> the chain tier replays from the anchor's verified state, no accusation, true", async function () {
            const h = TestSession.getHarness();
            // peer 2 is cut off below the chain anchor: its own finalized
            // state is below it
            const { anchor, belowAnchorIndex } =
                await stageAuditorBelowAnchor(h);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            // one genesis-linked run whose invalid block lies below the anchor
            const run = await runWithInvalidBlock(h, {
                fromHeight: 0,
                invalidHeight: 1,
                toHeight: anchor.blockHeight
            });
            replaceStateProof(dispute, [{ blockConfirmations: run }]);
            expect(dispute.input.latestStateSnapshotHash).to.equal(anchor.hash);
            const walks = await h.mirror.observe(
                belowAnchorIndex,
                "verifyMilestones"
            );

            const audit = await h.dispute.auditDispute(
                belowAnchorIndex,
                dispute
            );

            expect(audit).to.include({ outcome: "returned", isValid: true });
            expect(audit.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await walks.observation();
            expect(local.reads).to.equal(0);
            expect(chain.reads).to.equal(1);
        });

        it("the same run with a fault after the chain anchor, audited on the chain tier -> the chain tier's replay accuses, at the fault's position", async function () {
            const h = TestSession.getHarness();
            const { anchor, belowAnchorIndex } =
                await stageAuditorBelowAnchor(h);
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            const run = await runWithInvalidBlock(h, {
                fromHeight: 0,
                invalidHeight: 1,
                toHeight: anchor.blockHeight
            });
            run.push(await craftInvalidBlockAfter(h, run));
            replaceStateProof(dispute, [{ blockConfirmations: run }]);

            const audit = await h.dispute.auditDispute(
                belowAnchorIndex,
                dispute
            );

            expect(audit).to.include({ outcome: "returned", isValid: false });
            expect(audit.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            const evidence = Codec.decode(
                audit.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            );
            expect(Number(evidence.blockIndex)).to.equal(run.length - 1);
        });
    });
});
