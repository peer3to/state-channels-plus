import Block from "@/models/Block";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import { Codec, hash, Type } from "@/utils";
import { hash as randomHash, randomAddress } from "@test/factory";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import {
    expectConflictWithAuditorsFinalBlock,
    highestMissingStateHeight,
    holdsState,
    localFinalizedHeight,
    postDepartedTimeoutOf,
    snapshotAt,
    stageColludersForkAfterAnchor,
    stagePendingJoinerMissingHopBase,
    waitUntilTimeoutIsTimely,
    stageDepartedDisputerBehindLateAuditor,
    stagePendingDisputerBehindLateAuditor,
    waitUntilAuditsSettled
} from "@test/fixtures/DisputeAuditStaging";
import {
    killSpamDispute,
    waitForCommittedDisputeOf
} from "@test/fixtures/EvidenceComparisonStaging";
import { pruneBelowAnchor } from "@test/fixtures/MilestoneSyncStaging";
import { readAccusedBlock } from "@test/fixtures/OlderDisputeStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

describe("Unit: DisputeValidationService data availability and older disputes", function () {
    describe("data availability", function () {
        it("U38: auditing data omitted while a participant's signature is missing -> DisputeLastMilestoneNotFinalAndNoAuditingData, the audit stops before the walk and every later check", async function () {
            const h = TestSession.getHarness();
            // peer 2 is away: it signs nothing
            await h.scenario.preDisputeSetupDisconnectedPeer();
            const { dispute } = await h.dispute.fetchConstructedDispute(3);
            expect(dispute.postedAuditingData).to.equal(true);
            dispute.postedAuditingData = false;
            // a later check would also fail: the early counter ends the audit
            dispute.input.onChainSlashes = [randomAddress()];
            const walks = await h.mirror.observe(0, "verifyMilestones");

            const run = await h.dispute.auditDispute(0, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            expect(run.disputeFraudProofCount).to.equal(1);
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
        });

        it("U38: auditing data omitted while a pending participant's signature is missing -> DisputeLastMilestoneNotFinalAndNoAuditingData, the audit stops before the walk and every later check", async function () {
            const h = TestSession.getHarness();
            // the forced joiner is pending and never signs
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            dispute.postedAuditingData = false;
            dispute.input.onChainSlashes = [randomAddress()];
            const walks = await h.mirror.observe(1, "verifyMilestones");

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeLastMilestoneNotFinalAndNoAuditingData
            );
            expect(run.disputeFraudProofCount).to.equal(1);
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
        });

        it("U39: required auditing data posted, wrong dispute output -> the audit proceeds past the proof to DisputeInvalidOutputState", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(true);
            dispute.outputSnapshotDataHash = randomHash();

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidOutputState
            );
        });
    });

    describe("below the on-chain anchor", function () {
        it("U89: a stale omitted-data dispute below the same-fork anchor, audited after pruning the obsolete blocks, snapshots and states below the anchor -> DisputeStateProofBelowOnChainAnchor before any walk", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const { dispute } = await h.dispute.fetchConstructedDispute(0);
            expect(dispute.postedAuditingData).to.equal(false);
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            const anchor = await h.transition.postSnapshotWait();
            expect(anchor, "the same-fork snapshot post must land").to.not.be
                .undefined;
            const latest = Block.fromBlockConfirmation(
                dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            const pruned = await pruneBelowAnchor(
                h,
                h.getPeer(1),
                forkId,
                anchor!.blockHeight
            );
            expect(pruned.prunedHeights).to.include(latest.height);
            expect(
                pruned.prunedSnapshotHashes,
                "the dispute's latest snapshot is unavailable"
            ).to.include(latest.stateSnapshotHash);
            const walks = await h.mirror.observe(1, "verifyMilestones");

            const run = await h.dispute.auditDispute(1, dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            );
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
        });

        it("U89: the same stale dispute with posted auditing data, the obsolete snapshots and states pruned too -> DisputeStateProofBelowOnChainAnchor before any walk", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // posting is never wrong: the committed hash already covers it
            dispute.postedAuditingData = true;
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            const anchor = await h.transition.postSnapshotWait();
            expect(anchor, "the same-fork snapshot post must land").to.not.be
                .undefined;
            const latest = Block.fromBlockConfirmation(
                dispute.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            const pruned = await pruneBelowAnchor(
                h,
                h.getPeer(1),
                forkId,
                anchor!.blockHeight
            );
            expect(pruned.prunedHeights).to.include(latest.height);
            expect(
                pruned.prunedSnapshotHashes,
                "the dispute's latest snapshot is unavailable"
            ).to.include(latest.stateSnapshotHash);
            const walks = await h.mirror.observe(1, "verifyMilestones");

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeStateProofBelowOnChainAnchor
            );
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
        });
    });

    // A peer that synced compactly holds its finalized state and later, not
    // the application states below it.
    describe("auditor without the older state", function () {
        it("U94: the disputer signed a newer block than its dispute's latest state, which the auditor never held -> DisputeNotLatestState from that signature, no backward replay", async function () {
            const h = TestSession.getHarness();
            const joiner = await h.scenario.spectatorPromotedViaJoinChannelWait(
                {
                    initialPeers: 3,
                    initialTransitions: 4
                }
            );
            const olderHeight = await highestMissingStateHeight(
                h,
                joiner.index
            );
            expect(
                olderHeight,
                "the compact sync must leave an older state behind"
            ).to.be.greaterThan(-1);
            await h.tamper.stubConstructDispute(
                0,
                async (dispute, sm, args) => {
                    await sm.p2pManager.localRpc.dispute.truncateStateProofToHeight(
                        dispute,
                        args.height as number
                    );
                },
                { autoRestore: true, args: { height: olderHeight } }
            );
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            // the joiner's pending JOIN is in the required set below the join
            dispute.postedAuditingData = true;

            const run = await h.dispute.auditDispute(
                joiner.index,
                dispute,
                auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeNotLatestState
            );
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeNotLatestState
            );
            const newer = Codec.decode(evidence.encodedBlock, Type.Block);
            expect(
                Number(newer.transaction.header.transactionCnt)
            ).to.be.greaterThan(olderHeight);
            expect(
                await holdsState(
                    h,
                    joiner.index,
                    await snapshotAt(h, 0, olderHeight)
                ),
                "the audit must not replay backward"
            ).to.equal(false);
        });

        it("U41: an auditor missing older application states but holding a newer finalized state audits a current dispute -> no missing-state failure, true", async function () {
            const h = TestSession.getHarness();
            const joiner = await h.scenario.spectatorPromotedViaJoinChannelWait(
                {
                    initialPeers: 3,
                    initialTransitions: 4
                }
            );
            expect(
                await highestMissingStateHeight(h, joiner.index),
                "the compact sync must leave an older state behind"
            ).to.be.greaterThan(-1);
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);

            const run = await h.dispute.auditDispute(
                joiner.index,
                dispute,
                dispute.postedAuditingData ? auditingData : undefined
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("U121: a departed, still chain-eligible participant disputes its last signed state; a late-synced pending auditor without that state -> no invented counter, no fatal error, true, and its own dispute is newer", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 3,
                transitionCount: 2
            });
            const forkId = h.activeForkId!;
            for (const peer of h.peers)
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            const leaver = await h.query.getNextPeerToWrite();
            // its exit post never lands: it stays chain-eligible
            await h.rpcStub.holdSnapshotPostSend(leaver.index);
            const remaining = h.peers
                .map((peer) => peer.index)
                .filter((index) => index !== leaver.index);
            await h.transition.participantLeaveStateTransition({
                leaverIndex: leaver.index,
                waitForPeers: remaining
            });
            const leaveHeight = (await h
                .control(leaver)
                .query.getLatestBlockHeight(forkId)
                .request())!;
            // the initial sync can only reach the live participants: the
            // departed signer is isolated from the spectator until it synced
            const { peer: auditor } = await h.join.addSpectatorAuthoring({
                authoringPeerIndices: remaining,
                minimumBlocks: 2,
                maximumBlocks: 20,
                waitForFinalization: true,
                beforeConnect: async (created) => {
                    await h
                        .control(created)
                        .network.blacklistAndDisconnectPeerByAddress(
                            leaver.address
                        )
                        .request();
                    await h
                        .control(leaver)
                        .network.blacklistAndDisconnectPeerByAddress(
                            created.address
                        )
                        .request();
                }
            });
            // a join needs every on-chain threshold participant, and the
            // departed signer still is one: reconnect the synced spectator
            await h.network.reconnectPeers([auditor.index]);
            await h.join.joinChannelWait({ joiner: auditor });
            const leaveSnapshot = await snapshotAt(
                h,
                remaining[0]!,
                leaveHeight
            );
            expect(
                await holdsState(h, auditor.index, leaveSnapshot),
                "the late auditor must not hold the departed signer's last state"
            ).to.equal(false);
            await h.control(leaver).dispute.setForceExit(true).request();
            // it still observes later blocks it never signs: its dispute
            // names its own last signed state
            await h.tamper.stubConstructDispute(
                leaver.index,
                async (dispute, sm, args) => {
                    await sm.p2pManager.localRpc.dispute.truncateStateProofToHeight(
                        dispute,
                        args.height as number
                    );
                },
                {
                    autoRestore: true,
                    markMalicious: false,
                    args: { height: leaveHeight }
                }
            );
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(leaver.index);
            expect(dispute.input.latestStateSnapshotHash).to.equal(
                leaveSnapshot.hash
            );
            // the pending joiner never signed it: the data must be posted
            dispute.postedAuditingData = true;

            const run = await h.dispute.auditDispute(
                auditor.index,
                dispute,
                auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            expect(await holdsState(h, auditor.index, leaveSnapshot)).to.equal(
                false
            );
            // the newer state this auditor would submit for reduction
            const own = await h.execOnHost(
                h.getPeer(auditor.index),
                async (sm, args) => {
                    const { dispute: ownDispute } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    return (
                        sm.agreementManager.getLatestBlockFromStateProof(
                            ownDispute.input.stateProof
                        )?.height ?? -1
                    );
                },
                { forkId }
            );
            expect(own).to.be.greaterThan(leaveHeight);
        });
    });

    // The auditor without the older state does not judge it: its own newer
    // dispute carries its state into the reduction.
    describe("newer-state submission", function () {
        it("U113: a pending disputer's state that the late pending auditor never held -> no backward replay, no newer-signature counter, no balance read of that state, no fatal error; the auditor's own newer dispute lands on chain", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingDisputerBehindLateAuditor(h);
            const auditor = h.getPeer(staged.auditorIndex);
            const recorder = await h.rpcStub.recordEvidenceComparisons(
                staged.auditorIndex
            );
            const balance = await h.mirror.observe(
                staged.auditorIndex,
                "verifyBalanceInvariantCheckSnapshot"
            );
            const trustedWalks = await h.mirror.observe(
                staged.auditorIndex,
                "verifyMilestonesFromTrustedStart"
            );
            const submissions = await h.rpcStub.recordDisputeSubmissions(
                staged.auditorIndex,
                { forward: true }
            );

            const run = await h.dispute.auditDispute(
                staged.auditorIndex,
                staged.dispute,
                staged.dispute.postedAuditingData
                    ? staged.auditingData
                    : undefined
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await balance.observation();
            expect(local.reads + chain.reads).to.equal(0);
            await balance.restore();
            // the audit ran: it walked the older proof from its final point
            const trusted = (await trustedWalks.observation()).local;
            expect(trusted.reads).to.be.at.least(1);
            expect(trusted.answers.at(-1)).to.equal(true);
            await trustedWalks.restore();
            expect(
                await holdsState(h, staged.auditorIndex, staged.olderSnapshot),
                "the audit must not replay backward"
            ).to.equal(false);

            await h.tamper.postTamperedDispute(staged.disputerIndex, () => {}, {
                markMalicious: false
            });
            const own = await waitForCommittedDisputeOf(h, 0, auditor.address);
            await waitUntilAuditsSettled(h, recorder, 1);
            expect((await recorder.audits())[0]).to.include({
                outcome: "resolved",
                answer: true
            });
            // its force-join route is closed (staging): the one upload it
            // sent is the dispute the evidence comparison started
            const sent = await submissions.submissions();
            expect(sent).to.have.length(1);
            expect(
                hash(
                    Codec.encode(
                        Codec.decode(sent[0]!.encodedDispute, Type.Dispute),
                        Type.Dispute
                    )
                )
            ).to.equal(hash(Codec.encode(own, Type.Dispute)));
            expect(
                await h.channelManager.getWindowCommitments(
                    h.channelId,
                    staged.forkId
                )
            ).to.include(hash(Codec.encode(own, Type.Dispute)));
            const ownHead = Block.fromBlockConfirmation(
                own.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            expect(ownHead.height).to.be.greaterThan(staged.olderHeight);
        });

        it("U114: the auditor's newer submission lacks the pending disputer's signature and holds no anchor -> its auditing data is posted and it still lands on chain", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingDisputerBehindLateAuditor(h);
            const auditor = h.getPeer(staged.auditorIndex);
            const disputer = h.getPeer(staged.disputerIndex);

            await h.tamper.postTamperedDispute(staged.disputerIndex, () => {}, {
                markMalicious: false
            });
            const own = await waitForCommittedDisputeOf(h, 0, auditor.address);

            expect(own.postedAuditingData).to.equal(true);
            expect(
                await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                    own
                )
            ).to.equal(false);
            const signers = own.input.stateProof.milestones
                .at(-1)!
                .blockConfirmations.flatMap((confirmation) => [
                    ...Block.fromBlockConfirmation(confirmation)
                        .allSignerAddresses
                ])
                .map(String);
            expect(signers).to.not.include(disputer.address);
            expect(
                await h.channelManager.getWindowCommitments(
                    h.channelId,
                    staged.forkId
                )
            ).to.include(hash(Codec.encode(own, Type.Dispute)));
        });

        it("U121: a departed, still chain-eligible participant's last signed state that the late pending auditor never held -> no balance read of that state, no counter; the auditor's own newer dispute lands on chain", async function () {
            const h = TestSession.getHarness();
            const staged = await stageDepartedDisputerBehindLateAuditor(h);
            const auditor = h.getPeer(staged.auditorIndex);
            const recorder = await h.rpcStub.recordEvidenceComparisons(
                staged.auditorIndex
            );
            const balance = await h.mirror.observe(
                staged.auditorIndex,
                "verifyBalanceInvariantCheckSnapshot"
            );
            const trustedWalks = await h.mirror.observe(
                staged.auditorIndex,
                "verifyMilestonesFromTrustedStart"
            );
            const submissions = await h.rpcStub.recordDisputeSubmissions(
                staged.auditorIndex,
                { forward: true }
            );

            const run = await h.dispute.auditDispute(
                staged.auditorIndex,
                staged.dispute,
                staged.dispute.postedAuditingData
                    ? staged.auditingData
                    : undefined
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
            const { local, chain } = await balance.observation();
            expect(local.reads + chain.reads).to.equal(0);
            await balance.restore();
            // the audit ran: it walked the older proof from its final point
            const trusted = (await trustedWalks.observation()).local;
            expect(trusted.reads).to.be.at.least(1);
            expect(trusted.answers.at(-1)).to.equal(true);
            await trustedWalks.restore();
            expect(
                await holdsState(h, staged.auditorIndex, staged.leaveSnapshot)
            ).to.equal(false);

            await h.tamper.postTamperedDispute(staged.leaverIndex, () => {}, {
                markMalicious: false
            });
            const own = await waitForCommittedDisputeOf(
                h,
                staged.remaining[0]!,
                auditor.address
            );
            await waitUntilAuditsSettled(h, recorder, 1);
            expect((await recorder.audits())[0]).to.include({
                outcome: "resolved",
                answer: true
            });
            // its force-join route is closed (staging): the one upload it
            // sent is the dispute the evidence comparison started
            const sent = await submissions.submissions();
            expect(sent).to.have.length(1);
            expect(
                hash(
                    Codec.encode(
                        Codec.decode(sent[0]!.encodedDispute, Type.Dispute),
                        Type.Dispute
                    )
                )
            ).to.equal(hash(Codec.encode(own, Type.Dispute)));
            expect(
                await h.channelManager.getWindowCommitments(
                    h.channelId,
                    staged.forkId
                )
            ).to.include(hash(Codec.encode(own, Type.Dispute)));
            const ownHead = Block.fromBlockConfirmation(
                own.input.stateProof.milestones
                    .at(-1)!
                    .blockConfirmations.at(-1)!
            );
            expect(ownHead.height).to.be.greaterThan(staged.leaveHeight);
        });
    });

    describe("colluders' fork after the chain anchor", function () {
        it("colluders fork right after the chain anchor and a pending joiner without the anchor state audits the omitted-data dispute -> it stores DisputeConflictsWithFinalState at a height of its own final history before any walk, does not throw, and the chain accepts it", async function () {
            const h = TestSession.getHarness();
            const staged = await stageColludersForkAfterAnchor(h);
            expect(staged.dispute.postedAuditingData).to.equal(false);
            const finalHeight = await localFinalizedHeight(
                h,
                staged.charlieIndex
            );
            expect(finalHeight ?? -1).to.be.greaterThan(
                staged.anchor.blockHeight
            );
            const walks = await h.mirror.observe(
                staged.charlieIndex,
                "verifyMilestones"
            );

            const run = await h.dispute.auditDispute(
                staged.charlieIndex,
                staged.dispute
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeConflictsWithFinalState
            );
            expect(run.disputeFraudProofCount).to.equal(1);
            const proof = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeConflictsWithFinalState
            );
            expect(
                await h.channelManager.isDisputeConflictingWithFinalState.staticCall(
                    staged.dispute,
                    proof
                )
            ).to.equal(true);
            // the conflict is found before any walk and its tail replay
            const { local, chain } = await walks.observation();
            expect(local.reads + chain.reads).to.equal(0);
            await expectConflictWithAuditorsFinalBlock(h, {
                auditorIndex: staged.charlieIndex,
                dispute: staged.dispute,
                proof,
                anchorHeight: staged.anchor.blockHeight,
                auditorFinalHeight: finalHeight!
            });
            expect(
                await holdsState(h, staged.charlieIndex, staged.anchor)
            ).to.equal(false);
        });
    });

    describe("departed submitter's false timeout", function () {
        it("U125: a departed, still chain-eligible participant times out the honest next author of its last signed state -> TimeoutThreshold from that block's direct signatures without the departed signer, and the kill slashes it", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                transitionCount: 2
            });
            const forkId = h.activeForkId!;
            for (const peer of h.peers) {
                await h.rpcStub.holdReductionRace(peer.index);
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            }
            const kills = await Promise.all(
                h.peers.map((peer) => h.rpcStub.suppressDisputeKill(peer.index))
            );
            const alice = await h.query.getNextPeerToWrite();
            await h.rpcStub.holdSnapshotPostSend(alice.index);
            const remaining = h.peers
                .map((peer) => peer.index)
                .filter((index) => index !== alice.index);
            await h.transition.participantLeaveStateTransition({
                leaverIndex: alice.index,
                waitForPeers: remaining
            });
            await h.network.blacklistAndDisconnectPeer(alice.index);
            const leaveBlock = (await h
                .control(alice)
                .query.getLatestBlockInfo(forkId)
                .request())!;
            const leaveHeight = (await h
                .control(alice)
                .query.getLatestBlockHeight(forkId)
                .request())!;
            const bob = await h.query.getNextPeerToWrite();
            expect(bob.index).to.not.equal(alice.index);
            // the false accusation: Bob did not produce the next block
            await h.tamper.plantFreshTimeoutForParticipant(
                alice.index,
                bob.address
            );
            await h.transition.advanceState({
                count: 1,
                waitForPeers: remaining
            });
            await waitFor(
                async () =>
                    (await h
                        .control(bob)
                        .query.didEveryoneSignBlockAt(forkId, leaveHeight + 1)
                        .request()) === true,
                h.event.protocolEventTimeoutMs()
            );
            const leaveTimestamp = Number(
                Codec.decode(leaveBlock.encodedBlock, Type.Block).transaction
                    .header.timestamp
            );
            await waitUntilTimeoutIsTimely(h, leaveTimestamp, leaveHeight + 1);
            const posted = await h.tamper.postTamperedDispute(
                alice.index,
                () => {}
            );
            expect(posted.dispute.input.timeout.participant).to.equal(
                bob.address
            );

            const run = await h.dispute.auditDispute(bob.index, posted.dispute);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutThreshold
            );
            expect(run.storedProof?.proofParticipant).to.equal(alice.address);
            // Alice signed nothing newer: the counter does not rest on that
            const signed = await h
                .control(bob)
                .query.getLatestSignedBlockByParticipant(forkId, alice.address)
                .request();
            expect(signed?.height).to.equal(leaveHeight);

            await kills[bob.index]!.restore();
            await killSpamDispute(h, bob.index, alice.address, forkId);
            await h.assert.dispute.slashedOnChain(alice.address);
        });
    });

    describe("timeout superseded by a final state", function () {
        it("a departed participant's false timeout of a peer that did not author the next height, audited by a late pending auditor with a later final state but without the departed state or calldata there -> false + exactly TimeoutSupersededByFinalState, which the chain accepts", async function () {
            const h = TestSession.getHarness();
            const staged = await stageDepartedDisputerBehindLateAuditor(h);
            const leaver = h.getPeer(staged.leaverIndex);
            const auditor = h.getPeer(staged.auditorIndex);
            const accusedHeight = staged.leaveHeight + 1;
            // the accused did not author the next height: no direct-signature counter
            const { author } = await readAccusedBlock(
                h,
                staged.remaining[0]!,
                staged.forkId,
                accusedHeight,
                leaver.address
            );
            const accused = h.getPeer(
                staged.remaining.find(
                    (index) => h.getPeer(index).address !== author
                )!
            );
            expect(
                (await localFinalizedHeight(h, staged.auditorIndex)) ?? -1
            ).to.be.at.least(accusedHeight);

            const posted = await postDepartedTimeoutOf(h, {
                leaverIndex: staged.leaverIndex,
                accused: accused.address
            });
            const run = await h.dispute.auditDispute(
                staged.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutSupersededByFinalState
            );
            expect(run.storedProof?.proofParticipant).to.equal(leaver.address);
            expect(run.disputeFraudProofCount).to.equal(1);
            const proof = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.TimeoutSupersededByFinalState
            );
            expect(proof.finalProof.forkId).to.equal(staged.forkId);
            expect(
                await h.channelManager.isTimeoutSupersededByFinalState.staticCall(
                    posted.dispute,
                    proof
                )
            ).to.equal(true);
            // the counter needed neither the departed state nor calldata
            expect(
                await holdsState(h, staged.auditorIndex, staged.leaveSnapshot)
            ).to.equal(false);
            expect(
                await h
                    .control(auditor)
                    .query.getBlockCalldataTimestamp(
                        staged.forkId,
                        accusedHeight,
                        accused.address
                    )
                    .request()
            ).to.equal(null);
        });

        it("control: a departed participant's honest timeout of the next author who produced nothing, audited by a participant whose final state is below the timeout height -> true, no TimeoutSupersededByFinalState", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                peerCount: 4,
                transitionCount: 2
            });
            for (const peer of h.peers)
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            const alice = await h.query.getNextPeerToWrite();
            // her exit post never lands: she stays chain-eligible
            await h.rpcStub.holdSnapshotPostSend(alice.index);
            const remaining = h.peers
                .map((peer) => peer.index)
                .filter((index) => index !== alice.index);
            await h.transition.participantLeaveStateTransition({
                leaverIndex: alice.index,
                waitForPeers: remaining
            });
            await h.network.blacklistAndDisconnectPeer(alice.index);
            // Bob is next and authors nothing
            const bob = await h.query.getNextPeerToWrite();
            const auditorIndex = remaining.find(
                (index) => index !== bob.index
            )!;

            const posted = await postDepartedTimeoutOf(h, {
                leaverIndex: alice.index,
                accused: bob.address
            });
            expect(
                (await localFinalizedHeight(h, auditorIndex)) ?? -1
            ).to.be.lessThan(posted.accusedHeight);
            const run = await h.dispute.auditDispute(
                auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.storedProof).to.equal(undefined);
            expect(run.disputeFraudProofCount).to.equal(0);
        });

        it("the late auditor holds a fully signed block at the timeout height by another author than the accused, and the latest state's snapshot -> no TimeoutThreshold from that block; TimeoutSupersededByFinalState instead", async function () {
            const h = TestSession.getHarness();
            const staged = await stageDepartedDisputerBehindLateAuditor(h, {
                nextAuthorLeaves: true
            });
            const leaver = h.getPeer(staged.leaverIndex);
            const nextLeaver = h.getPeer(staged.nextLeaverIndex!);
            const auditor = h.getPeer(staged.auditorIndex);
            const accusedHeight = staged.leaveHeight + 1;
            // the auditor holds the next leaver's set-changing block, signed by everyone
            const held = await readAccusedBlock(
                h,
                staged.auditorIndex,
                staged.forkId,
                accusedHeight,
                leaver.address
            );
            expect(held.author).to.equal(nextLeaver.address);
            expect(held.everyoneSigned).to.equal(true);
            // the threshold counter's other input, the latest snapshot, is held too
            expect(
                (await snapshotAt(h, staged.auditorIndex, staged.leaveHeight))
                    .hash
            ).to.equal(staged.leaveSnapshot.hash);
            const accused = h.getPeer(staged.remaining[0]!);
            expect(accused.address).to.not.equal(nextLeaver.address);

            const posted = await postDepartedTimeoutOf(h, {
                leaverIndex: staged.leaverIndex,
                accused: accused.address
            });
            const run = await h.dispute.auditDispute(
                staged.auditorIndex,
                posted.dispute,
                posted.auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.TimeoutSupersededByFinalState
            );
            expect(
                await h
                    .control(auditor)
                    .query.getDisputeFraudProofTypes()
                    .request()
            ).to.deep.equal([
                String(
                    toSolidityDisputeFraudProofType(
                        DisputeFraudProofType.TimeoutSupersededByFinalState
                    )
                )
            ]);
        });
    });

    describe("omitted inbound joiner", function () {
        it("U99, U122: posted auditing data, a hop consumes the joiner's JOIN but leaves the joiner out of its snapshot and signatures -> false + DisputeInvalidStateProof pointed at that hop, which the chain accepts", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            for (const peer of h.peers)
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            const forkId = h.activeForkId!;
            // the next block consumes the forced join and seats the joiner,
            // who never signs: it stays unfinalized
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: false
            });
            const latest = (await h
                .control(h.getPeer(0))
                .query.getLatestBlockHeight(forkId)
                .request())!;
            const harnessAddresses = h.peers.map((peer) =>
                String(peer.address)
            );
            const joiner = (
                await snapshotAt(h, 0, latest)
            ).snapshotData.participants
                .map(String)
                .find((address) => !harnessAddresses.includes(address));
            expect(joiner, "the head must seat the forced joiner").to.not.be
                .undefined;
            const forged = await h.tamper.buildForgedSnapshot(0, (ctx) => ({
                snapshotData: {
                    ...ctx.originalSnapshotData,
                    participants: ctx.originalSnapshotData.participants.filter(
                        (participant) => String(participant) !== joiner
                    )
                }
            }));
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = true;
            const last = dispute.input.stateProof.milestones.at(-1)!;
            // the final hop block, then the consuming head
            expect(last.blockConfirmations.length).to.be.greaterThan(1);
            last.blockConfirmations = last.blockConfirmations.slice(0, -1);
            // the head as its own hop, signed by every harness peer
            dispute.input.stateProof.milestones.push({
                blockConfirmations: [forged.forgedBlock.blockConfirmationStruct]
            });
            auditingData.milestoneSnapshots.push(
                forged.forgedSnapshot.toStruct()
            );
            auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
            dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );
            dispute.postedAuditingData = true;

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            // the hop's step fails on its union threshold: no block pointer
            expect(Number(evidence.milestoneIndex)).to.equal(
                dispute.input.stateProof.milestones.length - 1
            );
            expect(evidence.hasBlockIndex).to.equal(false);
            expect(
                await h.channelManager.isStateProofStepInvalid.staticCall(
                    dispute,
                    evidence
                )
            ).to.equal(true);
            expect(
                await chainAcceptsDisputeProof(
                    h.channelManager,
                    dispute,
                    auditingData
                )
            ).to.equal(false);
        });

        it("U99, U122: the joiner itself audits, without the hop's preceding state: posted auditing data, the hop consumes its JOIN but leaves it out of the snapshot and signatures -> false + DisputeInvalidStateProof the chain accepts, no throw, and it never acquires that state", async function () {
            const h = TestSession.getHarness();
            const staged = await stagePendingJoinerMissingHopBase(h);
            const charlie = h.getPeer(staged.charlieIndex);
            // the hop re-signed without Charlie: its snapshot leaves him out
            const forged = await h.tamper.buildForgedSnapshot(0, (ctx) => ({
                snapshotData: {
                    ...ctx.originalSnapshotData,
                    participants: ctx.originalSnapshotData.participants.filter(
                        (participant) => String(participant) !== charlie.address
                    )
                }
            }));
            const hop = {
                signedBlock: forged.forgedBlock.signedBlock,
                signatures: [...forged.forgedBlock.confirmationSignatures]
                    .filter(
                        (signature) =>
                            forged.forgedBlock.signatureToAddress(signature) !==
                            charlie.address
                    )
                    .map(String)
            };
            const { dispute, auditingData } = staged;
            const last = dispute.input.stateProof.milestones.at(-1)!;
            last.blockConfirmations = last.blockConfirmations.slice(0, -1);
            dispute.input.stateProof.milestones.push({
                blockConfirmations: [hop]
            });
            auditingData.milestoneSnapshots.push(
                forged.forgedSnapshot.toStruct()
            );
            auditingData.latestStateSnapshot = forged.forgedSnapshot.toStruct();
            dispute.input.latestStateSnapshotHash = forged.forgedSnapshot.hash;
            dispute.input.disputeAuditingDataHash = hash(
                Codec.encode(auditingData, Type.DisputeAuditingData)
            );

            const run = await h.dispute.auditDispute(
                staged.charlieIndex,
                dispute,
                auditingData
            );

            expect(run).to.include({ outcome: "returned", isValid: false });
            expect(run.storedProof?.disputeFraudProofType).to.equal(
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(run.storedProof?.proofParticipant).to.equal(
                h.getPeer(0).address
            );
            const evidence = Codec.decode(
                run.storedProof!.encodedProof,
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(
                await h.channelManager.isStateProofStepInvalid.staticCall(
                    dispute,
                    evidence
                )
            ).to.equal(true);
            expect(
                await holdsState(h, staged.charlieIndex, staged.baseSnapshot),
                "the counter needs no preceding application state"
            ).to.equal(false);
        });

        it("U99, U122 control: the honest hop seats the joiner it consumes -> no counter, true", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            for (const peer of h.peers)
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            await h.transition.advanceState({
                count: 1,
                waitForFinalization: false
            });
            const { dispute, auditingData } =
                await h.dispute.fetchConstructedDispute(0);
            dispute.input.requireExistingDisputeWindow = true;
            expect(dispute.postedAuditingData).to.equal(true);

            const run = await h.dispute.auditDispute(1, dispute, auditingData);

            expect(run).to.include({ outcome: "returned", isValid: true });
            expect(run.disputeFraudProofCount).to.equal(0);
        });
    });
});
