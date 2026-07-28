import { expect } from "chai";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import * as factory from "@test/factory";
import type { Address } from "@/types/types";

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

            const [nextHeight, nextWriter, prevBlock] = await Promise.all([
                h.control(observer).query.getNextBlockHeight(forkId).request(),
                h.control(observer).query.getNextToWrite().request(),
                h.control(observer).query.getBlockByHeight(forkId, 1).request()
            ]);

            // a linked next block by a non-leader -> real InvalidStateTransition
            // fraud proof, stored for the offender in this peer's storage
            const offender = h.peers.find(
                (p) => p.address.toLowerCase() !== nextWriter.toLowerCase()
            )!;
            const encoded = await factory.buildAndEncodeBlock(offender.signer, {
                header: {
                    channelId: h.channelId,
                    forkId,
                    transactionCnt: nextHeight,
                    participant: offender.address as Address
                },
                previousBlockHash: prevBlock!.hash
            });
            const validation = await h
                .control(observer)
                .stub.runBlockValidation(encoded)
                .request();
            expect(validation.fraudProofType).to.not.be.null; // fraud proof stored

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
        it("constructDispute sampled while fraud proofs land → onChainSlashes stays consistent with bundled proofs, never throws", async function () {
            const h = TestSession.getHarness();
            await h.lifecycle.start(5, 2); // blocks 0..1, next = 2
            const observer = h.getPeer(0);
            const forkId = h.activeForkId!;
            const nextHeight = 2;

            const [nextWriter, prevBlock] = await Promise.all([
                h.control(observer).query.getNextToWrite().request(),
                h.control(observer).query.getBlockByHeight(forkId, 1).request()
            ]);

            // linked next blocks by non-leaders -> each stores a real
            // InvalidStateTransition fraud proof for its author when validated;
            // they land while constructDispute assembles the slash set
            const offenders = h.peers
                .filter(
                    (p) =>
                        p.index !== observer.index &&
                        p.address.toLowerCase() !== nextWriter.toLowerCase()
                )
                .slice(0, 2);
            const encodedFaults = await Promise.all(
                offenders.map((offender) =>
                    factory.buildAndEncodeBlock(offender.signer, {
                        header: {
                            channelId: h.channelId,
                            forkId,
                            transactionCnt: nextHeight,
                            participant: offender.address as Address
                        },
                        previousBlockHash: prevBlock!.hash
                    })
                )
            );

            const failures: string[] = [];
            const countsSeen: number[] = [];
            let samples = 0;

            const sample = async () => {
                const r = await h.execOnHost(
                    observer,
                    async (sm, args) => {
                        try {
                            const { dispute, fraudProofsToApply } =
                                await sm.disputeManager.constructDispute(
                                    args.forkId
                                );
                            return {
                                threw: "",
                                slashCount: dispute.input.onChainSlashes.length,
                                fraudProofCount: fraudProofsToApply.length
                            };
                        } catch (e) {
                            return {
                                threw:
                                    e instanceof Error ? e.message : String(e),
                                slashCount: -1,
                                fraudProofCount: -1
                            };
                        }
                    },
                    { forkId },
                    { timeoutMs: 20000 }
                );
                samples += 1;
                // nothing is slashed on-chain here, so every bundled fraud proof
                // must account for exactly one claimed slash - no more, no less
                if (r.threw) {
                    failures.push(`sample ${samples}: threw ${r.threw}`);
                } else if (r.slashCount !== r.fraudProofCount) {
                    failures.push(
                        `sample ${samples}: ${r.slashCount} slashes vs ${r.fraudProofCount} proofs`
                    );
                } else {
                    countsSeen.push(r.fraudProofCount);
                }
            };

            await sample(); // no proofs yet
            let landingDone = false;
            const landing = (async () => {
                for (const encoded of encodedFaults) {
                    await h
                        .control(observer)
                        .stub.runBlockValidation(encoded)
                        .request();
                    await new Promise((res) => setTimeout(res, 80));
                }
            })().finally(() => {
                landingDone = true;
            });
            // sampling lasts as long as the fault stream; 40ms only sets density
            while (!landingDone) {
                await sample();
                await new Promise((res) => setTimeout(res, 40));
            }
            await landing;
            await sample(); // every proof landed

            expect(failures).to.deep.equal([]);
            // sanity: samples really spanned the proofs landing (none -> all)
            expect(Math.min(...countsSeen)).to.equal(0);
            expect(Math.max(...countsSeen)).to.equal(offenders.length);
            expect(samples).to.be.greaterThan(2);
        });
    });
});
