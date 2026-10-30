import { timeoutWaitTime } from "@/types";
import { DisputeFraudProofType } from "@/types/sol-enums";
import { Codec, Type, hash, sleep, tryDecodeCustomError } from "@/utils";
import {
    expectTimeoutOfCalldataPostedBlockKilled,
    postTimeoutOfCalldataPostedBlock
} from "@test/fixtures/DisputeAuditStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";
import { waitFor } from "@test/utils/waitFor";
import {
    TimeoutCalldataPostedStruct,
    TimeoutTooEarlyStruct
} from "@typechain-types/contracts/V1/types/DisputeFraudProofTypes";
import { expect } from "chai";
import { AbiCoder } from "ethers";

// Invalid-dispute scenarios require upload -> audit -> kill to fit inside the
// evidence window. With one-second interval mining, the three-second minimum
// has no scheduling margin for those two sequential on-chain transactions,
// and on a loaded farm the event delivery plus the audit's chain reads alone
// have taken five seconds, so the window keeps a few seconds of headroom.
const INVALID_DISPUTE_EVIDENCE_TIME = 8;

describe("E2E: dispute validation / disputeInputFields / timeout", function () {
    it("dispute.input.timeout.blockHeight != stateProof.latest + 1 → TimeoutNotLinkedToLatestState", async function () {
        const h = TestSession.getHarness();
        // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
        await h.lifecycle.timeoutSetup(3, 0, {
            timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
        });
        await h.assert.sync.peersInSyncWait();
        h.contextApi.captureOriginalFork();
        h.event.resetEventSpies();

        // Peer 2 submits a timeout dispute with the wrong blockHeight.
        await h.tamper.stubConstructDispute(2, async (dispute, sm) => {
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
            mode: "atLeast",
            timeoutMs: h.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            })
        });
        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.TimeoutNotLinkedToLatestState
        });
        await h.dispute.resolveDisputeWait({
            forkId: h.context.originalForkId!
        });
    });

    it("dispute.input.timeout.participant != next writer → TimeoutParticipantNotNext", async function () {
        const h = TestSession.getHarness();
        // 0 transitions → peer 0 is next to write but never does → peers 1 & 2 detect timeout.
        await h.scenario.preDisputeSetup({
            timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
        });
        const forkId = h.activeForkId!;

        // Peer 0 submits a timeout dispute with the wrong participant.
        await h.tamper.stubConstructDispute(
            0,
            (dispute, _sm, args) => {
                // A dispute built to answer another peer's commit before this
                // peer recorded its own timeout carries an empty timeout;
                // naming a participant there is killed for linkage, not for
                // the participant. Tamper only a real timeout.
                if (
                    dispute.input.timeout.participant ===
                    "0x0000000000000000000000000000000000000000"
                ) {
                    return;
                }
                //  blame peer 1
                dispute.input.timeout.participant =
                    args.blamedAddress as string;
            },
            { args: { blamedAddress: h.getPeer(1).address } }
        );

        // No action needed — peer 2 never writes, so the timeout fires naturally.
        // Peer 1 will upload a valid timeout dispute; peer 0's dispute is tampered
        // and should be killed by peer 1 detecting TimeoutNotLinkedToLatestState.
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast",
            timeoutMs: h.event.protocolEventTimeoutMs({
                withFirstBlockGrace: true
            })
        });

        await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
            disputeFraudProofType:
                DisputeFraudProofType.TimeoutParticipantNotNext
        });
        await h.dispute.resolveDisputeWait({ forkId });
    });

    describe("TimeoutTooEarly", function () {
        it("existing window predates timeout deadline → upload reverts with race-condition guard", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
            });
            const forkId = h.activeForkId!;
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });

            // The opener needs its own reason before a dispute window exists.
            await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
            await h.tamper.postTamperedDispute(0, () => {}, {
                markMalicious: false
            });
            await h.assert.dispute.committedWait({
                peersIndices: [0],
                expectedCount: 1
            });

            const windowCreationTimestamp =
                await h.channelManager.getDisputeWindowCreationTimestamp(
                    h.channelId,
                    h.activeForkId!
                );
            await h.tamper.plantFreshTimeoutForNextWriter(1);

            try {
                await h.tamper.postTamperedDispute(
                    1,
                    (dispute) => {
                        dispute.input.timeout.minTimeStamp =
                            windowCreationTimestamp + 1n;
                    },
                    { markMalicious: false }
                );
                throw new Error("expected timeout dispute upload to revert");
            } catch (error: unknown) {
                const customError = tryDecodeCustomError(error);
                if (!customError) throw error;
                if (
                    customError.name !==
                    "RaceConditionDisputeTimeoutWindowCreatedTooEarly"
                ) {
                    throw error;
                }
            }
        });

        it("dispute.input.timeout posted before wait period elapses → honest peers store TimeoutTooEarly", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup({
                timeConfig: { evidenceTime: INVALID_DISPUTE_EVIDENCE_TIME }
            });
            const forkId = h.activeForkId!;
            // peer 2 is the silent non-writer → exclude from fork-change barrier.
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });

            await h.tamper.plantFreshTimeoutForNextWriter(0);
            await h.tamper.postTamperedDispute(0, (dispute) => {
                // This case tests the timeout predicate and its on-chain fraud
                // proof. Post the already-constructed auditing data so the
                // test does not also race the optional reconstruction path.
                dispute.postedAuditingData = true;
            });
            const maliciousAfterAction = [...h.context.maliciousPeerIndices];
            if (
                maliciousAfterAction.length !== 1 ||
                maliciousAfterAction[0] !== 0
            ) {
                throw new Error(
                    "Tampered dispute author was not classified malicious"
                );
            }

            await h.event.waitForPeers("onDisputeKilled", [1], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType: DisputeFraudProofType.TimeoutTooEarly
            });

            await h.assert.dispute.slashedOnChain(h.getPeer(0).address);
            await h.dispute.resolveDisputeWait({ forkId });
        });

        it("valid timeout dispute → no TimeoutTooEarly fraud proof stored (false-positive guard)", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // Mark the non-writer up front so honest-peer barriers (committedWait,
            // resolveDisputeWait) exclude peer 2.
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });
            const originalForkId = h.activeForkId!;

            // Natural timeout: peer 2 never authors.
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 1]
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

            await h.dispute.resolveDisputeWait({ forkId: originalForkId });
        });

        it("forged TimeoutTooEarly against a legitimate timeout dispute → proof author slashed", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetup();
            // peer 2 does not write, so it will timeout naturally.
            h.contextApi.markAfkPeer({ afkPeerIndex: 2 });
            const forkId = h.activeForkId!;

            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0, 1]
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

            await h.dispute.resolveDisputeWait({ forkId });
        });
    });

    it("leaver does not dispute a timeout after leaving the channel", async function () {
        const h = TestSession.getHarness();
        // peer 0 leaves the channel but stays on-chain (leave snapshot suppressed),
        // then is isolated. with no p2p blocks it sees a phantom timeout for the
        // next writer -> but it's no longer an off-chain participant, so it must
        // NOT dispute.
        await h.lifecycle.timeoutSetup(4, 0, {
            timeConfig: { agreementTime: 2, evidenceTime: 8 }
        });

        // Skip leave snapshot so peer 0 stays dispute-eligible on-chain.
        await h.control(h.getPeer(0)).stub.stubPostStateSnapshot().request();
        //  peer 0 is leaving (off chain)
        await h.transition.advanceState({
            txFn: (c) => c.leaveChannel(),
            waitForFinalization: true
        });
        const remaining = [1, 2, 3];
        h.context.leftChannelPeerIndices = [0];

        // isolate peer 0 so it stops receiving p2p blocks -> its timeout timer
        // for the next block fires naturally.
        await h.byzantine.blacklistAndDisconnect(0);
        h.contextApi.markAfkPeer({ afkPeerIndex: 0 });

        // remaining peers advance past peer 0.
        await h.transition.advanceState({
            waitForPeers: remaining,
            waitForFinalization: true
        });

        await h.event.waitWhileEventCountsStayAtMost(
            "onInitiatingDispute",
            [0],
            {
                durationMs: 8000,
                maxCount: 0
            }
        );
    });

    it("dispute.input.timeout.blockHeight = block whose calldata is on-chain; isForced=true → TimeoutCalldataPosted", async function () {
        const h = TestSession.getHarness();
        const staged = await postTimeoutOfCalldataPostedBlock(h, {
            blocksBefore: 2
        });
        await expectTimeoutOfCalldataPostedBlockKilled(h, staged);
    });

    it("an honest first block posted as calldata refutes the forced timeout of its author → TimeoutCalldataPosted kills the dispute", async function () {
        const h = TestSession.getHarness();
        const staged = await postTimeoutOfCalldataPostedBlock(h, {
            blocksBefore: 0
        });
        // premise: the posted block is the fork's first block
        expect(
            Number(staged.postedBlock.transaction.header.transactionCnt)
        ).to.equal(0);
        await expectTimeoutOfCalldataPostedBlockKilled(h, staged);
    });

    it("an honest block carrying an inbound top-up posted as calldata refutes the forced timeout of its author → TimeoutCalldataPosted kills the dispute", async function () {
        const h = TestSession.getHarness();
        const staged = await postTimeoutOfCalldataPostedBlock(h, {
            blocksBefore: 2,
            beforeCalldataBlock: async () => {
                await h.join.forceInboundJoinWait({
                    participant: h.getPeer(0).address
                });
            }
        });
        // premise: the posted block consumes the inbound top-up
        expect(staged.postedBlock.messageBlocks.length).to.be.greaterThan(0);
        await expectTimeoutOfCalldataPostedBlockKilled(h, staged);
    });

    it("bad-signature posted calldata cannot refute an honest forced timeout", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.timeoutSetup(4, 0);

        // Establish height 1 so the calldata block does not receive first-block grace.
        await h.transition.advanceState({ count: 2 });

        // Peer 3 cannot see the next block, so the author must post it as calldata.
        await Promise.all(
            [0, 1, 2, 3].map((peerIndex) =>
                h.rpcStub.suppressTimeoutCheck(peerIndex)
            )
        );
        await h.network.blacklistAndDisconnectPeer(3);

        // A real linked writer block with the successful transition's next
        // snapshot, authored off-wire so only the writer holds it.
        const {
            leader: writer,
            authored,
            startHeight,
            forkId
        } = await h.transition.authorNextBlockOffWireWait();
        const timeoutHeight = Number(startHeight);
        expect([0, 1, 2]).to.include(writer.index);
        const validSignedBlock = Codec.decode(
            authored.encodedSignedBlock,
            Type.SignedBlock
        );

        // Corrupt only the signature before posting; the commitment still
        // binds the exact posted bytes.
        const badSignature = `0x${"00".repeat(65)}`;
        const postedSignedBlock = {
            ...validSignedBlock,
            signature: badSignature
        };
        const { blockNumber, onChainTimestamp } =
            await h.transition.postBlockCalldataOnChainWait(
                writer,
                Codec.encode(postedSignedBlock, Type.SignedBlock) as string
            );
        const previousBlock = await h
            .control(h.getPeer(1))
            .query.getBlockByHeight(forkId, timeoutHeight - 1)
            .request();
        if (!previousBlock) throw new Error("previous block not found");
        const wait = timeoutWaitTime(resolveTestTimeConfig(), timeoutHeight);
        // The refutation deadline when the predecessor has no posted calldata
        // and the height is not 0: a late post would fail the refutation on
        // timing, not on the signature.
        expect(Number(onChainTimestamp)).to.be.at.most(
            previousBlock.timestamp + wait
        );

        // The on-chain commitment matches the exact posted payload.
        const calldataPostedTopic = h.channelManager.interface.getEvent(
            "BlockCalldataPosted"
        )!.topicHash;
        const blockLogs = await h.provider.getLogs({
            fromBlock: blockNumber,
            toBlock: blockNumber,
            topics: [calldataPostedTopic]
        });
        const postedLog = blockLogs
            .map((log) => h.channelManager.interface.parseLog(log))
            .find(
                (event) =>
                    event?.name === "BlockCalldataPosted" &&
                    event.args.channelId === h.channelId
            );
        if (!postedLog) throw new Error("BlockCalldataPosted log not found");
        expect(postedLog.args.sender).to.equal(writer.address);
        expect(postedLog.args.signedBlock.encodedBlock).to.equal(
            postedSignedBlock.encodedBlock
        );
        expect(postedLog.args.signedBlock.signature).to.equal(badSignature);
        expect(Number(postedLog.args.timestamp)).to.equal(
            Number(onChainTimestamp)
        );
        expect(postedLog.args.commitmentHash).to.equal(
            hash(
                AbiCoder.defaultAbiCoder().encode(
                    ["tuple(bytes encodedBlock, bytes signature)", "uint256"],
                    [
                        [
                            postedSignedBlock.encodedBlock,
                            postedSignedBlock.signature
                        ],
                        onChainTimestamp
                    ]
                )
            )
        );

        // Every connected peer observes the posted (bad-signature) calldata.
        await h.event.waitForPeers("onBlockCalldataPosted", [0, 1, 2], 1, {
            mode: "atLeast"
        });

        // Peer 3 honestly times out the writer it cannot see; the forced
        // dispute names that writer and height.
        await h.tamper.plantFreshTimeoutForParticipant(3, writer.address);
        await h.event.waitUntilTimestamp(
            Math.max(
                previousBlock.timestamp,
                previousBlock.onChainTimestamp ?? previousBlock.timestamp
            ) +
                wait +
                1
        );
        await sleep(h.event.evidencePeriodWaitMs());

        h.contextApi.captureOriginalFork();
        h.event.resetEventSpies();
        const { dispute } = await h.tamper.postTamperedDispute(3, (dispute) => {
            dispute.input.timeout.isForced = true;
        });
        expect(Number(dispute.input.timeout.blockHeight)).to.equal(
            timeoutHeight
        );
        expect(dispute.input.timeout.participant).to.equal(writer.address);

        await h.assert.dispute.committedWait({
            peersIndices: [3],
            expectedCount: 1
        });
        const disputeHash = hash(Codec.encode(dispute, Type.Dispute));
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            dispute.input.forkId
        );
        expect(commitments, "dispute stays committed").to.include(disputeHash);

        // The writer's TimeoutCalldataPosted refutation over the exact posted
        // bytes: the dispute's latest snapshot, that snapshot's machine state,
        // and the posted commitment's timestamp.
        const { encodedAuditingData } = await h
            .control(writer)
            .dispute.buildOwnAuditingData(forkId, timeoutHeight - 1)
            .request();
        const latestStateSnapshot = Codec.decode(
            encodedAuditingData,
            Type.DisputeAuditingData
        ).latestStateSnapshot;
        expect(
            hash(Codec.encode(latestStateSnapshot, Type.StateSnapshot))
        ).to.equal(dispute.input.latestStateSnapshotHash);
        const machineState = await h
            .control(writer)
            .query.getStateMachineState(
                latestStateSnapshot.snapshotData.stateMachineStateHash
            )
            .request();
        if (!machineState) throw new Error("latest machine state not held");
        expect(hash(machineState)).to.equal(
            latestStateSnapshot.snapshotData.stateMachineStateHash
        );

        // The posted block's author submits the refutation.
        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: writer.index });
        await h.tamper.submitForgedFraudProof(
            3,
            DisputeFraudProofType.TimeoutCalldataPosted,
            ({ genesisSnapshot }): TimeoutCalldataPostedStruct => ({
                genesisStateSnapshotData: genesisSnapshot.snapshotData,
                latestStateSnapshot,
                latestStateStateMachineState: machineState,
                postedBlock: postedSignedBlock,
                onChainTimestamp: BigInt(onChainTimestamp),
                previousBlockOnChainTimestamp: 0,
                previousBlockcalldata: validSignedBlock
            }),
            { dispute, submitter: writer.p2pInstance.chainSigner }
        );

        // A rejected refutation keeps the timeout committed, keeps the forcer
        // standing, and slashes the refutation's submitter.
        const after = await h.channelManager.getWindowCommitments(
            h.channelId,
            dispute.input.forkId
        );
        expect(after, "dispute stays committed").to.include(disputeHash);
        expect(after, "no commitment removed").to.include.members(commitments);
        const slashed = await h.channelManager.getOnChainSlashedParticipants(
            h.channelId
        );
        expect(slashed).to.include(writer.address);
        expect(slashed).to.not.include(h.getPeer(3).address);

        // No peer kills anything over the bad-signature calldata, and none
        // stores a dispute fraud proof for it.
        await h.event.waitWhileEventCountsStayAtMost(
            "onDisputeKilled",
            [0, 1, 2],
            { durationMs: 3000, maxCount: 0 }
        );
        for (const peerIndex of [0, 1, 2]) {
            const proofTypes = await h
                .control(h.getPeer(peerIndex))
                .query.getDisputeFraudProofTypes()
                .request();
            expect(
                proofTypes,
                `peer ${peerIndex} stored no dispute fraud proof`
            ).to.have.length(0);
        }

        // The standing forced timeout resolves with the forcer retained and
        // the failed refutation's author gone.
        const resolved = await h.dispute.resolveDisputeWait({
            forkId: h.context.originalForkId!,
            assertMaliciousRemoved: false
        });
        await waitFor(async () => {
            const participants = await h
                .control(resolved.honestPeers[0]!)
                .query.getParticipants()
                .request();
            return (
                participants.includes(h.getPeer(3).address) &&
                !participants.includes(writer.address)
            );
        }, h.event.protocolEventTimeoutMs());
        const slashedAfter =
            await h.channelManager.getOnChainSlashedParticipants(h.channelId);
        expect(slashedAfter).to.not.include(h.getPeer(3).address);
    });
});
