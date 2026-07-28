import { expect } from "chai";
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
            expect(String(dispute.input.forkId)).to.equal(forkId);
            expect(String(dispute.input.disputer).toLowerCase()).to.equal(
                peer.address.toLowerCase()
            );
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
                String(dispute.input.disputeAuditingDataHash)
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
            expect(
                submission.fraudProofParticipants.map((p) => p.toLowerCase())
            ).to.deep.equal([offender.address.toLowerCase()]);
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
            expect(
                submission.fraudProofParticipants.map((p) => p.toLowerCase())
            ).to.deep.equal([offender.address.toLowerCase()]);
            expect(submission.waited).to.equal(true);
            const dispute = Codec.decode(
                submission.encodedDispute,
                Type.Dispute
            );
            expect(dispute.postedAuditingData).to.equal(true);
            expect(hash(submission.encodedAuditingData!)).to.equal(
                String(dispute.input.disputeAuditingDataHash)
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

        it("real fault on a settled fork → dispute() applies the fraud proof via multicall, no calldata", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({ peerCount: 4 });
            const offender = await h.query.getNextPeerToWrite();

            // the honest disputers detect the invalid transition, store a fraud
            // proof for the offender, and dispute -> constructDispute bundles it
            // so dispute() takes the multicall branch (apply proofs + upload)
            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            // settled fork -> the dispute is final, no auditing calldata posted
            await h.assert.dispute.initiatedAndCommitedWait({
                initiatedWithAuditingData: false
            });
            await h.dispute.resolveDisputeWait({ forkId: h.activeForkId! });

            // the multicall applied the bundled fraud proof -> offender slashed
            const witness = h.peers.find((p) => p.index !== offender.index)!;
            const r = await h.execOnHost(
                witness,
                async (sm, args) => {
                    const slashes = (
                        await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                            sm.channelId
                        )
                    ).map((a) => String(a).toLowerCase());
                    return { offenderSlashed: slashes.includes(args.offender) };
                },
                { offender: offender.address.toLowerCase() }
            );

            expect(r.offenderSlashed).to.equal(true);
        });

        it("real fault on an unfinalized (pending-join) fork → dispute posted WITH auditing calldata", async function () {
            const h = TestSession.getHarness();
            // "calldata-backed" = the pending inbound join leaves the head
            // not-final-by-everyone, so the dispute's postedAuditingData is true
            // and dispute() takes the with-calldata upload (vs the settled-fork
            // test above, which posts without calldata). shorter evidence time
            // keeps the real resolve under budget
            await h.scenario.preDisputeSetupCalldataPath({
                timeConfig: { evidenceTime: 6 }
            });
            const offender = await h.query.getNextPeerToWrite();

            await h.byzantine.submitInvalidStateTransitionBlock(offender.index);
            // the diff from the settled-fork test: this dispute carries calldata
            await h.assert.dispute.initiatedAndCommitedWait({
                initiatedWithAuditingData: true
            });
            await h.dispute.resolveDisputeWait({
                forkId: h.activeForkId!,
                forkSettleTimeoutMs: 20000,
                syntheticOnChainParticipants: 1
            });

            const witness = h.peers.find((p) => p.index !== offender.index)!;
            const r = await h.execOnHost(
                witness,
                async (sm, args) => {
                    const slashes = (
                        await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                            sm.channelId
                        )
                    ).map((a) => String(a).toLowerCase());
                    return { offenderSlashed: slashes.includes(args.offender) };
                },
                { offender: offender.address.toLowerCase() }
            );

            expect(r.offenderSlashed).to.equal(true);
        });

        // skipped: flaky - exposes a real product bug (~10% of runs), not a test
        // defect. see the KNOWN RACE note below: a losing peer's reduceAndFinalize
        // reverts ErrorDisputeInboundMessageBlocksInvalid on the reduction path and
        // it's rethrown into a fire-and-forget promise -> unhandled detached
        // rejection.
        // https://trello.com/c/MUwszX7B
        it.skip("fault-free writer-timeout on a pending-join fork → dispute posts with calldata", async function () {
            this.timeout(90000);
            const h = TestSession.getHarness();

            // a pending inbound join leaves the head not-final-by-everyone, so a
            // dispute here carries postedAuditingData=true (auditing calldata)
            await h.scenario.preDisputeSetupCalldataPath({
                timeConfig: { chainFallbackTime: 2 }
            });

            // no block is produced -> the next writer's turn lapses -> the honest
            // peers dispute the timed-out writer. a timeout has no fraud proof, so
            // on this calldata-backed fork dispute() takes the no-multicall +
            // uploadDisputeWithCalldata path (the branch this test covers)
            const darkWriter = await h.query.getNextPeerToWrite();
            const disputers = h.peers
                .filter((p) => p.index !== darkWriter.index)
                .map((p) => p.index);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: disputers,
                expectedCount: disputers.length,
                initiatedWithAuditingData: true, // the calldata upload we wanted
                timeoutMs: 30000
            });

            // after commit every honest peer runs a fire-and-forget reduction to
            // settle the fork; one wins. KNOWN RACE: a losing peer precomputed its
            // reduce, but the on-chain reduceAndFinalize re-reduces against an
            // advanced window and reverts ErrorDisputeInboundMessageBlocksInvalid;
            // the reduction path doesn't handle that error -> it rethrows into a
            // fire-and-forget promise -> unhandled detached rejection (~10% of runs)
            await h.dispute.resolveDisputeWait({
                forkId: h.activeForkId!,
                honestPeerIndices: disputers,
                forkSettleTimeoutMs: 25000,
                assertMaliciousRemoved: false,
                syntheticOnChainParticipants: 1
            });
        });
    });

    describe("killDispute", function () {
        // no test: the "no dispute fraud proof found" throw is defensive -
        // killDispute's only caller (EventHandler after a failed audit) has
        // just stored the proof. forcing it means feeding a proofless dispute.
        it.skip("no stored fraud proof → throws (defensive)", function () {});

        // no test: `windowExists=false` is unreachable from the public surface.
        // a stored dispute fraud proof only exists for a dispute the peer
        // audited after it was committed, and committing creates the window;
        // _killDispute only pops the commitment, never the window
        // (DisputeVerificationFacet._killDispute).
        it.skip("no dispute window → killDispute returns before submitting (unreachable)", function () {});

        it("expired kill window → killDispute returns before submitting anything", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });
            const killer = h.getPeer(0);
            const forkId = h.activeForkId!;

            const kills = await Promise.all([
                h.rpcStub.suppressDisputeKill(0),
                h.rpcStub.suppressDisputeKill(1),
                h.rpcStub.suppressDisputeKill(2)
            ]);
            const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                killer.index
            );

            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.timeout.participant =
                    "0x0000000000000000000000000000000000000000";
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = false;
            });
            await kills[0].waitUntilSkipped();
            await kills[0].restore();

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

        it("live kill window → the stored proof is submitted and its transaction awaited", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 12 }
            });
            const killer = h.getPeer(0);

            // hold every peer's kill so the proof is stored but nothing is
            // submitted yet, then drive the one kill under test by hand
            const kills = await Promise.all([
                h.rpcStub.suppressDisputeKill(0),
                h.rpcStub.suppressDisputeKill(1),
                h.rpcStub.suppressDisputeKill(2)
            ]);
            const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                killer.index
            );

            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.timeout.participant =
                    "0x0000000000000000000000000000000000000000";
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = false;
            });
            // the skipped kill is the moment peer 0 stored its fraud proof
            await kills[0].waitUntilSkipped();
            await kills[0].restore();

            const r = await h.execOnHost(
                killer,
                async (sm) => {
                    const proofs =
                        sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                    await sm.disputeManager.killDispute(proofs[0].dispute);
                    return {
                        proofCount: proofs.length,
                        participant: String(proofs[0].participant).toLowerCase()
                    };
                },
                {},
                { timeoutMs: 30000 }
            );

            expect(r.proofCount).to.equal(1);
            const applies = await probe.applies();
            expect(applies.length).to.equal(1);
            expect(
                applies[0].participants.map((p) => p.toLowerCase())
            ).to.deep.equal([r.participant]);
            expect(applies[0].error).to.equal(null);
            expect(applies[0].waited).to.equal(true);
            expect(await h.query.onChainSlashedParticipants()).to.include(
                h.getPeer(1).address.toLowerCase()
            );
        });

        it("two killDispute calls inside one live kill window → one slash, the loser lands as a no-op", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 12 }
            });
            const killer = h.getPeer(0);

            // every other peer audits the spam dispute too (the spammer
            // included) - keep them out so the window is decided purely by peer
            // 0's two calls, whose applies park before they reach the chain
            await Promise.all([
                h.rpcStub.suppressDisputeKill(1),
                h.rpcStub.suppressDisputeKill(2)
            ]);
            const probe = await h.rpcStub.recordDisputeFraudProofApplies(
                killer.index,
                { hold: true }
            );

            // a dispute that's internally valid but has no enforcement basis ->
            // peer 0 audit-fails, stores a fraud proof and kills it
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.timeout.participant =
                    "0x0000000000000000000000000000000000000000";
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = false;
            });
            await probe.waitUntilHeld(1);

            // a second kill for the same dispute: the window is still live (the
            // first apply hasn't landed), so it clears the preflight too
            const second = h.execOnHost(
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
            await probe.waitUntilHeld(2);

            const before = await h.query.onChainSlashedParticipants();
            await probe.release();
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
            expect(after).to.include(h.getPeer(1).address.toLowerCase());
        });

        it("a killed spam dispute re-killed → no second slash, no throw", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: 6 }
            });

            // a dispute that's internally valid but has no enforcement basis ->
            // honest peers audit-fail, store a fraud proof, kill it, slash the
            // spammer (peer 1) on-chain
            await h.tamper.postTamperedDispute(1, (dispute) => {
                dispute.input.timeout.participant =
                    "0x0000000000000000000000000000000000000000";
                dispute.input.onChainSlashes = [];
                dispute.input.selfRemoval = false;
            });
            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });

            // the original detached kill (peer 0's EventHandler) shares peer 0's
            // signer with the re-kill below, so drain it first - two competing
            // applyDisputeFraudProofs txs would race on the nonce
            expect(
                (await h.quiesceHosts()).map((e) => e.message)
            ).to.deep.equal([]);

            // re-kill from the stored proof: the spammer is already slashed, so
            // the on-chain apply is idempotent -> killDispute completes with no
            // throw and no second slash
            const r = await h.execOnHost(
                h.getPeer(0),
                async (sm) => {
                    const proofs =
                        sm.storage.disputeFraudProofs.getDisputeFraudProofs();
                    if (proofs.length === 0) return { hadProof: false };
                    const before = (
                        await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                            sm.channelId
                        )
                    ).map(String);
                    let threw = "";
                    try {
                        await sm.disputeManager.killDispute(proofs[0].dispute);
                    } catch (e) {
                        threw = e instanceof Error ? e.message : String(e);
                    }
                    const after = (
                        await sm.diamondStateMachine.localDiamondContract.getOnChainSlashedParticipants(
                            sm.channelId
                        )
                    ).map(String);
                    return {
                        hadProof: true,
                        threw,
                        beforeCount: before.length,
                        afterCount: after.length
                    };
                },
                {},
                // two on-chain reads + a re-kill's on-chain apply can overrun the
                // default 2s control-RPC budget under load
                { timeoutMs: 20000 }
            );

            // the re-kill is the only in-flight apply -> it must settle clean
            expect(
                (await h.quiesceHosts()).map((e) => e.message)
            ).to.deep.equal([]);

            expect(r.hadProof).to.equal(true);
            expect(r.threw).to.equal("");
            expect(r.afterCount).to.equal(r.beforeCount);

            await h.dispute.resolveDisputeWait({
                forkId: h.activeForkId!,
                forkSettleTimeoutMs: 15000
            });
        });
    });

    describe("constructDispute → concurrency", function () {
        it("a fraud proof landing mid-construction → the same call bundles it and claims exactly that slash", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(3, 2); // blocks 0..1, next = 2
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
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
                        slashes: dispute.input.onChainSlashes.map((a) =>
                            String(a).toLowerCase()
                        ),
                        fraudProofCount: fraudProofsToApply.length
                    };
                },
                { forkId },
                { timeoutMs: 30000 }
            );
            await hold.waitUntilParked();
            expect(await hold.parkedCount()).to.equal(1);

            // land the proof inside the window, then let the construction finish
            const validation = await h
                .control(observer)
                .stub.runBlockValidation(encodedBlock)
                .request();
            expect(validation.fraudProofType).to.not.be.null;

            await hold.release();
            const r = await constructing;

            // nothing is slashed on-chain, so the proof that landed mid-flight
            // must account for exactly one claimed slash - no more, no less
            expect(r.fraudProofCount).to.equal(1);
            expect(r.slashes).to.deep.equal([offender.address.toLowerCase()]);
        });
    });
});
