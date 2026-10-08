import StateSnapshot from "@/models/StateSnapshot";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { ForkId } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { hash as randomHash, hexString } from "@test/factory";
import {
    assertColludersKilledByConflict,
    stageBlindPendingAuditor
} from "@test/fixtures/DisputeAuditStaging";
import {
    assertEarlierStartAuditorKills,
    assertKilledOnChain,
    assertCounterKills,
    assertSelfRemovalAccepted,
    buildBelowAnchorJunkMilestone,
    buildOwnProof,
    buildTeleportedTail,
    expectAnchorRunProof,
    expectFinalHeadProof,
    expectHeadAndTailProof,
    getBlockConfirmation,
    otherPeers,
    postSelfRemovalDispute,
    stageChainAnchor,
    stageOffWireTailOverBlindPendingAuditor,
    stageSplitStartAuditors,
    undecodableConfirmation
} from "@test/fixtures/MilestoneProofStartStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

// Auditors walk a state proof from their own trusted start: the latest
// locally final point, else the local diamond's anchor, else the chain's.
// Material below that start is not checked; material above it is.
describe("E2E: dispute validation / milestone proof start", function () {
    describe("E10: auditors with different final points", function () {
        it("E10: omitted data, an inserted hop above the chain anchor lacks the required signatures → the earlier-start auditor kills it on chain from its own snapshots; newer-start auditors accept", async function () {
            const h = TestSession.getHarness();
            const staging = await stageSplitStartAuditors(h);
            const hop = await getBlockConfirmation(
                h,
                staging.submitter,
                staging.forkId,
                staging.hopHeight
            );

            const posted = await postSelfRemovalDispute(
                h,
                staging.submitter,
                (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectFinalHeadProof(dispute, staging.finalHeight);
                    // the hop to H-1 keeps only its author's signature
                    dispute.input.stateProof.milestones.unshift({
                        blockConfirmations: [
                            { signedBlock: hop.signedBlock, signatures: [] }
                        ]
                    });
                },
                { malicious: true }
            );

            await assertEarlierStartAuditorKills(h, staging, posted);
        });

        it("E10 ext: omitted data, an inserted milestone above the chain anchor skips a height (broken retained link) → the earlier-start auditor kills it on chain from its own snapshots; newer-start auditors accept", async function () {
            const h = TestSession.getHarness();
            const staging = await stageSplitStartAuditors(h);
            const [first, second] = await Promise.all([
                getBlockConfirmation(
                    h,
                    staging.submitter,
                    staging.forkId,
                    staging.hopHeight - 2
                ),
                getBlockConfirmation(
                    h,
                    staging.submitter,
                    staging.forkId,
                    staging.hopHeight
                )
            ]);

            const posted = await postSelfRemovalDispute(
                h,
                staging.submitter,
                (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectFinalHeadProof(dispute, staging.finalHeight);
                    // H-3 then H-1: the run does not link through H-2
                    dispute.input.stateProof.milestones.unshift({
                        blockConfirmations: [first, second]
                    });
                },
                { malicious: true }
            );

            await assertEarlierStartAuditorKills(h, staging, posted);
        });

        it("E10: posted data, the row of an earlier milestone above the chain anchor is the head's snapshot → the earlier-start auditor kills it on chain from the posted data; newer-start auditors accept", async function () {
            const h = TestSession.getHarness();
            const staging = await stageSplitStartAuditors(h);
            const hop = await getBlockConfirmation(
                h,
                staging.submitter,
                staging.forkId,
                staging.hopHeight
            );

            const posted = await postSelfRemovalDispute(
                h,
                staging.submitter,
                (dispute, _confirmation, auditingData) => {
                    expect(auditingData).to.not.equal(undefined);
                    expectFinalHeadProof(dispute, staging.finalHeight);
                    dispute.input.stateProof.milestones.unshift({
                        blockConfirmations: [hop]
                    });
                    // H-1 does not commit to the head's snapshot
                    auditingData!.milestoneSnapshots.unshift(
                        auditingData!.milestoneSnapshots[0]
                    );
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData!, Type.DisputeAuditingData)
                    );
                },
                { malicious: true }
            );

            await assertEarlierStartAuditorKills(h, staging, posted);
        });

        it("E10 ext: a challenger's forged milestone snapshot against an honest omitted-data dispute → the challenge fails on chain, the challenger is slashed, the disputer is not and its dispute stays committed", async function () {
            const h = TestSession.getHarness();
            const { forkId, latestHeight } = await stageChainAnchor(h, 2);
            const leaver = 1;
            const challenger = h.getPeer(2);

            await h.dispute.suppressDisputeInitiation([leaver]);
            await h.dispute.selfRemoveViaDisputeWait({
                leaverIndex: leaver,
                forkId
            });
            const dispute = h.context.tamperedDisputes.at(-1)!;
            expect(dispute.postedAuditingData).to.equal(false);
            expectFinalHeadProof(dispute, latestHeight);

            const control = h.control(challenger);
            const [genesisResult, latestResult, substitutedResult] =
                await Promise.all([
                    control.dispute.getGenesisSnapshotStruct(forkId).request(),
                    control.query
                        .getStateSnapshotStructAt(forkId, latestHeight)
                        .request(),
                    control.query
                        .getStateSnapshotStructAt(forkId, latestHeight - 1)
                        .request()
                ]);
            const genesis = Codec.decode(
                genesisResult!.encodedSnapshot,
                Type.StateSnapshot
            );
            // the genuine evidence: the chain anchor before the head hop, and
            // the head's own snapshot, which is also the dispute's latest state
            const anchor = StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).toStruct();
            const latest = Codec.decode(
                latestResult!.encodedSnapshot,
                Type.StateSnapshot
            );
            expect(StateSnapshot.from(latest).hash).to.equal(
                dispute.input.latestStateSnapshotHash
            );
            // the only change: a real snapshot the head block does not commit to
            const substituted = Codec.decode(
                substitutedResult!.encodedSnapshot,
                Type.StateSnapshot
            );
            h.contextApi.markMaliciousPeer({
                maliciousPeerIndex: challenger.index
            });
            const tx =
                await challenger.p2pInstance.stateChannelManagerContract.applyDisputeFraudProofs(
                    [
                        {
                            proofType: toSolidityDisputeFraudProofType(
                                DisputeFraudProofType.DisputeInvalidStateProof
                            ),
                            participant: dispute.input.disputer,
                            dispute,
                            encodedProof: Codec.encode(
                                {
                                    milestoneIndex: 0,
                                    hasBlockIndex: false,
                                    blockIndex: 0,
                                    auditingData: {
                                        genesisStateSnapshotData:
                                            genesis.snapshotData,
                                        milestoneSnapshots: [latest],
                                        latestStateSnapshot: latest,
                                        latestFinalizedStateStateMachineState:
                                            "0x",
                                        inboundMessageBlocks: [],
                                        outboundMessageBlocks: []
                                    },
                                    previousStateSnapshot: anchor,
                                    resultingStateSnapshot: substituted
                                },
                                DisputeFraudProofType.DisputeInvalidStateProof
                            )
                        }
                    ]
                );
            await tx.wait();

            await h.assert.dispute.slashedOnChain(
                challenger.address,
                "the forged challenge must slash its challenger"
            );
            const slashed =
                await h.channelManager.getOnChainSlashedParticipants(
                    h.channelId
                );
            expect(
                slashed.some(
                    (address) => address === h.getPeer(leaver).address
                ),
                "the honest disputer must not be slashed"
            ).to.equal(false);
            const commitments = await h.channelManager.getWindowCommitments(
                h.channelId,
                forkId
            );
            expect(
                commitments.includes(hash(Codec.encode(dispute, Type.Dispute))),
                "the honest dispute must stay committed"
            ).to.equal(true);

            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    describe("E32: malformed material below the trusted anchor", function () {
        it("E32: a malformed milestone wholly below the chain anchor → every auditor accepts from its trusted start, stores none of it, and the latest-state checks pass", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight, latestHeight } =
                await stageChainAnchor(h, 2);
            const leaver = 1;
            const auditors = [0, 2, 3];
            const below = await buildBelowAnchorJunkMilestone(
                h,
                leaver,
                forkId,
                anchorHeight
            );

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                leaver,
                (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectFinalHeadProof(dispute, latestHeight);
                    dispute.input.stateProof.milestones.unshift(
                        below.milestone
                    );
                },
                { malicious: false }
            );

            // a stored confirmation is an audit that found no counter,
            // including the balance, output and reason checks
            await h.assert.storage.storedDisputeConfirmationsWait({
                peerIndices: auditors,
                disputeHashes: [disputeHash]
            });
            await h.assert.storage.honestPeersStoredNoDisputeFraudProofs();
            for (const index of auditors) {
                const query = h.control(h.getPeer(index)).query;
                expect(
                    await query
                        .getBlockHashAt(forkId, anchorHeight - 1)
                        .request(),
                    `auditor ${index} keeps its own block below the anchor`
                ).to.equal(below.originalBlockHash);
                expect(
                    await query.getBlockByHash(below.forgedBlockHash).request(),
                    `auditor ${index} stores none of the skipped prefix`
                ).to.equal(null);
            }
            const slashed =
                await h.channelManager.getOnChainSlashedParticipants(
                    h.channelId
                );
            expect(
                slashed.some(
                    (address) => address === h.getPeer(leaver).address
                ),
                "the disputer must not be slashed"
            ).to.equal(false);

            await h.dispute.resolveDisputeWait({
                forkId,
                assertMaliciousRemoved: false,
                honestPeerIndices: auditors
            });
        });

        it("E32: the same skipped malformed prefix with a latest state that breaks the balance invariant, audited by a pending auditor without a final block at the forged head → the balance counter still kills the dispute, then DisputeConflictsWithFinalState kills the colluders' real-head disputes", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight } = await stageChainAnchor(h, 2);
            const submitter = 2;
            const participants = [0, 1, 3];
            // the colluders' head is one the pending auditor never finalized
            const {
                auditorIndex,
                headHeight: latestHeight,
                restoreGossip
            } = await stageBlindPendingAuditor(h, [0, 1, 2, 3]);
            // the participants (the submitter's own node too) hold the real
            // head final: only the auditor's balance counter may land
            await Promise.all(
                [0, 1, 2, 3].map((index) =>
                    h.rpcStub.suppressDisputeKill(index)
                )
            );
            const below = await buildBelowAnchorJunkMilestone(
                h,
                submitter,
                forkId,
                anchorHeight
            );
            const forged = await h.tamper.buildForgedSnapshot(
                submitter,
                (ctx) => ({
                    snapshotData: {
                        ...ctx.originalSnapshotData,
                        totalDeposits: {
                            ...ctx.originalSnapshotData.totalDeposits,
                            amount:
                                BigInt(
                                    ctx.originalSnapshotData.totalDeposits
                                        .amount
                                ) + 1n
                        }
                    }
                }),
                { withoutSignerIndices: [auditorIndex] }
            );

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute, _confirmation, auditingData) => {
                    expect(auditingData).to.not.equal(undefined);
                    expectFinalHeadProof(dispute, latestHeight);
                    // the forged head replaces the final head block
                    dispute.input.stateProof.milestones[0].blockConfirmations[0] =
                        forged.forgedBlock.blockConfirmationStruct;
                    auditingData!.milestoneSnapshots[0] =
                        forged.forgedSnapshot.toStruct();
                    // the skipped prefix's row is never read
                    dispute.input.stateProof.milestones.unshift(
                        below.milestone
                    );
                    auditingData!.milestoneSnapshots.unshift(
                        forged.forgedSnapshot.toStruct()
                    );
                    auditingData!.latestStateSnapshot =
                        forged.forgedSnapshot.toStruct();
                    dispute.input.latestStateSnapshotHash =
                        forged.forgedSnapshot.hash;
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData!, Type.DisputeAuditingData)
                    );
                },
                { malicious: true }
            );

            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBalanceInvariant,
                peerIndices: [auditorIndex]
            });
            await assertKilledOnChain(h, {
                forkId,
                submitter,
                disputeHash,
                observers: [auditorIndex]
            });
            const kill = await readDisputeKill(h, h.getPeer(submitter).address);
            expect(kill.killer).to.equal(h.getPeer(auditorIndex).address);
            expect(kill.appliedProofTypes).to.deep.equal([
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            ]);
            await restoreGossip();
            for (const index of participants)
                expect(
                    await h
                        .control(h.getPeer(index))
                        .query.getBlockHashAt(forkId, anchorHeight - 1)
                        .request(),
                    `auditor ${index} keeps its own block below the anchor`
                ).to.equal(below.originalBlockHash);

            await assertColludersKilledByConflict(h, {
                forkId,
                auditorIndex,
                submitterIndex: submitter,
                colluderIndices: participants
            });
        });
    });

    describe("E36: malformed retained input through the full audit path", function () {
        it("E36: omitted data, undecodable block bytes after the anchor block of the last milestone → DisputeInvalidStateProof kills the dispute and slashes its submitter", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight } = await stageChainAnchor(h, 0);
            const submitter = 1;

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute) => {
                    // omission is allowed: the last milestone holds the anchor
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectAnchorRunProof(dispute, anchorHeight, 1);
                    const run =
                        dispute.input.stateProof.milestones[0]
                            .blockConfirmations;
                    run.push({
                        signedBlock: {
                            encodedBlock: hexString(128),
                            signature: run[0].signedBlock.signature
                        },
                        signatures: []
                    });
                },
                { malicious: true }
            );

            await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeInvalidStateProof,
                forkId,
                submitter,
                disputeHash,
                auditors: [0, 2, 3]
            });
        });

        it("E36: omitted data, an unrecoverable confirmation signature on the unfinalized block after the anchor → DisputeInvalidStateProof kills the dispute and slashes its submitter", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight } = await stageChainAnchor(h, 0);
            // the next writer keeps its block above the anchor to itself:
            // it stays unfinalized and its proof runs from the anchor block
            const { leader, startHeight } =
                await h.transition.authorNextBlockOffWireWait();
            expect(startHeight).to.equal(anchorHeight + 1);
            const submitter = leader.index;

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectAnchorRunProof(dispute, anchorHeight, 2);
                    const tail =
                        dispute.input.stateProof.milestones[0]
                            .blockConfirmations[1];
                    tail.signatures = [...tail.signatures, "0x1234"];
                },
                { malicious: true }
            );

            await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeInvalidStateProof,
                forkId,
                submitter,
                disputeHash,
                auditors: h.peers
                    .map((peer) => peer.index)
                    .filter((index) => index !== submitter)
            });
        });

        it("E36: omitted data, undecodable bytes in a walked middle block of an earlier milestone, the head decodes → the walk (not the latest-state check) fails there, and the chain's DisputeInvalidStateProof points at that milestone and block", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight } = await stageChainAnchor(h, 0);
            // the next writer keeps its block above the anchor to itself
            const { leader, startHeight } =
                await h.transition.authorNextBlockOffWireWait();
            expect(startHeight).to.equal(anchorHeight + 1);
            const submitter = leader.index;

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute) => {
                    // omission is allowed: the last milestone holds the anchor
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectAnchorRunProof(dispute, anchorHeight, 2);
                    const [anchorBlock, tail] =
                        dispute.input.stateProof.milestones[0]
                            .blockConfirmations;
                    // [anchor, undecodable, tail] first; the honest last
                    // milestone [anchor, tail] keeps a decodable head
                    dispute.input.stateProof.milestones.unshift({
                        blockConfirmations: [
                            anchorBlock,
                            undecodableConfirmation(anchorBlock),
                            tail
                        ]
                    });
                },
                { malicious: true }
            );

            const kill = await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeInvalidStateProof,
                forkId,
                submitter,
                disputeHash,
                auditors: otherPeers(h, submitter)
            });
            const counter = Codec.decode(
                kill.appliedEncodedProofs[0]!,
                DisputeFraudProofType.DisputeInvalidStateProof
            );
            expect(Number(counter.milestoneIndex)).to.equal(0);
            expect(counter.hasBlockIndex).to.equal(true);
            expect(Number(counter.blockIndex)).to.equal(1);
        });

        it("E36: posted data, an unrecoverable confirmation signature in the last milestone → DisputeInvalidStateProof kills the dispute and slashes its submitter", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(
                3,
                (dispute, _sm, args) => {
                    const confirmation = dispute.input.stateProof.milestones
                        .at(-1)!
                        .blockConfirmations.at(-1)!;
                    confirmation.signatures = [
                        ...confirmation.signatures,
                        args.unrecoverableSignature as string
                    ];
                },
                {
                    autoRestore: true,
                    args: { unrecoverableSignature: "0x1234" }
                }
            );

            // the submitter and the double signer never kill: the kill is an honest auditor's
            await h.rpcStub.suppressDisputeKill(3);
            await h.rpcStub.suppressDisputeKill(1);

            await h.byzantine.submitDoubleSignBlock(1);

            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: true
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidStateProof
            });
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.slashedOnChain(
                h.getPeer(3).address,
                "the dispute submitter must be slashed by the kill"
            );
            const kill = await readDisputeKill(h, h.getPeer(3).address);
            expect([h.getPeer(0).address, h.getPeer(2).address]).to.include(
                kill.killer
            );
            expect(kill.appliedProofTypes).to.deep.equal([
                DisputeFraudProofType.DisputeInvalidStateProof
            ]);
            await h.dispute.resolveDisputeWait({
                forkId,
                syntheticOnChainParticipants: 1
            });
        });
    });

    // Malformed retained block bytes must reach every later audit check as
    // the specified invalid-proof handling, never as an auditor crash.
    // Reachability: undecodable bytes in the latest block always stop at the
    // latest-state commitment check (mapped: the E36 omitted test above,
    // stateProof/undecodableBlock.test.ts for posted data). The inbound-anchor
    // and newer-signed-state checks run only after a valid walk, so they meet
    // malformed bytes only in skipped history; the tests below show both.
    describe("U116: malformed retained bytes at the later audit checks", function () {
        it("U116: omitted data, undecodable bytes before an eligible tail block that names another fork → the header scan skips them and DisputeStateProofHeaderMismatch kills the dispute", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight } = await stageChainAnchor(h, 0);
            const { leader } = await h.transition.authorNextBlockOffWireWait();
            const submitter = leader.index;

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                async (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectAnchorRunProof(dispute, anchorHeight, 2);
                    await h.tamper.mismatchLastMilestoneHeader(dispute, {
                        forkId: randomHash() as ForkId
                    });
                    const run =
                        dispute.input.stateProof.milestones[0]
                            .blockConfirmations;
                    run.splice(1, 0, undecodableConfirmation(run[0]));
                },
                { malicious: true }
            );

            await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                forkId,
                submitter,
                disputeHash,
                auditors: otherPeers(h, submitter)
            });
        });

        it("U116: posted data, undecodable bytes before an eligible tail block that names another fork → the header scan skips them and DisputeStateProofHeaderMismatch kills the dispute", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight } = await stageChainAnchor(h, 0);
            const { leader } = await h.transition.authorNextBlockOffWireWait();
            const submitter = leader.index;

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                async (dispute, _confirmation, auditingData) => {
                    expect(auditingData).to.not.equal(undefined);
                    expectAnchorRunProof(dispute, anchorHeight, 2);
                    await h.tamper.mismatchLastMilestoneHeader(dispute, {
                        forkId: randomHash() as ForkId
                    });
                    const run =
                        dispute.input.stateProof.milestones[0]
                            .blockConfirmations;
                    run.splice(1, 0, undecodableConfirmation(run[0]));
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData!, Type.DisputeAuditingData)
                    );
                },
                { malicious: true }
            );

            await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeStateProofHeaderMismatch,
                forkId,
                submitter,
                disputeHash,
                auditors: otherPeers(h, submitter)
            });
        });

        it("U116: posted data, an undecodable first milestone → no crash, DisputeInvalidStateProof pointed at that milestone's undecodable block kills the dispute", async function () {
            const h = TestSession.getHarness();
            // a forced inbound join is pending: auditing data is posted and
            // the invalid-proof counter points at the undecodable block
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;
            const submitter = 0;
            // the submitter never kills its own dispute: the kill is an auditor's
            await h.rpcStub.suppressDisputeKill(submitter);

            const { dispute } = await h.tamper.postTamperedDispute(
                submitter,
                (dispute, _confirmation, auditingData) => {
                    expect(dispute.postedAuditingData).to.equal(true);
                    const milestones = dispute.input.stateProof.milestones;
                    milestones.unshift({
                        blockConfirmations: [
                            undecodableConfirmation(
                                milestones[0].blockConfirmations[0]
                            )
                        ]
                    });
                    auditingData!.milestoneSnapshots.unshift(
                        auditingData!.milestoneSnapshots[0]
                    );
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData!, Type.DisputeAuditingData)
                    );
                }
            );

            await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeInvalidStateProof,
                forkId,
                submitter,
                disputeHash: hash(Codec.encode(dispute, Type.Dispute)),
                auditors: otherPeers(h, submitter),
                syntheticOnChainParticipants: 1
            });
        });

        it("U116: omitted data, an older dispute with an undecodable block in skipped history below the anchor → the newer-signed-state check reads only decodable blocks, DisputeNotLatestState kills the dispute", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight, latestHeight } =
                await stageChainAnchor(h, 2);
            const submitter = 1;
            const older = await buildOwnProof(
                h,
                submitter,
                forkId,
                latestHeight - 1
            );
            const below = await buildBelowAnchorJunkMilestone(
                h,
                submitter,
                forkId,
                anchorHeight
            );

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(false);
                    // the disputer signed the head, but claims the block below it
                    dispute.input.stateProof = older.stateProof;
                    expectFinalHeadProof(dispute, latestHeight - 1);
                    dispute.input.latestStateSnapshotHash = StateSnapshot.from(
                        older.auditingData.latestStateSnapshot
                    ).hash;
                    dispute.input.stateProof.milestones.unshift(
                        below.milestone
                    );
                },
                { malicious: true }
            );

            await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeNotLatestState,
                forkId,
                submitter,
                disputeHash,
                auditors: otherPeers(h, submitter)
            });
        });

        it("U116: posted data, an older dispute with an undecodable block in skipped history below the anchor → the newer-signed-state check reads only decodable blocks, DisputeNotLatestState kills the dispute", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight, latestHeight } =
                await stageChainAnchor(h, 2);
            const submitter = 1;
            const older = await buildOwnProof(
                h,
                submitter,
                forkId,
                latestHeight - 1
            );
            const below = await buildBelowAnchorJunkMilestone(
                h,
                submitter,
                forkId,
                anchorHeight
            );

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute, _confirmation, auditingData) => {
                    expect(auditingData).to.not.equal(undefined);
                    // the disputer signed the head, but claims the block below it
                    dispute.input.stateProof = older.stateProof;
                    expectFinalHeadProof(dispute, latestHeight - 1);
                    Object.assign(auditingData!, older.auditingData);
                    dispute.input.latestStateSnapshotHash = StateSnapshot.from(
                        older.auditingData.latestStateSnapshot
                    ).hash;
                    // the skipped prefix's row is never read
                    dispute.input.stateProof.milestones.unshift(
                        below.milestone
                    );
                    auditingData!.milestoneSnapshots.unshift(
                        auditingData!.milestoneSnapshots[0]
                    );
                    dispute.postedAuditingData = true;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData!, Type.DisputeAuditingData)
                    );
                },
                { malicious: true }
            );

            await assertCounterKills(h, {
                counter: DisputeFraudProofType.DisputeNotLatestState,
                forkId,
                submitter,
                disputeHash,
                auditors: otherPeers(h, submitter)
            });
        });

        it("U116 control: omitted data, an undecodable block before the anchor block inside the last milestone → skipped history: the header, structure, inbound-anchor, balance and output checks never decode it and every auditor accepts", async function () {
            const h = TestSession.getHarness();
            const { forkId, anchorHeight } = await stageChainAnchor(h, 0, {
                transitionCount: 3
            });
            const { leader } = await h.transition.authorNextBlockOffWireWait();
            const leaver = leader.index;
            const first = await getBlockConfirmation(
                h,
                leaver,
                forkId,
                anchorHeight - 2
            );

            const { disputeHash } = await postSelfRemovalDispute(
                h,
                leaver,
                (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(false);
                    expectAnchorRunProof(dispute, anchorHeight, 2);
                    // [anchor-2, undecodable, anchor, anchor+1]: the walk
                    // starts at the anchor block, two positions in
                    dispute.input.stateProof.milestones[0].blockConfirmations.unshift(
                        first,
                        undecodableConfirmation(first)
                    );
                },
                { malicious: false }
            );

            await assertSelfRemovalAccepted(h, {
                forkId,
                leaver,
                disputeHash,
                auditors: otherPeers(h, leaver)
            });
        });
    });

    // Teleportation under collusion: the colluders' final block breaks the
    // balance invariant against the chain, and the tail built on it makes
    // correct transitions, so only the balance counter on the latest state
    // catches it.
    describe("E15: balance judged on the unfinalized latest state", function () {
        it("E15: a forged final head breaks the balance invariant and a correct tail replays on it, posted data, audited by a pending auditor that never finalized that head → the replay succeeds, DisputeInvalidBalanceInvariant judges the latest state and kills the dispute, then DisputeConflictsWithFinalState kills the colluders' real-head disputes", async function () {
            const h = TestSession.getHarness();
            const staging = await stageOffWireTailOverBlindPendingAuditor(h);
            const { forkId, submitter, auditors, headHeight } = staging;
            // the participants (the submitter's own node too) hold the real
            // head final: only the auditor's balance counter may land
            await Promise.all(
                [0, 1, 2, 3].map((index) =>
                    h.rpcStub.suppressDisputeKill(index)
                )
            );
            const teleported = await buildTeleportedTail(h, staging);

            const { dispute } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute, _confirmation, auditingData) => {
                    expect(dispute.postedAuditingData).to.equal(true);
                    expectHeadAndTailProof(dispute, headHeight);
                    const run =
                        dispute.input.stateProof.milestones[0]
                            .blockConfirmations;
                    run[0] = teleported.head.confirmation;
                    run[1] = teleported.tail.confirmation;
                    auditingData!.milestoneSnapshots[0] =
                        teleported.head.snapshot.toStruct();
                    auditingData!.latestStateSnapshot =
                        teleported.tail.snapshot.toStruct();
                    dispute.input.latestStateSnapshotHash =
                        teleported.tail.snapshot.hash;
                    dispute.input.disputeAuditingDataHash = hash(
                        Codec.encode(auditingData!, Type.DisputeAuditingData)
                    );
                },
                { malicious: true }
            );
            // the pending auditor signed nothing: the data had to be posted
            expect(
                await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                    dispute
                )
            ).to.equal(false);

            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBalanceInvariant,
                peerIndices: auditors
            });
            await h.event.waitForPeers("onDisputeKilled", auditors, 1, {
                mode: "atLeast"
            });
            const kill = await readDisputeKill(h, h.getPeer(submitter).address);
            expect(kill.killer).to.equal(h.getPeer(auditors[0]!).address);
            expect(kill.appliedProofTypes).to.deep.equal([
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            ]);
            // head and tail both carry the broken total: the counter judged
            // the latest state, the tail's, not the final head's
            const counter = Codec.decode(
                kill.appliedEncodedProofs[0]!,
                DisputeFraudProofType.DisputeInvalidBalanceInvariant
            );
            const judged = StateSnapshot.from(counter.latestStateSnapshot).hash;
            expect(judged).to.equal(teleported.tail.snapshot.hash);
            expect(judged).to.not.equal(teleported.head.snapshot.hash);
            // the tail replayed: no auditor stored a transition counter
            const transitionCounter = String(
                toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
                )
            );
            for (const index of auditors)
                expect(
                    await h
                        .control(h.getPeer(index))
                        .query.getDisputeFraudProofTypes()
                        .request(),
                    `auditor ${index} stores no transition counter`
                ).to.not.include(transitionCounter);
            await staging.restoreGossip();
            await assertColludersKilledByConflict(h, {
                forkId,
                auditorIndex: auditors[0]!,
                submitterIndex: submitter,
                colluderIndices: [0, 1, 2, 3].filter(
                    (index) => index !== submitter
                )
            });
        });

        it("E15 control: the same blind pending auditor with the real final head and its correct tail (a good balance invariant), posted data → the tail replays on the head and every auditor accepts the dispute", async function () {
            const h = TestSession.getHarness();
            const staging = await stageOffWireTailOverBlindPendingAuditor(h);
            const { forkId, submitter, auditors, headHeight } = staging;

            const { dispute, disputeHash } = await postSelfRemovalDispute(
                h,
                submitter,
                (dispute) => {
                    expect(dispute.postedAuditingData).to.equal(true);
                    expectHeadAndTailProof(dispute, headHeight);
                },
                { malicious: false }
            );
            // the pending auditor signed nothing: the data had to be posted
            expect(
                await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                    dispute
                )
            ).to.equal(false);

            // the blind pending auditor audits before it gets gossip back
            await h.assert.storage.storedDisputeConfirmationsWait({
                peerIndices: auditors,
                disputeHashes: [disputeHash]
            });
            await staging.restoreGossip();
            await assertSelfRemovalAccepted(h, {
                forkId,
                leaver: submitter,
                disputeHash,
                auditors: otherPeers(h, submitter)
            });
        });
    });
});
