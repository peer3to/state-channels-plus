import { DisputeFraudProofType } from "@/types/sol-enums";
import { MathTestSession as TestSession } from "@test/harness";
import { TimeoutTooEarlyStruct } from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import { ZeroAddress } from "ethers";
import { scenario } from "@test/harness/scenario";

describe("E2E: dispute validation / disputeInputFields / timeout", function () {
    scenario(
        "dispute.input.timeout.blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState",
        {
            target: "Timeout.blockHeight:mismatch",
            setup: ["calldata:absent", "proof:genesis"]
        },
        async function () {
            const h = TestSession.getHarness();
            // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
            await h.lifecycle.timeoutSetup(3);
            await h.assert.sync.peersInSyncWait();
            h.contextApi.captureOriginalFork();
            h.event.resetEventSpies();

            // Peer 2 submits a timeout dispute with the wrong blockHeight.
            h.tamper.stubConstructDispute(2, async (dispute, sm) => {
                const svc = sm.p2pManager.localRpc.dispute;
                const [hasBlock, latestBlock] =
                    await svc.getLatestBlockFromStateProof(
                        dispute.input.stateProof
                    );
                const expectedHeight = hasBlock
                    ? Number(latestBlock.transaction.header.transactionCnt) + 1
                    : 0;
                dispute.input.timeout.blockHeight = expectedHeight + 1;
            });

            // No action needed — peer 0 never writes, so the timeout fires naturally.
            // Peer 1 will upload a valid timeout dispute; peer 2's dispute is tampered
            // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
            await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutNotLinkedToLatestState,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait({ forkSettleTimeoutMs: 15000 });
        }
    );

    scenario(
        "dispute.input.timeout.participant != next writer → TimeoutParticipantNotNext",
        {
            invariant: "no-honest-loss",
            target: "Timeout.participant:not-next-writer",
            setup: ["calldata:absent", "proof:milestones"]
        },
        async function () {
            const h = TestSession.getHarness();
            // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
            await h.scenario.preDisputeSetup();

            // Peer 0 submits a timeout dispute with the wrong participant.
            h.tamper.stubConstructDispute(
                0,
                (dispute, _sm, args) => {
                    //  blame peer 1
                    dispute.input.timeout.participant =
                        args.blamedAddress as string;
                },
                { args: { blamedAddress: h.getPeer(1).address } }
            );

            // No action needed — peer 2 never writes, so the timeout fires naturally.
            // Peer 1 will upload a valid timeout dispute; peer 0's dispute is tampered
            // and should be killed by peer 1 detecting TimeoutParticipantNotNext.
            await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
                mode: "atLeast"
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutParticipantNotNext,
                timeoutMs: 10000
            });
            await h.dispute.resolveDisputeWait();
        }
    );

    describe("TimeoutTooEarly", function () {
        scenario(
            "dispute.input.timeout posted before wait period elapses → honest peers store TimeoutTooEarly",
            {
                invariant: "attacker-pays",
                target: "Timeout.minTimeStamp:too-early",
                setup: ["calldata:absent", "proof:milestones"]
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();
                // peer 2 is the silent non-writer → exclude from fork-change barrier.
                h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

                await h.tamper.plantFreshTimeoutForNextWriter(0);
                await h.tamper.postTamperedDispute(0, () => {});

                await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                    mode: "atLeast"
                });
                await h.assert.storage.honestPeersStoredDisputeFraudProofDetached(
                    {
                        disputeFraudProofType:
                            DisputeFraudProofType.TimeoutTooEarly,
                        timeoutMs: 10000
                    }
                );

                await h.assert.dispute.slashedOnChain(h.getPeer(0).address);
            }
        );

        scenario(
            "valid timeout dispute → no TimeoutTooEarly fraud proof stored (false-positive guard)",
            {
                invariant: "no-honest-loss",
                target: "Timeout.minTimeStamp:after-wait",
                proof: "TimeoutTooEarly",
                setup: ["calldata:absent", "proof:milestones"]
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();
                // Mark the non-writer up front so honest-peer barriers (committedWait,
                // resolveDisputeWait) exclude peer 2.
                h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

                // Natural timeout: peer 2 never authors.
                await h.assert.dispute.initiatedAndCommitedWait({
                    peersIndices: [0, 1],
                    timeoutMs: 15000
                });

                // No honest peer should fire onDisputeKilled and none
                // should store ANY dispute fraud proof.
                await h.event.waitWhileEventCountsStayAtMost(
                    "onDisputeKilled",
                    [0, 1],
                    { durationMs: 3000, maxCount: 0 }
                );
                for (const peer of [0, 1]) {
                    const proofTypes = await h
                        .control(h.getPeer(peer))
                        .query.getDisputeFraudProofTypes()
                        .request();
                    if (proofTypes.length > 0) {
                        throw new Error(
                            `Peer ${peer} stored ${proofTypes.length} dispute fraud proof(s) on a valid timeout dispute (types: ${proofTypes.join(", ")}) — pipeline false positive`
                        );
                    }
                }

                await h.dispute.resolveDisputeWait({
                    forkSettleTimeoutMs: 15000
                });
            }
        );

        scenario(
            "forged TimeoutTooEarly against a legitimate timeout dispute → proof author slashed",
            {
                invariant: "attacker-pays",
                target: "Timeout.minTimeStamp:after-wait",
                setup: ["calldata:absent", "proof:milestones"]
            },
            async function () {
                const h = TestSession.getHarness();
                await h.scenario.preDisputeSetup();
                // peer 2 does not write, so it will timeout naturally.
                h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

                await h.assert.dispute.initiatedAndCommitedWait({
                    peersIndices: [0, 1],
                    timeoutMs: 15000
                });

                await h.tamper.submitForgedFraudProof(
                    0,
                    DisputeFraudProofType.TimeoutTooEarly,
                    ({ genesisSnapshot }): TimeoutTooEarlyStruct => ({
                        genesisStateSnapshotData: genesisSnapshot.snapshotData,
                        previousBlockOnChainTimestamp: 0
                    })
                );

                await h.assert.dispute.slashedOnChain(h.getPeer(0).address);

                await h.dispute.resolveDisputeWait({
                    forkSettleTimeoutMs: 15000
                });
            }
        );
    });

    scenario(
        "dispute.input.timeout.blockHeight = fully-signed block height; disputer left off-chain → TimeoutThreshold",
        {
            invariant: "no-honest-loss",
            target: "Timeout.blockHeight:finalized-block",
            setup: ["calldata:absent", "proof:genesis"]
        },
        async function () {
            const h = TestSession.getHarness();
            // Leaver disputes without signing post-leave block 1 so validators reach TimeoutThreshold (not DisputeNotLatestState).
            await h.lifecycle.timeoutSetup(4, 0, {
                timeConfig: { agreementTime: 2, evidenceTime: 8 }
            });

            // Skip leave snapshot so peer 0 stays dispute-eligible on-chain.
            await h
                .control(h.getPeer(0))
                .stub.stubPostStateSnapshot()
                .request();

            // Tamper peer 0's scheduled timeout dispute: proof to H-1=0, claim height 1 / block-1 author.
            h.tamper.stubConstructDispute(
                0,
                async (dispute, sm) => {
                    const d = sm.p2pManager.localRpc.dispute;
                    // Read the block-1 author from the proof before truncation.
                    const author = d.blockAuthorAtHeightFromProof(
                        dispute.input.stateProof,
                        1
                    )!;
                    await d.truncateStateProofToHeight(dispute, 0);
                    dispute.input.timeout.blockHeight = 1n;
                    dispute.input.timeout.participant = author;
                },
                { markMalicious: false }
            );

            await h.transition.advanceState({
                txFn: (c) => c.leaveChannel(),
                waitForFinalization: true
            });
            const remaining = [1, 2, 3];
            h.context.leftChannelPeerIndices = [0];

            // Isolate peer 0 so they don't locally sign block 1 (would trip DisputeNotLatestState).
            await h.byzantine.disconnect(0);
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

            await h.transition.advanceState({
                waitForPeers: remaining,
                waitForFinalization: true
            });

            h.contextApi.captureOriginalFork();
            h.event.resetEventSpies();

            // Peer 0 stuck before block 1; background timeout fires → stub tamper → TimeoutThreshold on 1/2/3.
            await h.event.waitForPeers("onDisputeKilled", [1, 2, 3], 1, {
                mode: "atLeast",
                timeoutMs: 15000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType: DisputeFraudProofType.TimeoutThreshold,
                timeoutMs: 10000
            });
            // Dispute path kills tampered claim; slash/eligible-set update still settles fork.
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 20000,
                assertMaliciousRemoved: false
            });
        }
    );

    // what: a timeout dispute at height 3 names the wrong participant (previous-block fields populated).
    scenario(
        "timeout dispute carries previousBlockProducer + participant's signature on previous block; wrong participant → TimeoutParticipantNotNext",
        {
            invariant: "no-honest-loss",
            target: [
                "Timeout.previousBlockProducer:set",
                "Timeout.participantSignatureOnPreviousBlock:present"
            ],
            setup: ["calldata:absent", "proof:milestones"]
        },
        async function () {
            const h = TestSession.getHarness();

            await h.scenario.preDisputeSetup();

            // 2 transitions → peer 2 is next writer; blame peer 1 instead.
            h.tamper.stubConstructDispute(
                0,
                (dispute, _sm, args) => {
                    const {
                        previousBlockProducer,
                        participantSignatureOnPreviousBlock
                    } = dispute.input.timeout;
                    if (String(previousBlockProducer) === args.zeroAddress) {
                        throw new Error(
                            "expected previousBlockProducer set (block-2 author), got ZeroAddress"
                        );
                    }
                    const sig = String(participantSignatureOnPreviousBlock);
                    if (sig === "0x" || sig.length <= 2) {
                        throw new Error(
                            `expected participantSignatureOnPreviousBlock present, got "${sig}"`
                        );
                    }
                    dispute.input.timeout.participant =
                        args.blamedAddress as string;
                },
                {
                    args: {
                        blamedAddress: h.getPeer(1).address,
                        zeroAddress: ZeroAddress
                    }
                }
            );

            await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
                mode: "atLeast"
            });

            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutParticipantNotNext,
                timeoutMs: 10000
            });

            await h.dispute.resolveDisputeWait();
        }
    );

    scenario(
        "dispute.input.timeout.blockHeight = block whose calldata is on-chain; isForced=true → TimeoutCalldataPosted",
        {
            invariant: "no-honest-loss",
            target: [
                "Timeout.isForced:true",
                "Timeout.previousBlockProducerPostedCalldata:true"
            ],
            setup: ["calldata:absent", "proof:genesis"]
        },
        async function () {
            const h = TestSession.getHarness();
            // Peer 0 leaves with snapshot suppressed (stays dispute-eligible).
            //  Peer 3 withholds confirms → incomplete block-1 union → author posts calldata; peers 1/2 set onChainTimestamp.
            // Peer 2 never writes H=2 so a real timeout fires; tamper reframes peer 0's dispute (truncate proof, blame peer 1 @ H=1, isForced past calldata upload guard).
            await h.lifecycle.timeoutSetup(4, 0, {
                timeConfig: { agreementTime: 2, evidenceTime: 12 }
            });

            await h
                .control(h.getPeer(0))
                .stub.stubPostStateSnapshot()
                .request();

            // Falsely blame peer 1 @ H=1 (that block exists + calldata on-chain), truncate proof, isForced clears upload guard.
            h.tamper.stubConstructDispute(
                0,
                async (dispute, sm) => {
                    const d = sm.p2pManager.localRpc.dispute;
                    // Read the block-1 author from the proof before truncation.
                    const author = d.blockAuthorAtHeightFromProof(
                        dispute.input.stateProof,
                        1
                    )!;
                    await d.truncateStateProofToHeight(dispute, 0);
                    dispute.input.timeout.blockHeight = 1n;
                    dispute.input.timeout.participant = author;
                    dispute.input.timeout.isForced = true;
                },
                { markMalicious: false }
            );

            await h.transition.advanceState({
                txFn: (c) => c.leaveChannel(),
                waitForFinalization: true
            });
            h.context.leftChannelPeerIndices = [0];
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 0 });

            // Peer 3 withholds confirms → incomplete union → author posts calldata.
            h.byzantine.stubBroadcast(3);

            // peer1 write the next block
            await h.transition.advanceState({
                count: 1,
                waitForPeers: [1, 2, 3],
                waitForFinalization: false
            });

            // peer1 posts calldata
            await h.event.waitForPeers("onBlockCalldataPosted", [1, 2], 1, {
                mode: "atLeast",
                timeoutMs: 15000
            });

            h.contextApi.captureOriginalFork();
            h.event.resetEventSpies();
            //  peer 2 never writes, so the timeout fires naturally.

            // peer 1 and 2 kill the tampered dispute by peer 0
            await h.event.waitForPeers("onDisputeKilled", [1, 2], 1, {
                mode: "atLeast",
                timeoutMs: 25000
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.TimeoutCalldataPosted,
                peerIndices: [1, 2],
                timeoutMs: 15000
            });
            await h.dispute.resolveDisputeWait({
                forkSettleTimeoutMs: 25000,
                assertMaliciousRemoved: false
            });
        }
    );
});
