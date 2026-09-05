import { DisputeFraudProofType } from "@/types/sol-enums";
import Clock from "@/Clock";
import { Codec, Type } from "@/utils";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: dispute validation / stateProof / milestone block content integrity", function () {
    describe("stateProof.milestones[-1].blockConfirmations[-1].header.transactionCnt", function () {
        it("transactionCnt += 5 → DisputeInvalidBlockStructure", async function () {
            const h = TestSession.getHarness();
            // Auditing and submitting the structural fraud proof must fit
            // inside the staging's kill period even when the shared chain
            // mines transactions from several peers between those two steps.
            await h.scenario.preDisputeSetup({ peerCount: 5 });
            await h.byzantine.blacklistAndDisconnect(3);
            // The disconnected peer learns of the window late and would
            // upload its own dispute after the evidence period, which the
            // chain refuses; its dispute is not part of the case.
            await h
                .control(h.getPeer(3))
                .stub.stubSuppressDisputeInitiation()
                .request();
            await h.transition.advanceState({ waitForPeers: [0, 1, 2, 4] });
            const disputedForkId = h.activeForkId;
            if (!disputedForkId) throw new Error("Expected an active fork");
            h.event.resetEventSpies();

            // The tamper below re-signs peer 2's milestone block with peer 2's
            // harness key, so peer 2 is colluding even though peer 0 submits it.
            h.contextApi.markMaliciousPeer({ maliciousPeerIndex: 2 });

            await h.tamper.stubConstructDispute(0, async (dispute, sm) => {
                const svc = sm.p2pManager.localRpc.dispute;
                await svc.rewriteLastMilestoneBlockConfirmationInDispute(
                    dispute,
                    (block) => {
                        block.transaction.header.transactionCnt =
                            BigInt(block.transaction.header.transactionCnt) +
                            5n;
                        return block;
                    }
                );
            });

            await h.byzantine.submitInvalidStateTransitionBlock(1);
            await h.assert.dispute.initiatedAndCommitedWait({
                peersIndices: [0],
                initiatedWithAuditingData: false
            });

            await h.event.waitForAllPeers("onDisputeKilled", 1, {
                mode: "atLeast"
            });
            await h.assert.dispute.slashedOnChain(h.getPeer(0).address);
            await h.tamper.restoreConstructDispute(0);

            await h.assert.dispute.committedWait({
                expectedCount: 2,
                mode: "atLeast"
            });
            expect(
                await h.channelManager.getWindowCommitments(
                    h.channelId,
                    disputedForkId
                )
            ).to.not.have.length(0);
            await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockStructure
            });

            for (const peer of h.getHonestPeers()) {
                const finalCommit = peer.eventSpies.onDisputeCommitted
                    ?.getCalls()
                    .find((call) => call.args[3] === true);
                expect(
                    finalCommit,
                    `Peer ${peer.index} should not observe a final dispute`
                ).to.be.undefined;
            }

            // This test verifies the dispute's malformed block structure. It
            // deliberately does not assert which later dispute applies the
            // underlying block fraud proof or which participants are slashed.
            await h.dispute.resolveDisputeWait({
                forkId: disputedForkId,
                assertMaliciousRemoved: false
            });
        });
    });

    describe("posted auditing data", function () {
        it("still replays a structurally clean invalid-STF tail", async function () {
            const h = TestSession.getHarness();
            await h.scenario.preDisputeSetupCalldataPath();
            const forkId = h.activeForkId!;

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const svc = sm.p2pManager.localRpc.dispute;
                const confirmations =
                    dispute.input.stateProof.milestones.at(
                        -1
                    )?.blockConfirmations;
                if (!confirmations || confirmations.length === 0) {
                    throw new Error("Expected a milestone anchor");
                }
                const previous = confirmations.at(-1)!;
                const previousHash = svc.hash(
                    previous.signedBlock.encodedBlock
                );
                await svc.appendLastMilestoneSignedBlockInDispute(
                    dispute,
                    (block) => {
                        block.transaction.header.transactionCnt =
                            BigInt(block.transaction.header.transactionCnt) +
                            1n;
                        block.transaction.header.timestamp =
                            BigInt(block.transaction.header.timestamp) + 1n;
                        block.transaction.body.data = "0x";
                        block.previousBlockHash = previousHash;
                        return block;
                    }
                );
            });

            await h.byzantine.submitDoubleSignBlock(1);
            await h.assert.dispute.initiatedWait({
                peersIndices: [3],
                initiatedWithAuditingData: true
            });
            await h.event.waitForPeers("onDisputeKilled", [0], 1, {
                mode: "atLeast"
            });
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
            await h.dispute.resolveDisputeWait({
                forkId,
                syntheticOnChainParticipants: 1
            });
        });

        it("recovers missed block calldata during replay before killing the dispute", async function () {
            const h = TestSession.getHarness();
            // The staging issues several control calls between the author's
            // turn and its block; on a loaded host they can outlast the
            // subjective window, and a block stamped back into its slot then
            // parks on every peer until a writer timeout follows. The larger
            // agreement window keeps the staged block inside it.
            await h.scenario.preDisputeSetupCalldataPath({
                timeConfig: { evidenceTime: 8, agreementTime: 8 }
            });
            const p2pTime = h.options.timeConfig?.p2pTime;
            if (p2pTime === undefined) {
                throw new Error("Expected a configured p2p time");
            }

            // Keep the next block off-chain until we post it explicitly, then
            // make peer 0 miss that event so dispute replay must recover it.
            await Promise.all(
                h.peers.map((peer) =>
                    h
                        .control(peer)
                        .stub.stubSuppressMaybePostBlockOnChain()
                        .request()
                )
            );
            const auditor = h.getPeer(0);
            const authorAddress = await h
                .control(auditor)
                .query.getNextToWrite()
                .request();
            const author = h.peers.find(
                (peer) => peer.address === authorAddress
            );
            if (!author) throw new Error("Expected the block author peer");
            const silentConfirmers = h.peers.filter(
                (peer) => peer.index !== author.index
            );
            await Promise.all(
                silentConfirmers.map((peer) =>
                    h.control(peer).stub.stubBroadcast().request()
                )
            );
            await h.transition.advanceState({ waitForFinalization: false });
            await Promise.all(
                silentConfirmers.map((peer) =>
                    h.control(peer).stub.restoreBroadcast().request()
                )
            );

            const forkId = h.activeForkId;
            if (!forkId) throw new Error("Expected an active fork");
            const postedBlock = await h
                .control(auditor)
                .query.getLatestBlockBundle(forkId)
                .request();
            if (!postedBlock) throw new Error("Expected a block to post");
            expect(postedBlock.onChainTimestamp).to.be.null;
            const nextAuthorAddress = await h
                .control(auditor)
                .query.getNextToWrite()
                .request();
            if (
                postedBlock.confirmationSignerAddresses.includes(
                    nextAuthorAddress
                )
            ) {
                throw new Error("Next author unexpectedly signed the parent");
            }

            await h
                .control(auditor)
                .stub.stubHoldCalldataPostedEvents()
                .request();
            await h.event.waitUntilTimestamp(
                postedBlock.timestamp + p2pTime + 1
            );
            const tx =
                await author.p2pInstance.stateChannelManagerContract.postBlockCalldata(
                    Codec.decode(
                        postedBlock.encodedSignedBlock,
                        Type.SignedBlock
                    ),
                    Clock.getTimeInSeconds() + 1000
                );
            const receipt = await tx.wait();
            const minedBlock = await h.provider.getBlock(receipt!.blockNumber);
            if (!minedBlock) throw new Error("Expected calldata receipt block");
            await h
                .control(auditor)
                .stub.waitForHeldCalldataPostedEvent()
                .request();
            await h.event.waitForPeers("onBlockCalldataPosted", [1, 2, 3], 1, {
                mode: "atLeast"
            });
            expect(
                (
                    await h
                        .control(auditor)
                        .query.getBlockByHash(postedBlock.hash)
                        .request()
                )?.onChainTimestamp
            ).to.be.null;
            await h
                .control(auditor)
                .stub.restoreCalldataPostedEvents()
                .request();

            await h.tamper.stubConstructDispute(3, async (dispute, sm) => {
                const svc = sm.p2pManager.localRpc.dispute;
                const confirmations =
                    dispute.input.stateProof.milestones.at(
                        -1
                    )?.blockConfirmations;
                if (!confirmations || confirmations.length < 2) {
                    throw new Error(
                        "Expected a replayable block after the milestone anchor"
                    );
                }
                const previous = confirmations.at(-1)!;
                const nextAuthor =
                    await sm.diamondStateMachine.getNextToWrite();
                const previousHash = svc.hash(
                    previous.signedBlock.encodedBlock
                );
                await svc.appendLastMilestoneSignedBlockInDispute(
                    dispute,
                    (block) => {
                        block.transaction.header.transactionCnt =
                            BigInt(block.transaction.header.transactionCnt) +
                            1n;
                        block.transaction.header.participant = nextAuthor;
                        block.transaction.header.timestamp =
                            BigInt(block.transaction.header.timestamp) +
                            BigInt(sm.timeConfig.p2pTime + 1);
                        block.transaction.body.data = "0x";
                        block.previousBlockHash = previousHash;
                        return block;
                    }
                );
            });

            // Only the auditor kills: every other peer saw the calldata event
            // live and would kill first (the double-signer's runtime audits
            // like any other), and a kill observed on-chain before the
            // auditor's own replay finished would end the wait below with
            // the recovery still in flight.
            const otherKills = await Promise.all(
                h.peers
                    .filter((peer) => peer.index !== auditor.index)
                    .map((peer) => h.rpcStub.suppressDisputeKill(peer.index))
            );
            try {
                await h.byzantine.submitDoubleSignBlock(1);
                await h.event.waitForPeers(
                    "onDisputeKilled",
                    [auditor.index],
                    1,
                    {
                        mode: "atLeast",
                        timeoutMs: h.event.protocolEventTimeoutMs()
                    }
                );
            } finally {
                await Promise.all(otherKills.map((kill) => kill.restore()));
            }

            // Peer 0 could only acquire this timestamp by recovering the
            // historical calldata event from inside block replay.
            expect(
                (
                    await h
                        .control(auditor)
                        .query.getBlockByHash(postedBlock.hash)
                        .request()
                )?.onChainTimestamp
            ).to.equal(Number(minedBlock.timestamp));
            await h.assert.storage.honestPeersStoredDisputeFraudProofDetached({
                disputeFraudProofType:
                    DisputeFraudProofType.DisputeInvalidBlockInStateProofApplyFraudProof
            });
        });
    });
});
