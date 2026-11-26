import type { Hash } from "@/types/types";
import { Codec, Type } from "@/utils";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import { stageMissingParticipantSignature } from "@test/fixtures/LateSignatureStaging";
import { stageMirrorMissingJoin } from "@test/fixtures/MirrorDivergenceStaging";
import {
    compareEvidence,
    stageStoredTimeoutClaim
} from "@test/fixtures/TimeoutSelfRemovalOrderStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";
import { ethers, ZeroAddress } from "ethers";

// below the fixed part of any encoded dispute
const BELOW_ANY_DISPUTE_UPLOAD_CAP = 512;
// halfway between the encoded sizes, in a three-peer channel after blocks
// 0..1, of the dispute at block 1 (2,144 bytes, signed by all) and at block 2
// (3,168 bytes, unsigned by the disputer): see the premises of the cut test
const CUT_DISPUTE_UPLOAD_CAP = 2_656;

describe("Unit: DisputeBuilder", function () {
    describe("constructDispute → reuse", function () {
        it("unchanged inputs → the second construction returns the cached result", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const first = await sm.disputeManager.constructDispute(
                        args.forkId
                    );
                    const second = await sm.disputeManager.constructDispute(
                        args.forkId
                    );
                    // a build returns new objects: identity is reuse
                    return { isSameResult: first === second };
                },
                { forkId }
            );

            expect(r.isSameResult).to.equal(true);
        });

        it("a valid signature merged into the unchanged latest block after a cached construction → the cached result is returned and adds no evidence", async function () {
            const h = TestSession.getHarness();
            const {
                forkId,
                writer,
                height,
                signedBlock,
                lateSignatures,
                missingSignatures
            } = await stageMissingParticipantSignature(h);

            const first = await h.execOnHost(
                writer,
                async (sm, args) => {
                    const builder = sm.disputeManager["disputeBuilder"];
                    const result = (await sm.disputeManager.constructDispute(
                        args.forkId
                    ))!;
                    const stored = sm.storage.blocks.getBlock(
                        args.forkId,
                        args.height
                    );
                    return {
                        isCached:
                            builder["built"].get(args.forkId)?.result ===
                            result,
                        storedSignatures: stored
                            ? Array.from(stored.confirmationSignatures).map(
                                  String
                              )
                            : [],
                        isEvidenceAdded: await builder["hasMoreEvidence"](
                            args.forkId,
                            result.dispute
                        )
                    };
                },
                { forkId, height }
            );
            // premise: the cached construction ran without the signature
            expect(first.isCached).to.equal(true);
            expect(
                first.storedSignatures.filter((signature) =>
                    missingSignatures.includes(signature)
                )
            ).to.deep.equal([]);

            // the late confirmation merges the signature after validation
            const merge = await h.transition.runStoredBlockMerge({
                peerIndex: writer.index,
                confirmation: { signedBlock, signatures: lateSignatures }
            });
            expect(merge.persistedSignatures).to.include.members(
                missingSignatures
            );

            const second = await h.execOnHost(
                writer,
                async (sm, args) => {
                    const builder = sm.disputeManager["disputeBuilder"];
                    const cached = builder["built"].get(args.forkId)!.result;
                    const result = await sm.disputeManager.constructDispute(
                        args.forkId
                    );
                    return {
                        // a build returns new objects: identity is reuse
                        isSameResult: result === cached,
                        latestHeight:
                            sm.storage.blocks.getNextBlockHeight(args.forkId) -
                            1,
                        // does our dispute now add to the one built before?
                        isEvidenceAdded: await builder["hasMoreEvidence"](
                            args.forkId,
                            cached.dispute
                        )
                    };
                },
                { forkId }
            );

            expect(second.latestHeight).to.equal(height);
            expect(second.isSameResult).to.equal(true);
            expect(first.isEvidenceAdded).to.equal(false);
            expect(second.isEvidenceAdded).to.equal(false);
            // the reused dispute still passes the chain's full proof check
            const reused = await h.dispute.fetchConstructedDispute(
                writer.index,
                forkId
            );
            expect(
                await chainAcceptsDisputeProof(
                    h.channelManager,
                    reused.dispute,
                    reused.auditingData
                )
            ).to.equal(true);
        });

        it("a newer latest block after a cached construction → the next dispute proves the later block", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const first = await h.dispute.fetchConstructedDispute(
                peer.index,
                forkId
            );
            await h.transition.advanceState(); // block 2
            const second = await h.dispute.fetchConstructedDispute(
                peer.index,
                forkId
            );

            expect(
                Number(first.auditingData.latestStateSnapshot.blockHeight)
            ).to.equal(1);
            expect(
                Number(second.auditingData.latestStateSnapshot.blockHeight)
            ).to.equal(2);
            expect(second.dispute.input.latestStateSnapshotHash).to.not.equal(
                first.dispute.input.latestStateSnapshotHash
            );
            // the chain walks the new proof to the new latest state
            expect(
                await chainAcceptsDisputeProof(
                    h.channelManager,
                    second.dispute,
                    second.auditingData
                )
            ).to.equal(true);
        });

        it("an exit started after a cached construction → the next dispute carries the self-removal", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const leaver = h.getPeer(0);
            const forkId = h.activeForkId!;

            const first = await h.dispute.fetchConstructedDispute(
                leaver.index,
                forkId
            );
            // the public leave starts the exit, which sets the force-exit flag
            await leaver.p2pInstance.p2pSigner.leaveChannel();
            const second = await h.dispute.fetchConstructedDispute(
                leaver.index,
                forkId
            );

            expect(first.dispute.input.selfRemoval).to.equal(false);
            expect(second.dispute.input.selfRemoval).to.equal(true);
            // premise: only the flag changed, the latest state did not
            expect(second.dispute.input.latestStateSnapshotHash).to.equal(
                first.dispute.input.latestStateSnapshotHash
            );
            expect(Codec.encode(second.dispute, Type.Dispute)).to.not.equal(
                Codec.encode(first.dispute, Type.Dispute)
            );
        });

        it("a real timeout becoming eligible after a cached construction → the next dispute claims it and an honest auditor accepts it", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.timeoutSetup(3, 2); // blocks 0..1, peer 2 is next
            const peer = h.getPeer(0);
            const writer = h.getPeer(2);
            const forkId = h.activeForkId!;
            // peer 0 is the only one that times the writer out
            await h.rpcStub.suppressTimeoutCheck(1);
            const control = h.control(peer);
            // the timeout is stored only after its build is released
            await control.stub.holdTimeoutBuild().request();
            try {
                const first = await h.dispute.fetchConstructedDispute(
                    peer.index,
                    forkId
                );
                expect(first.dispute.input.timeout.participant).to.equal(
                    ZeroAddress
                );

                // the writer stays silent past its real deadline
                await waitFor(
                    async () =>
                        (
                            await control.stub
                                .getTimeoutBuildObservation()
                                .request()
                        ).entered >= 1,
                    h.event.protocolEventTimeoutMs({
                        withFirstBlockGrace: true
                    })
                );
                await control.stub.releaseTimeoutBuild().request();
                await h.assert.dispute.initiatedWait({ peersIndices: [0] });
                // the auditor audits once its mirror holds the dispute window
                await h.assert.dispute.committedWait({
                    peersIndices: [1],
                    expectedCount: 1
                });

                const second = await h.dispute.fetchConstructedDispute(
                    peer.index,
                    forkId
                );
                const { timeout } = second.dispute.input;
                expect(timeout.participant).to.equal(writer.address);
                expect(Number(timeout.blockHeight)).to.equal(2);
                expect(timeout.isForced).to.equal(false);
                expect(second.dispute.input.latestStateSnapshotHash).to.equal(
                    first.dispute.input.latestStateSnapshotHash
                );

                const run = await h.dispute.auditDispute(
                    1,
                    second.dispute,
                    second.auditingData
                );
                expect(run).to.include({ outcome: "returned", isValid: true });
                expect(run.disputeFraudProofCount).to.equal(0);
            } finally {
                await control.stub.restoreTimeoutBuildRecording().request();
            }
        });

        it("real fraud evidence stored after a cached construction → the next dispute applies its proof and lists the slash", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1, next = 2
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const construct = () =>
                h.execOnHost(
                    observer,
                    async (sm, args) => {
                        const { dispute, fraudProofsToApply } =
                            (await sm.disputeManager.constructDispute(
                                args.forkId
                            ))!;
                        return {
                            onChainSlashes: dispute.input.onChainSlashes.map(
                                (address) => String(address)
                            ),
                            fraudProofCount: fraudProofsToApply.length
                        };
                    },
                    { forkId }
                );

            const first = await construct();
            // the validation pipeline stores the proof, as for a delivered block
            const offender = await h.byzantine.storeInvalidTransitionFraudProof(
                observer.index
            );
            const second = await construct();

            expect(first).to.deep.equal({
                onChainSlashes: [],
                fraudProofCount: 0
            });
            expect(second).to.deep.equal({
                onChainSlashes: [offender.address],
                fraudProofCount: 1
            });
        });
        it("a cached dispute that omits its auditing data, then the chain no longer allows the omission → the next construction builds again and posts the data", async function () {
            const h = TestSession.getHarness();
            // the chain has a join the head milestone waits on; peer 0's
            // mirror missed it, so locally the omission stays allowed
            await stageMirrorMissingJoin(h, 0);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const read = "isAuditingDataOmissionAllowed";
            const before = await h.mirror.observe(peer.index, read);
            // the first construction reads the chain from before the join
            await h.mirror.serveChainReadsBefore(
                peer.index,
                read,
                "InboundMessagesProcessed"
            );
            const first = await h.execOnHost(
                peer,
                async (sm, args) =>
                    (await sm.disputeManager.constructDispute(args.forkId))!
                        .dispute.postedAuditingData,
                { forkId }
            );
            expect(first).to.equal(false);
            expect((await before.observation()).chain.answers).to.deep.equal([
                true
            ]);
            // the chain view moves to the join; local inputs stay unchanged
            await before.restore();
            const after = await h.mirror.observe(peer.index, read);

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    const builder = sm.disputeManager["disputeBuilder"];
                    const cached = builder["built"].get(args.forkId)!;
                    const second = (await sm.disputeManager.constructDispute(
                        args.forkId
                    ))!;
                    const third = await sm.disputeManager.constructDispute(
                        args.forkId
                    );
                    return {
                        isSameFingerprint:
                            builder["built"].get(args.forkId)!.fingerprint ===
                            cached.fingerprint,
                        // a build returns new objects: identity is reuse
                        isRebuilt: second !== cached.result,
                        postedAuditingData: second.dispute.postedAuditingData,
                        isPostedReused: third === second
                    };
                },
                { forkId }
            );

            expect(r).to.deep.equal({
                isSameFingerprint: true,
                isRebuilt: true,
                postedAuditingData: true,
                isPostedReused: true
            });
            // the re-check and the build's confirmation read the chain; the
            // posted dispute is reused with no read
            const { local, chain } = await after.observation();
            expect(chain.answers).to.deep.equal([false, false]);
            expect(local.answers).to.deep.equal([true]);
        });

        it("the fork's reduced result committed after a cached construction → the built dispute is dropped", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const auditor = h.getPeer(1);
            const hasBuilt = () =>
                h.execOnHost(
                    auditor,
                    async (sm, args) =>
                        sm.disputeManager["disputeBuilder"]["built"].has(
                            args.forkId
                        ),
                    { forkId }
                );
            await h.dispute.fetchConstructedDispute(auditor.index, forkId);
            expect(await hasBuilt()).to.equal(true);

            await h.dispute.selfRemoveViaDisputeWait({ leaverIndex: 0 });
            await h.event.waitForPeers(
                "onDisputeReducedResultCommitted",
                [auditor.index],
                1
            );

            expect(await hasBuilt()).to.equal(false);
        });
    });

    describe("constructDispute → upload cap", function () {
        it("a dispute above the deployed upload cap at every height this peer may dispute → no dispute is built", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2, {
                maxDisputeUploadBytes: BELOW_ANY_DISPUTE_UPLOAD_CAP
            }); // blocks 0..1
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const result = await sm.disputeManager.constructDispute(
                        args.forkId
                    );
                    return {
                        isBuilt: result !== undefined,
                        latestHeight: sm.storage.blocks.getLatestBlockHeight(
                            args.forkId
                        ),
                        signedHeight:
                            sm.agreementManager.getLatestSignedBlockByParticipant(
                                args.forkId,
                                sm.signerAddress
                            )?.block.height
                    };
                },
                { forkId }
            );

            // premise: a lower height is below this peer's own signature
            expect(r.signedHeight).to.equal(r.latestHeight);
            expect(r.isBuilt).to.equal(false);
        });

        it("the latest dispute above the upload cap while the height this peer last signed fits → the dispute is cut to that height and the chain walks its proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2, {
                maxDisputeUploadBytes: CUT_DISPUTE_UPLOAD_CAP
            }); // blocks 0..1
            const forkId = h.activeForkId!;
            for (const peer of h.peers)
                await h.rpcStub.suppressTimeoutCheck(peer.index);
            const writer = await h.query.getNextPeerToWrite();
            const disputer = h.peers.find(
                (peer) => peer.index !== writer.index
            )!;
            const signedHeightDispute = await h.dispute.fetchConstructedDispute(
                disputer.index,
                forkId
            );
            const signedHeightBytes = ethers.dataLength(
                signedHeightDispute.disputeConfirmation.signedDispute
                    .encodedDispute
            );
            // the disputer signs no block of a blacklisted author: the third
            // peer's relay of the writer's next block is stored unsigned
            await h.execOnHost(
                disputer,
                (sm, args) =>
                    sm.p2pManager.disconnectAndBlacklistPeerByEvmAddress(
                        args.writer
                    ),
                { writer: writer.address }
            );
            // add() resolves after the writer's own commit
            await h
                .getPeer(writer.index)
                .p2pInstance.p2pContractInstance.add(1); // block 2
            await waitFor(
                async () =>
                    (await h
                        .control(disputer)
                        .query.getLatestBlockHeight(forkId)
                        .request()) === 2,
                h.event.protocolEventTimeoutMs()
            );

            const cut = await h.dispute.fetchConstructedDispute(
                disputer.index,
                forkId
            );
            const signed = await h
                .control(disputer)
                .query.getLatestSignedBlockByParticipant(
                    forkId,
                    disputer.address
                )
                .request();
            const cutBytes = ethers.dataLength(
                cut.disputeConfirmation.signedDispute.encodedDispute
            );

            // premise: block 2 is stored unsigned, block 1's dispute fits
            const sizes = `built ${cutBytes} bytes, block 1's dispute ${signedHeightBytes} bytes`;
            expect(signed?.height, sizes).to.equal(1);
            expect(signedHeightBytes, sizes).to.be.at.most(
                CUT_DISPUTE_UPLOAD_CAP
            );
            expect(
                Number(cut.auditingData.latestStateSnapshot.blockHeight),
                sizes
            ).to.equal(1);
            expect(cutBytes).to.be.at.most(CUT_DISPUTE_UPLOAD_CAP);
            expect(
                await chainAcceptsDisputeProof(
                    h.channelManager,
                    cut.dispute,
                    cut.auditingData
                )
            ).to.equal(true);
        });
    });

    describe("constructDispute → restart", function () {
        it("a newer block committed while construction is held at its state proof → the dispute proves the later block throughout", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const control = h.control(peer);

            const hold = await h.rpcStub.holdConstructDisputeAtStateProof(
                peer.index,
                forkId
            );
            const constructing = control.dispute
                .constructDispute(forkId)
                .request({ timeoutMs: h.event.hostExecTimeoutMs() });
            try {
                // the first attempt read height 1 and builds its proof
                await hold.waitUntilParked();
                expect(await hold.parkedCount()).to.equal(1);

                await h.transition.advanceState(); // block 2
                expect(
                    await control.query.getNextBlockHeight(forkId).request()
                ).to.equal(3);
            } finally {
                await hold.release();
            }
            const { encodedDispute, encodedAuditingData } = await constructing;
            const dispute = Codec.decode(encodedDispute, Type.Dispute);
            const auditingData = Codec.decode(
                encodedAuditingData,
                Type.DisputeAuditingData
            );

            // the inputs are the later block's
            expect(
                Number(auditingData.latestStateSnapshot.blockHeight)
            ).to.equal(2);
            // and so is the proof: the chain walks it to that same state
            expect(
                await chainAcceptsDisputeProof(
                    h.channelManager,
                    dispute,
                    auditingData
                )
            ).to.equal(true);
        });
    });

    describe("hasMoreEvidence → timeout claims", function () {
        it("our dispute with a timeout claim compared to a self-removal dispute without one → evidence added", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageStoredTimeoutClaim(h);
            const ours = await h.dispute.fetchConstructedDispute(0, forkId);
            await h.control(h.getPeer(1)).dispute.setForceExit(true).request();
            const theirs = await h.dispute.fetchConstructedDispute(1, forkId);
            // premise: same latest state; only ours claims the timeout
            expect(ours.dispute.input.timeout.participant).to.equal(
                h.getPeer(2).address
            );
            expect(theirs.dispute.input.selfRemoval).to.equal(true);
            expect(theirs.dispute.input.timeout.participant).to.equal(
                ZeroAddress
            );
            expect(theirs.dispute.input.latestStateSnapshotHash).to.equal(
                ours.dispute.input.latestStateSnapshotHash
            );

            expect(
                await compareEvidence(h, 0, forkId, theirs.dispute)
            ).to.equal(true);
        });

        it("our dispute without a timeout claim compared to a timeout dispute → no evidence added", async function () {
            const h = TestSession.getHarness();
            const forkId = await stageStoredTimeoutClaim(h);
            const theirs = await h.dispute.fetchConstructedDispute(0, forkId);
            const ours = await h.dispute.fetchConstructedDispute(1, forkId);
            // premise: same latest state; ours has no timeout claim and no other reason
            expect(theirs.dispute.input.timeout.participant).to.equal(
                h.getPeer(2).address
            );
            expect(ours.dispute.input.timeout.participant).to.equal(
                ZeroAddress
            );
            expect(ours.dispute.input.selfRemoval).to.equal(false);
            expect(ours.dispute.input.onChainSlashes).to.deep.equal([]);
            expect(ours.dispute.input.latestStateSnapshotHash).to.equal(
                theirs.dispute.input.latestStateSnapshotHash
            );

            expect(
                await compareEvidence(h, 1, forkId, theirs.dispute)
            ).to.equal(false);
        });
    });

    describe("reconstructAuditingData", function () {
        it("a dispute naming a snapshot absent from storage → rejects naming that snapshot, no auditing data", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;
            const absentSnapshotHash = ethers.id(
                "a snapshot this peer never stored"
            );

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const { dispute } =
                        (await sm.disputeManager.constructDispute(
                            args.forkId
                        ))!;
                    const isAbsent =
                        !sm.storage.stateSnapshots.getStateSnapshotByHash(
                            args.absentSnapshotHash as Hash
                        );
                    let threw = "";
                    let hasAuditingData = false;
                    try {
                        const auditingData = await sm.disputeManager[
                            "disputeBuilder"
                        ].reconstructAuditingData({
                            ...dispute.input,
                            latestStateSnapshotHash: args.absentSnapshotHash
                        });
                        hasAuditingData = auditingData !== undefined;
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }
                    return { isAbsent, threw, hasAuditingData };
                },
                { forkId, absentSnapshotHash }
            );

            expect(r.isAbsent).to.equal(true);
            expect(r.threw).to.equal(
                `reconstructAuditingData - no stored snapshot ${absentSnapshotHash}`
            );
            expect(r.hasAuditingData).to.equal(false);
        });
    });
});
