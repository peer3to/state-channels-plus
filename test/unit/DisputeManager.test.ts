import { expect } from "chai";
import { ZeroAddress } from "ethers";
import { Codec, hash, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";

describe("Unit: DisputeManager", function () {
    describe("constructDispute", function () {
        it("healthy fork → well-formed dispute, verifyStateProof accepts it", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3); // fully-signed -> milestone proof
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    const { dispute, auditingData, fraudProofsToApply } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    // real oracle: the on-chain state-proof verifier accepts it
                    const verified =
                        await sm.stateChannelManagerContract.verifyStateProof.staticCall(
                            dispute,
                            auditingData
                        );
                    return {
                        verified,
                        forkId: String(dispute.input.forkId),
                        channelId: String(dispute.input.channelId),
                        disputer: String(dispute.input.disputer),
                        signerAddress: String(sm.signerAddress),
                        channelIdField: String(sm.channelId),
                        fraudProofCount: fraudProofsToApply.length,
                        postedAuditingData: dispute.postedAuditingData,
                        timeoutParticipant: String(
                            dispute.input.timeout.participant
                        )
                    };
                },
                { forkId }
            );

            expect(r.verified).to.equal(true);
            expect(r.forkId).to.equal(forkId);
            expect(r.channelId).to.equal(r.channelIdField);
            expect(r.disputer.toLowerCase()).to.equal(
                r.signerAddress.toLowerCase()
            );
            // no faults staged -> nothing to slash, latest is final -> no calldata
            expect(r.fraudProofCount).to.equal(0);
            expect(r.postedAuditingData).to.equal(false);
            // no timeout planted -> empty timeout struct (getEmptyTimeoutStruct)
            expect(r.timeoutParticipant).to.equal(
                "0x0000000000000000000000000000000000000000"
            );
        });

        it("no blocks written yet → a genesis-based dispute with an empty state proof", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // channel open, nothing written
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    const { dispute, auditingData, fraudProofsToApply } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    const verified =
                        await sm.stateChannelManagerContract.verifyStateProof.staticCall(
                            dispute,
                            auditingData
                        );
                    const genesis =
                        sm.storage.stateSnapshots.getGenesisSnapshotByForkId(
                            args.forkId
                        )!;
                    return {
                        verified,
                        latestBlockHeight:
                            Number(
                                sm.storage.blocks.getNextBlockHeight(
                                    args.forkId
                                )
                            ) - 1,
                        milestoneCount:
                            dispute.input.stateProof.milestones.length,
                        signedBlockCount:
                            dispute.input.stateProof.signedBlocks.length,
                        fraudProofCount: fraudProofsToApply.length,
                        latestStateSnapshotHash:
                            dispute.input.latestStateSnapshotHash,
                        genesisHash: genesis.hash,
                        timeoutParticipant: dispute.input.timeout.participant,
                        timeoutBlockHeight: Number(
                            dispute.input.timeout.blockHeight
                        ),
                        selfRemoval: dispute.input.selfRemoval,
                        onChainSlashCount: dispute.input.onChainSlashes.length,
                        inboundHash:
                            dispute.input.latestInboundMessageBlockHash,
                        inboundHeight: Number(
                            dispute.input.lastInboundMessageBlockHeight
                        ),
                        storedInboundHash:
                            sm.storage.inboundMessages.getLatestBlockHash(),
                        storedInboundHeight: Number(
                            sm.storage.inboundMessages.getLatestBlockHeight()
                        )
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // the pre-first-block boundary: latestBlockHeight is -1
            expect(r.latestBlockHeight).to.equal(-1);
            expect(r.verified).to.equal(true);
            expect(r.milestoneCount).to.equal(0);
            expect(r.signedBlockCount).to.equal(0);
            expect(r.fraudProofCount).to.equal(0);
            // the head is genesis -> the dispute pins the genesis snapshot
            expect(r.latestStateSnapshotHash).to.equal(r.genesisHash);
            expect(r.timeoutParticipant).to.equal(ZeroAddress);
            expect(r.timeoutBlockHeight).to.equal(0);
            expect(r.selfRemoval).to.equal(false);
            expect(r.onChainSlashCount).to.equal(0);
            // the channel-open join already left an inbound head - the dispute
            // copies it verbatim rather than defaulting to zero
            expect(r.inboundHash).to.equal(r.storedInboundHash);
            expect(r.inboundHeight).to.equal(r.storedInboundHeight);
        });

        it("inbound chain event lagging the pinned snapshot → the anchor comes from the snapshot, not the stale store head", async function () {
            const h = TestSession.getHarness();
            await h.setup(3);
            // held from before the channel opens -> peer 2's inbound store head
            // never moves while ingest advances its snapshot to inbound block 2
            const lagging = 2;
            const held = await h.rpcStub.holdInboundMessageEvents(lagging);
            await h.lifecycle.openChannel();
            const forkId = h.activeForkId!;

            await h.join.forceInboundJoinWait({
                participant: h.getPeer(0).address,
                observePeerIndices: [0, 1]
            });
            // writers are peers 0 and 1 -> the lagging peer only ingests
            await h.transition.advanceState({
                count: 2,
                waitForFinalization: true
            });
            await h.assert.sync.peersInSyncWait();

            const r = await h.execOnHost(
                h.getPeer(lagging),
                async (sm, args) => {
                    const { dispute, auditingData } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    // real oracle: the honest peer's own dispute must not be
                    // provably slashable by the proof the auditors run
                    const slashable =
                        await sm.diamondStateMachine.localDiamondContract.isDisputeInboundAnchorBehindLatestState.staticCall(
                            dispute,
                            auditingData.latestStateSnapshot
                        );
                    const snapshotData =
                        auditingData.latestStateSnapshot.snapshotData;
                    return {
                        slashable,
                        inboundHash:
                            dispute.input.latestInboundMessageBlockHash,
                        inboundHeight: Number(
                            dispute.input.lastInboundMessageBlockHeight
                        ),
                        snapshotInboundHash:
                            snapshotData.latestInboundMessageBlockHash,
                        snapshotInboundHeight: Number(
                            snapshotData.latestInboundMessageBlockHeight
                        ),
                        storedInboundHash:
                            sm.storage.inboundMessages.getLatestBlockHash() ??
                            null
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // premise - the chain event never landed, so the store head is
            // behind the snapshot the dispute pins
            expect(await held.heldCount()).to.be.greaterThan(0);
            expect(r.storedInboundHash).to.equal(null);
            expect(r.snapshotInboundHeight).to.equal(2);
            expect(r.slashable).to.equal(false);
            // getAuditingData walked the gapped store without throwing
            expect(r.inboundHash).to.equal(r.snapshotInboundHash);
            expect(r.inboundHeight).to.equal(r.snapshotInboundHeight);
        });

        // no test: `createDispute - isPartial auditingData` is unreachable from
        // constructDispute. a peer's own proof only spans data it stored - a
        // missing milestone snapshot already throws inside getStateProof
        // ("Milestone built but corresponding snapshot not found") and the head
        // snapshot is required by the "missing state snapshot" guard above it.
        // getAuditingData only goes partial for a proof handed in by someone
        // else, which is the audit path covered under `getAuditingData`.
        it.skip("own proof missing referenced data → isPartial auditingData (unreachable)", function () {});

        it("a peer behind the head → constructDispute builds a complete dispute over what it has", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.network.disconnectPeer(2); // peer 2 misses blocks 0..1
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(2),
                async (sm, args) => {
                    const { dispute, auditingData } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    // the partial guard did not fire -> the proof is whole for
                    // this peer, and the on-chain verifier accepts it
                    const verified =
                        await sm.stateChannelManagerContract.verifyStateProof.staticCall(
                            dispute,
                            auditingData
                        );
                    return {
                        verified,
                        ownHeight:
                            Number(
                                sm.storage.blocks.getNextBlockHeight(
                                    args.forkId
                                )
                            ) - 1
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            expect(r.verified).to.equal(true);
            // behind the peers that kept writing, yet still self-consistent
            expect(r.ownHeight).to.be.lessThan(2);
        });

        it("a participant has a stored fraud proof → constructDispute bundles it + marks them slashed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1, next = 2
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const offender = await h.byzantine.storeInvalidTransitionFraudProof(
                observer.index
            );

            const r = await h.execOnHost(
                observer,
                async (sm, args) => {
                    const { dispute, fraudProofsToApply } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    const slashes = dispute.input.onChainSlashes.map((a) =>
                        String(a).toLowerCase()
                    );
                    return {
                        fraudProofCount: fraudProofsToApply.length,
                        offenderSlashed: slashes.includes(
                            args.offender.toLowerCase()
                        )
                    };
                },
                { forkId, offender: offender.address }
            );

            expect(r.fraudProofCount).to.equal(1);
            expect(r.offenderSlashed).to.equal(true);
        });

        it("latest block final by everyone → postedAuditingData false", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3); // fully-signed latest -> final
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const { dispute } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    return { postedAuditingData: dispute.postedAuditingData };
                },
                { forkId }
            );

            expect(r.postedAuditingData).to.equal(false);
        });

        it("unfinalized inbound join at the head → postedAuditingData true (calldata needed)", async function () {
            const h = TestSession.getHarness();
            // a pending inbound join leaves the head not-final-by-everyone, so
            // the last milestone isn't final -> auditing data must be posted
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const { dispute } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    return { postedAuditingData: dispute.postedAuditingData };
                },
                { forkId }
            );

            expect(r.postedAuditingData).to.equal(true);
        });

        it("a fresh timeout planted for the next writer → carried into dispute.input.timeout", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const nextWriter = await h
                .control(peer)
                .query.getNextToWrite()
                .request();
            await h
                .control(peer)
                .dispute.plantFreshTimeout(forkId, nextWriter)
                .request();

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    const { dispute } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    return {
                        timeoutParticipant: String(
                            dispute.input.timeout.participant
                        )
                    };
                },
                { forkId }
            );

            expect(r.timeoutParticipant.toLowerCase()).to.equal(
                nextWriter.toLowerCase()
            );
        });
    });

    describe("getAuditingData", function () {
        // no test: genesisStateSnapshot missing -> throw is defensive.
        // getAuditingData only runs for a fork the peer already has (own fork
        // via constructDispute, or an audited dispute whose fork was
        // spectate-synced first); an unknown forkId is a pre-sync condition.
        it.skip("unknown forkId → genesisStateSnapshot not found (defensive)", function () {});

        it("own fully-synced fork proof → not partial, one milestoneSnapshot per proof milestone", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3); // fully-signed -> milestone proof
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const height =
                        Number(
                            sm.storage.blocks.getNextBlockHeight(args.forkId)
                        ) - 1;
                    const stateProof = await sm.agreementManager.getStateProof(
                        args.forkId,
                        height
                    );
                    const { isPartial, auditingData } =
                        sm.disputeManager.getAuditingData(
                            args.forkId,
                            stateProof
                        );
                    return {
                        isPartial,
                        milestoneSnapshotCount:
                            auditingData.milestoneSnapshots.length,
                        proofMilestoneCount: stateProof.milestones.length
                    };
                },
                { forkId }
            );

            expect(r.isPartial).to.equal(false);
            expect(r.proofMilestoneCount).to.be.greaterThan(0);
            expect(r.milestoneSnapshotCount).to.equal(r.proofMilestoneCount);
        });

        it("a peer fed a proof for blocks it never stored → isPartial true", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0);
            await h.network.disconnectPeer(2); // peer 2 misses blocks 0..1
            await h.transition.advanceState({ count: 2, waitForPeers: [0, 1] });
            const forkId = h.activeForkId!;

            // peer 0's real proof references block 1's snapshot; ship it to the
            // behind peer, which never stored that snapshot -> partial
            const { encodedDispute } = await h
                .control(h.getPeer(0))
                .dispute.constructDispute(forkId)
                .request();
            const dispute = Codec.decode(encodedDispute, Type.Dispute);
            const encodedStateProof = Codec.encode(
                dispute.input.stateProof,
                Type.StateProof
            ) as string;

            const behind = await h
                .control(h.getPeer(2))
                .dispute.getAuditingData(forkId, encodedStateProof)
                .request();
            const synced = await h
                .control(h.getPeer(0))
                .dispute.getAuditingData(forkId, encodedStateProof)
                .request();

            expect(behind.isPartial).to.equal(true);
            // control: the peer that authored the proof reconstructs it whole
            expect(synced.isPartial).to.equal(false);
        });

        it("an empty state proof → latest state snapshot falls back to genesis, not partial", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 0); // no blocks -> empty proof at height 0
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    const stateProof = await sm.agreementManager.getStateProof(
                        args.forkId,
                        0
                    );
                    const { isPartial, auditingData } =
                        sm.disputeManager.getAuditingData(
                            args.forkId,
                            stateProof
                        );
                    const genesis = sm.storage.stateSnapshots
                        .getGenesisSnapshotByForkId(args.forkId)!
                        .toStruct();
                    return {
                        isPartial,
                        milestoneCount: stateProof.milestones.length,
                        signedBlockCount: stateProof.signedBlocks.length,
                        latestStateHash: String(
                            auditingData.latestStateSnapshot.snapshotData
                                .stateMachineStateHash
                        ),
                        genesisStateHash: String(
                            genesis.snapshotData.stateMachineStateHash
                        )
                    };
                },
                { forkId }
            );

            expect(r.milestoneCount).to.equal(0);
            expect(r.signedBlockCount).to.equal(0);
            // no block in the proof -> latest resolves to genesis, all present
            expect(r.isPartial).to.equal(false);
            expect(r.latestStateHash).to.equal(r.genesisStateHash);
        });
    });

    // the four submission branches dispute() picks between: fraud-proof or not
    // (multicall or a bare upload) x calldata or not (which upload). the uploads
    // are recorded instead of sent - a real one posts an on-chain dispute
    // against a healthy fork and derails the session; the e2e dispute flows
    // cover the sends for real.
    describe("dispute → submission branch", function () {
        it("no fraud proof, settled fork → uploadDispute alone", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3); // fully-signed head -> no calldata
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const probe = await h.rpcStub.recordDisputeSubmissions(peer.index);
            const disputed = await h.execOnHost(
                peer,
                async (sm, args) => {
                    await sm.disputeManager.dispute(args.forkId);
                    return sm.storage.disputes.didIDispute(args.forkId);
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            const [submission] = await probe.submissions();
            expect(submission.method).to.equal("uploadDispute");
            expect(submission.encodedAuditingData).to.equal(null);
            expect(submission.gasLimit).to.equal("2500000");
            expect(submission.waited).to.equal(true);
            const dispute = Codec.decode(
                submission.encodedDispute,
                Type.Dispute
            );
            expect(dispute.input.forkId).to.equal(forkId);
            expect(dispute.input.disputer).to.equal(peer.address);
            expect(dispute.postedAuditingData).to.equal(false);
            expect(disputed).to.equal(true);
            expect(
                h.event.getEventCallCount(peer.index, "onInitiatingDispute")
            ).to.equal(1);
        });

        it("no fraud proof, unfinalized fork → uploadDisputeWithCalldata alone", async function () {
            const h = TestSession.getHarness();
            // a pending inbound join leaves the head not-final-by-everyone
            await h.scenario.preDisputeSetupCalldataPath();
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const probe = await h.rpcStub.recordDisputeSubmissions(peer.index);
            const disputed = await h.execOnHost(
                peer,
                async (sm, args) => {
                    await sm.disputeManager.dispute(args.forkId);
                    return sm.storage.disputes.didIDispute(args.forkId);
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            const [submission] = await probe.submissions();
            expect(submission.method).to.equal("uploadDisputeWithCalldata");
            expect(submission.gasLimit).to.equal(null);
            expect(submission.waited).to.equal(true);
            const dispute = Codec.decode(
                submission.encodedDispute,
                Type.Dispute
            );
            expect(dispute.postedAuditingData).to.equal(true);
            // the auditing data uploaded is the one the dispute commits to
            expect(hash(submission.encodedAuditingData!)).to.equal(
                dispute.input.disputeAuditingDataHash
            );
            expect(disputed).to.equal(true);
            expect(
                h.event.getEventCallCount(peer.index, "onInitiatingDispute")
            ).to.equal(1);
        });

        it("a fraud proof, settled fork → multicall of applyFraudProofs + uploadDispute", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const offender = await h.byzantine.storeInvalidTransitionFraudProof(
                peer.index
            );

            const probe = await h.rpcStub.recordDisputeSubmissions(peer.index);
            const disputed = await h.execOnHost(
                peer,
                async (sm, args) => {
                    await sm.disputeManager.dispute(args.forkId);
                    return sm.storage.disputes.didIDispute(args.forkId);
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            const [submission] = await probe.submissions();
            expect(submission.method).to.equal("multicall");
            expect(submission.innerMethods).to.deep.equal([
                "applyFraudProofs",
                "uploadDispute"
            ]);
            expect(submission.fraudProofParticipants).to.deep.equal([
                offender.address
            ]);
            expect(submission.encodedAuditingData).to.equal(null);
            expect(submission.waited).to.equal(true);
            const dispute = Codec.decode(
                submission.encodedDispute,
                Type.Dispute
            );
            expect(dispute.postedAuditingData).to.equal(false);
            expect(disputed).to.equal(true);
            expect(
                h.event.getEventCallCount(peer.index, "onInitiatingDispute")
            ).to.equal(1);
        });

        it("a fraud proof, unfinalized fork → multicall of applyFraudProofs + uploadDisputeWithCalldata", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const offender = await h.byzantine.storeInvalidTransitionFraudProof(
                peer.index
            );

            const probe = await h.rpcStub.recordDisputeSubmissions(peer.index);
            const disputed = await h.execOnHost(
                peer,
                async (sm, args) => {
                    await sm.disputeManager.dispute(args.forkId);
                    return sm.storage.disputes.didIDispute(args.forkId);
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            const [submission] = await probe.submissions();
            expect(submission.method).to.equal("multicall");
            expect(submission.innerMethods).to.deep.equal([
                "applyFraudProofs",
                "uploadDisputeWithCalldata"
            ]);
            expect(submission.fraudProofParticipants).to.deep.equal([
                offender.address
            ]);
            expect(submission.waited).to.equal(true);
            const dispute = Codec.decode(
                submission.encodedDispute,
                Type.Dispute
            );
            expect(dispute.postedAuditingData).to.equal(true);
            expect(hash(submission.encodedAuditingData!)).to.equal(
                dispute.input.disputeAuditingDataHash
            );
            expect(disputed).to.equal(true);
            expect(
                h.event.getEventCallCount(peer.index, "onInitiatingDispute")
            ).to.equal(1);
        });
    });

    // how dispute() reacts to a failing upload. the failures are injected at the
    // contract boundary as the real 4-byte custom-error revert data, so the
    // SDK's own decoder + handler table decide the outcome.
    describe("dispute → upload failure policy", function () {
        it("ErrorCantParticipateInDispute → dispute() resolves and the fork stays undisputed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            await h.rpcStub.recordDisputeSubmissions(peer.index, {
                failWith: {
                    customError: "ErrorCantParticipateInDispute",
                    at: "send"
                }
            });

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    let rejected = "";
                    try {
                        await sm.disputeManager.dispute(args.forkId);
                    } catch (e) {
                        rejected = e instanceof Error ? e.message : String(e);
                    }
                    return {
                        rejected,
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // the handler consumes the error -> no rejection, marker cleared
            expect(r.rejected).to.equal("");
            expect(r.disputed).to.equal(false);
        });

        it("RaceConditionDisputeTimeoutWindowCreatedTooEarly → consumed no-op, marker reset", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            // the send lands but the window predates the timeout deadline, so
            // the revert surfaces from tx.wait() - after the marker was stored
            await h.rpcStub.recordDisputeSubmissions(peer.index, {
                failWith: {
                    customError:
                        "RaceConditionDisputeTimeoutWindowCreatedTooEarly",
                    at: "wait"
                }
            });

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    let rejected = "";
                    try {
                        await sm.disputeManager.dispute(args.forkId);
                    } catch (e) {
                        rejected = e instanceof Error ? e.message : String(e);
                    }
                    return {
                        rejected,
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            expect(r.rejected).to.equal("");
            expect(r.disputed).to.equal(false);
        });

        it("RaceConditionDisputeEvidencePeriodExpired at send → rejects, marker never set", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            await h.rpcStub.recordDisputeSubmissions(peer.index, {
                failWith: {
                    customError: "RaceConditionDisputeEvidencePeriodExpired",
                    at: "send"
                }
            });

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    let rejected = "";
                    try {
                        await sm.disputeManager.dispute(args.forkId);
                    } catch (e) {
                        rejected = e instanceof Error ? e.message : String(e);
                    }
                    return {
                        rejected,
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // this handler rethrows -> the caller sees the custom error, and
            // the send failed before the line that stores the marker
            expect(r.rejected).to.contain(
                "RaceConditionDisputeEvidencePeriodExpired"
            );
            expect(r.disputed).to.equal(false);
        });

        it("RaceConditionDisputeEvidencePeriodExpired at wait → rejects with the marker left set", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            await h.rpcStub.recordDisputeSubmissions(peer.index, {
                failWith: {
                    customError: "RaceConditionDisputeEvidencePeriodExpired",
                    at: "wait"
                }
            });

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    let rejected = "";
                    try {
                        await sm.disputeManager.dispute(args.forkId);
                    } catch (e) {
                        rejected = e instanceof Error ? e.message : String(e);
                    }
                    return {
                        rejected,
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // the rethrow skips the storeDisputedFork(false) in the catch, so
            // the marker stored before the await survives
            expect(r.rejected).to.contain(
                "RaceConditionDisputeEvidencePeriodExpired"
            );
            expect(r.disputed).to.equal(true);
        });

        it("an unrecognized send failure → swallowed, fork left undisputed", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            await h.rpcStub.recordDisputeSubmissions(peer.index, {
                failWith: { message: "upload rejected by the node", at: "send" }
            });

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    let rejected = "";
                    try {
                        await sm.disputeManager.dispute(args.forkId);
                    } catch (e) {
                        rejected = e instanceof Error ? e.message : String(e);
                    }
                    return {
                        rejected,
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // no handler matches -> logged, swallowed, marker cleared
            expect(r.rejected).to.equal("");
            expect(r.disputed).to.equal(false);
        });

        it("an unrecognized wait() failure → swallowed, the stored marker is cleared", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            await h.rpcStub.recordDisputeSubmissions(peer.index, {
                failWith: { message: "receipt reverted", at: "wait" }
            });

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    let rejected = "";
                    try {
                        await sm.disputeManager.dispute(args.forkId);
                    } catch (e) {
                        rejected = e instanceof Error ? e.message : String(e);
                    }
                    return {
                        rejected,
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // the marker was already stored true here, so the catch's
            // storeDisputedFork(false) is what has to undo it
            expect(r.rejected).to.equal("");
            expect(r.disputed).to.equal(false);
        });
    });

    describe("dispute", function () {
        it("already-disputed fork → dispute() short-circuits before constructDispute", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2);
            const forkId = h.activeForkId!;

            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm, args) => {
                    // mark the fork disputed via the same setter dispute() uses,
                    // then re-enter: the didIDispute guard must skip everything
                    sm.storage.disputes.storeDisputedFork(args.forkId, true);
                    const dm = sm.disputeManager;
                    let constructCalls = 0;
                    const original = dm.constructDispute.bind(dm);
                    dm.constructDispute = async (f) => {
                        constructCalls += 1;
                        return original(f);
                    };
                    try {
                        await dm.dispute(args.forkId);
                    } finally {
                        dm.constructDispute = original;
                    }
                    return {
                        constructCalls,
                        stillDisputed: sm.storage.disputes.didIDispute(
                            args.forkId
                        )
                    };
                },
                { forkId }
            );

            expect(r.constructCalls).to.equal(0);
            expect(r.stillDisputed).to.equal(true);
        });

        it("two concurrent dispute() calls → the mutex serializes them, only the first uploads", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const probe = await h.rpcStub.recordDisputeSubmissions(peer.index, {
                hold: true
            });

            // the first caller holds the mutex, parked at its upload
            const first = h.execOnHost(
                peer,
                async (sm, args) => {
                    await sm.disputeManager.dispute(args.forkId);
                    return {
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );
            await probe.waitUntilHeld();

            // the second caller queues behind the mutex; when it finally runs it
            // must see didIDispute=true and return before constructing anything
            const second = h.execOnHost(
                peer,
                async (sm, args) => {
                    const dm = sm.disputeManager;
                    let constructCalls = 0;
                    const original = dm.constructDispute.bind(dm);
                    dm.constructDispute = async (f) => {
                        constructCalls += 1;
                        return original(f);
                    };
                    try {
                        await dm.dispute(args.forkId);
                    } finally {
                        dm.constructDispute = original;
                    }
                    return {
                        constructCalls,
                        disputed: sm.storage.disputes.didIDispute(args.forkId)
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );
            await h.rpcStub.waitUntilDisputeMutexContended(peer.index);
            // still parked -> the waiter reached no upload of its own
            expect((await probe.submissions()).length).to.equal(1);

            await probe.release();
            const [firstResult, secondResult] = await Promise.all([
                first,
                second
            ]);

            const submissions = await probe.submissions();
            expect(submissions.length).to.equal(1);
            expect(submissions[0].method).to.equal("uploadDispute");
            expect(submissions[0].waited).to.equal(true);
            expect(firstResult.disputed).to.equal(true);
            // the waiter short-circuited on the marker the first call stored
            expect(secondResult.constructCalls).to.equal(0);
            expect(secondResult.disputed).to.equal(true);
            expect(
                h.event.getEventCallCount(peer.index, "onInitiatingDispute")
            ).to.equal(1);
        });
    });

    describe("killDispute", function () {
        it("no stored fraud proof → the throw stays inside, nothing is submitted", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 3);
            const peer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                peer.index
            );

            const r = await h.execOnHost(
                peer,
                async (sm, args) => {
                    // a locally constructed dispute nobody audited -> no proof
                    const { dispute } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    let threw = "";
                    try {
                        await sm.disputeManager.killDispute(dispute);
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }
                    return {
                        threw,
                        storedProofs:
                            sm.storage.disputeFraudProofs.getDisputeFraudProofs()
                                .length
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );

            // the "No dispute fraud proof found" throw is inside killDispute's
            // catch-all -> the method resolves and never reaches a submission
            expect(r.storedProofs).to.equal(0);
            expect(r.threw).to.equal("");
            expect(await probe.applies()).to.deep.equal([]);
        });

        // no test: `windowExists=false` is unreachable from the public surface.
        // a stored dispute fraud proof only exists for a dispute the peer
        // audited after it was committed, and committing creates the window;
        // _killDispute only pops the commitment, never the window
        // (DisputeVerificationFacet._killDispute).
        it.skip("no dispute window → killDispute returns before submitting (unreachable)", function () {});

        it("expired kill window → killDispute returns before submitting anything", async function () {
            const h = TestSession.getHarness();
            const { killer, forkId } =
                await h.scenario.stageUnkilledSpamDispute({
                    timeConfig: { evidenceTime: 6 }
                });
            const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                killer.index
            );

            // let the kill period lapse while the stored proof sits unused
            const { killPeriodEnd } = await h.query.killPeriod(forkId);
            await h.event.waitUntilTimestamp(killPeriodEnd + 2);
            const period = await h.query.killPeriod(forkId);
            expect(period.windowExists).to.equal(true);
            expect(period.isExpired).to.equal(true);

            const r = await h.execOnHost(
                killer,
                async (sm) => {
                    const proofs =
                        sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                    let threw = "";
                    try {
                        await sm.disputeManager.killDispute(proofs[0].dispute);
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }
                    return { threw };
                },
                {},
                { timeoutMs: 30000 }
            );

            expect(r.threw).to.equal("");
            expect(await probe.applies()).to.deep.equal([]);
        });

        // the races killDispute recognises. each is injected at the contract
        // boundary as the real 4-byte custom-error revert data, so the SDK's own
        // decoder + handler table decide the outcome.
        for (const customError of [
            "RaceConditionDisputeKillPeriodExpired",
            "RaceConditionOnChainSlashes",
            "RaceConditionGenesisTimestampNotAvailable",
            "RaceConditionUnexpectedBlockCalldataPosted"
        ] as const) {
            it(`${customError} on the apply → consumed, no rejection, no detached error`, async function () {
                const h = TestSession.getHarness();
                const { killer } = await h.scenario.stageUnkilledSpamDispute();
                const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                    killer.index,
                    { failWith: { customError, at: "send" } }
                );

                const r = await h.execOnHost(
                    killer,
                    async (sm) => {
                        const proofs =
                            sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                        let threw = "";
                        try {
                            await sm.disputeManager.killDispute(
                                proofs[0].dispute
                            );
                        } catch (e) {
                            threw = e instanceof Error ? e.message : String(e);
                        }
                        return { threw };
                    },
                    {},
                    { timeoutMs: 30000 }
                );

                expect(r.threw).to.equal("");
                const [apply] = await probe.applies();
                expect(apply.customError).to.equal(customError);
                expect(
                    (await h.quiesceHosts()).map((e) => e.message)
                ).to.deep.equal([]);
            });
        }

        for (const at of ["send", "wait"] as const) {
            it(`an unrecognized apply failure at ${at} → swallowed, nothing retried`, async function () {
                const h = TestSession.getHarness();
                const { killer, spammer } =
                    await h.scenario.stageUnkilledSpamDispute();
                const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                    killer.index,
                    { failWith: { message: "apply rejected by the node", at } }
                );

                const r = await h.execOnHost(
                    killer,
                    async (sm) => {
                        const proofs =
                            sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                        let threw = "";
                        try {
                            await sm.disputeManager.killDispute(
                                proofs[0].dispute
                            );
                        } catch (e) {
                            threw = e instanceof Error ? e.message : String(e);
                        }
                        return { threw };
                    },
                    {},
                    { timeoutMs: 30000 }
                );

                // logged and swallowed; no handler matches, nothing resent
                expect(r.threw).to.equal("");
                const applies = await probe.applies();
                expect(applies.length).to.equal(1);
                expect(applies[0].customError).to.equal(null);
                expect(
                    (await h.quiesceHosts()).map((e) => e.message)
                ).to.deep.equal([]);
                // the apply never landed -> the spammer is still unslashed
                expect(
                    await h.query.onChainSlashedParticipants()
                ).to.not.include(spammer.address);
            });
        }

        it("live kill window → the stored proof is submitted and its transaction awaited", async function () {
            const h = TestSession.getHarness();
            const { killer, spammer } =
                await h.scenario.stageUnkilledSpamDispute();
            const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                killer.index
            );

            const r = await h.execOnHost(
                killer,
                async (sm) => {
                    const proofs =
                        sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                    await sm.disputeManager.killDispute(proofs[0].dispute);
                    return {
                        proofCount: proofs.length,
                        participant: proofs[0].participant
                    };
                },
                {},
                { timeoutMs: 30000 }
            );

            expect(r.proofCount).to.equal(1);
            const applies = await probe.applies();
            expect(applies.length).to.equal(1);
            expect(applies[0].participants).to.deep.equal([r.participant]);
            expect(applies[0].error).to.equal(null);
            expect(applies[0].waited).to.equal(true);
            expect(await h.query.onChainSlashedParticipants()).to.include(
                spammer.address
            );
        });

        it("two killDispute calls inside one live kill window → one slash, the loser lands as a no-op", async function () {
            const h = TestSession.getHarness();
            const { killer, spammer } =
                await h.scenario.stageUnkilledSpamDispute();
            // both kills park before they reach the chain, so the window stays
            // live for both of them
            const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                killer.index,
                { hold: true }
            );

            const kill = () =>
                h.execOnHost(
                    killer,
                    async (sm) => {
                        const proofs =
                            sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                        if (proofs.length === 0) return { hadProof: false };
                        await sm.disputeManager.killDispute(proofs[0].dispute);
                        return { hadProof: true };
                    },
                    {},
                    { timeoutMs: 30000 }
                );
            const first = kill();
            await probe.waitUntilHeld(1);
            const second = kill();
            await probe.waitUntilHeld(2);

            const before = await h.query.onChainSlashedParticipants();
            await probe.release();
            expect(await first).to.deep.equal({ hadProof: true });
            expect(await second).to.deep.equal({ hadProof: true });
            expect(
                (await h.quiesceHosts()).map((e) => e.message)
            ).to.deep.equal([]);

            // both applies were sent while the window was live; the loser found
            // the dispute already uncommitted -> it lands without an error and
            // slashes nobody a second time
            const applies = await probe.applies();
            expect(applies.length).to.equal(2);
            expect(applies.map((a) => a.error)).to.deep.equal([null, null]);
            const after = await h.query.onChainSlashedParticipants();
            expect(after.length).to.equal(before.length + 1);
            expect(after).to.include(spammer.address);
        });
    });

    describe("constructDispute → concurrency", function () {
        it("fraud proof stored while constructDispute is held at getStateProof → lands in fraudProofsToApply and onChainSlashes", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1, next = 2
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            // crafted only - nothing is stored until it is validated below
            const { offender, encodedBlock } =
                await h.byzantine.craftInvalidTransitionBlock(observer.index);

            // park the construction after it started but before it reads the
            // stored fraud proofs - the on-chain slash set is already being read
            const hold = await h.rpcStub.holdConstructDisputeAtStateProof(
                observer.index,
                forkId
            );
            const constructing = h.execOnHost(
                observer,
                async (sm, args) => {
                    const { dispute, fraudProofsToApply } =
                        await sm.disputeManager.constructDispute(args.forkId);
                    return {
                        onChainSlashes: dispute.input.onChainSlashes,
                        fraudProofCount: fraudProofsToApply.length
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );
            // the park is scoped to constructDispute, so this pins that call
            await hold.waitUntilParked();
            expect(await hold.parkedCount()).to.equal(1);

            // store the proof inside the window, then let the construction finish
            const validation = await h
                .control(observer)
                .stub.runBlockValidation(encodedBlock)
                .request();
            expect(validation.fraudProofType).to.not.be.null;

            await hold.release();
            const r = await constructing;

            // nothing is slashed on-chain, so the proof stored mid-flight must
            // account for exactly one claimed slash - no more, no less
            expect(r.fraudProofCount).to.equal(1);
            expect(r.onChainSlashes).to.deep.equal([offender.address]);
        });
    });
});
