import Block from "@/models/Block";
import StateSnapshot from "@/models/StateSnapshot";
import {
    DisputeFraudProofType,
    toSolidityDisputeFraudProofType
} from "@/types/sol-enums";
import type { Hash } from "@/types/types";
import { Codec, hash, Type } from "@/utils";
import { chainAcceptsDisputeProof } from "@test/fixtures/ChainProofVerdict";
import { uploadSelfRemovalDispute } from "@test/fixtures/ChallengeBoundaryStaging";
import { committedDisputeLogs } from "@test/fixtures/DisputeWindowWorkflowStaging";
import {
    forgeSideChainFinalProof,
    postJoinerBypassDispute,
    readChainReductionWait,
    readDisputeKill,
    readMathState,
    readStoredSnapshot,
    stageSeatedJoinerHistory
} from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import type { DisputeAuditingDataStruct } from "@typechain-types/contracts/V1/types/DisputeTypes";
import { expect } from "chai";
import { ethers } from "ethers";

// Alice and Bob post the chain anchor; Charlie joins,
// the honest history consumes his JOIN and is final past it with his
// signature. Alice then posts a dispute whose only hop jumps from the anchor
// above Charlie's final point, signed by Alice and Bob only, with an inbound
// head below Charlie's JOIN: its walk never needs Charlie.

describe("E2E: dispute validation / dispute final point regression", function () {
    it("the colluders' posted-data dispute that hops from the chain anchor above seated Charlie's final point without his JOIN is killed on chain by Charlie's DisputeFinalPointRegression, and only its submitter is slashed", async function () {
        const h = TestSession.getHarness();
        const history = await stageSeatedJoinerHistory(h);
        const alice = h.getPeer(history.aliceIndex);
        const bob = h.getPeer(history.bobIndex);
        const charlie = h.getPeer(history.charlieIndex);
        const joinHash = history.charlieFinal.latestInboundMessageBlockHash;
        expect(
            history.charlieFinal.snapshotData.participants,
            "Charlie is seated in his final history"
        ).to.include(charlie.address);
        expect(
            history.anchor.latestInboundMessageBlockHash,
            "the chain anchor is below Charlie's JOIN"
        ).to.not.equal(joinHash);

        const posted = await postJoinerBypassDispute(h, history);
        expect(posted.dispute.postedAuditingData).to.equal(true);
        expect(
            posted.dispute.input.latestInboundMessageBlockHash,
            "the upload names Charlie's JOIN as the chain inbound head"
        ).to.equal(joinHash);
        expect(posted.hopBlock.height).to.be.greaterThan(
            history.charlieFinal.blockHeight
        );
        expect(
            [...posted.hopBlock.allSignerAddresses],
            "the hop is signed without Charlie"
        ).to.have.members([alice.address, bob.address]);
        expect(
            posted.hopSnapshot.latestInboundMessageBlockHash,
            "the hop's inbound head stays the anchor's"
        ).to.equal(history.anchor.latestInboundMessageBlockHash);
        expect(
            await chainAcceptsDisputeProof(
                h.channelManager,
                posted.dispute,
                posted.auditingData
            ),
            "the chain walks the hop from the anchor without Charlie"
        ).to.equal(true);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeFinalPointRegression,
            peerIndices: [charlie.index]
        });
        expect(
            await h.control(charlie).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([
            String(
                toSolidityDisputeFraudProofType(
                    DisputeFraudProofType.DisputeFinalPointRegression
                )
            )
        ]);
        await h.event.waitForPeers("onDisputeKilled", [charlie.index], 1, {
            mode: "atLeast"
        });

        const kill = await readDisputeKill(h, alice.address);
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeFinalPointRegression
        ]);
        const counter = Codec.decode(
            kill.appliedEncodedProofs[0]!,
            DisputeFraudProofType.DisputeFinalPointRegression
        );
        expect(
            hash(
                Codec.encode(
                    counter.latestFinalizedSnapshot,
                    Type.StateSnapshot
                )
            ),
            "G is the hop's snapshot"
        ).to.equal(posted.hopSnapshot.hash);
        const final = await h.channelManager.verifyMilestones.staticCall(
            counter.finalProof
        );
        expect(
            final.finalizedSnapshot.snapshotData.latestInboundMessageBlockHash,
            "F is a final point of Charlie's history, past his JOIN"
        ).to.equal(joinHash);
        await h.assert.dispute.slashedOnChainExactly([alice.address]);
    });

    it("the colluders' bypass dispute and Charlie's honest dispute share one window: Charlie kills the bypass, and after the window expires the reduction continues Charlie's history on the successor fork, with only Alice slashed", async function () {
        const h = TestSession.getHarness();
        const history = await stageSeatedJoinerHistory(h);
        const alice = h.getPeer(history.aliceIndex);
        const charlie = h.getPeer(history.charlieIndex);
        const posted = await postJoinerBypassDispute(h, history);
        const bypassState = await readMathState(
            h,
            alice.index,
            posted.hopSnapshot
        );

        await h.event.waitForPeers("onDisputeKilled", [charlie.index], 1, {
            mode: "atLeast"
        });
        const kill = await readDisputeKill(h, alice.address);
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeFinalPointRegression
        ]);
        // Charlie's kill lands with his own dispute in the same window
        await h.assert.dispute.committedWait({
            peersIndices: [charlie.index],
            expectedCount: 2
        });
        const windowDisputes = (await committedDisputeLogs(h)).filter(
            (log) => log.forkId === history.forkId
        );
        expect(
            windowDisputes.map((log) => log.disputer),
            "both disputes were committed in the window"
        ).to.have.members([alice.address, charlie.address]);
        const charliesCommitment = windowDisputes.find(
            (log) => log.disputer === charlie.address
        )!.commitment;
        expect(
            await h.channelManager.getWindowCommitments(
                h.channelId,
                history.forkId
            ),
            "only Charlie's dispute is left to reduce"
        ).to.deep.equal([charliesCommitment]);
        const charliesDispute = await h
            .control(charlie)
            .query.getDispute(charliesCommitment)
            .request();
        if (!charliesDispute) throw new Error("Charlie lacks his dispute");
        const charliesLatest = await readStoredSnapshot(
            h,
            charlie.index,
            Codec.decode(charliesDispute.encodedDispute, Type.Dispute).input
                .latestStateSnapshotHash as Hash
        );
        const charliesState = await readMathState(
            h,
            charlie.index,
            charliesLatest
        );
        expect(
            charliesState.number,
            "premise: Charlie's history moved past the bypass hop's anchor state"
        ).to.not.equal(bypassState.number);

        await h.assert.dispute.reductionCompletedWait({
            sourceForkId: history.forkId,
            peerIndices: [charlie.index]
        });

        const successorForkId = await h
            .control(charlie)
            .query.getCompletedReductionForkId(history.forkId)
            .request();
        expect(successorForkId).to.not.equal(null);
        expect(
            await readChainReductionWait(h, history.forkId),
            "the chain reduced to Charlie's successor fork"
        ).to.equal(successorForkId);
        const genesisHash = await h
            .control(charlie)
            .query.getGenesisSnapshotHash(successorForkId!)
            .request();
        if (!genesisHash)
            throw new Error("Charlie lacks the successor genesis");
        const successorState = await readMathState(
            h,
            charlie.index,
            await readStoredSnapshot(h, charlie.index, genesisHash)
        );
        expect(
            successorState.number,
            "the successor fork continues Charlie's latest state"
        ).to.equal(charliesState.number);
        const charlieSeat = successorState.participants.indexOf(
            charlie.address
        );
        expect(
            charlieSeat,
            "Charlie is seated on the successor fork"
        ).to.be.at.least(0);
        expect(
            successorState.balances[charlieSeat],
            "Charlie keeps his balance from his history"
        ).to.equal(
            charliesState.balances[
                charliesState.participants.indexOf(charlie.address)
            ]
        );
        expect(
            successorState.participants,
            "the slashed Alice leaves the channel"
        ).to.not.include(alice.address);
        await h.assert.dispute.slashedOnChainExactly([alice.address]);
    });

    it("the colluders' dispute omits its auditing data and lists seated Charlie in onChainSlashes, which drops him from the set that must sign its hop -> Charlie's DisputeOnChainSlashesNotSubset kills it on chain, and only its submitter is slashed", async function () {
        const h = TestSession.getHarness();
        const history = await stageSeatedJoinerHistory(h);
        const alice = h.getPeer(history.aliceIndex);
        const charlie = h.getPeer(history.charlieIndex);

        const posted = await postJoinerBypassDispute(h, history, (dispute) => {
            dispute.input.onChainSlashes = [charlie.address];
            dispute.postedAuditingData = false;
        });
        expect(posted.dispute.postedAuditingData).to.equal(false);
        expect(
            await h.channelManager.isAuditingDataOmissionAllowed.staticCall(
                posted.dispute
            ),
            "without Charlie, Alice and Bob alone make the hop final"
        ).to.equal(true);
        expect(
            await h
                .control(charlie)
                .query.getStateSnapshotStructByHash(posted.hopSnapshot.hash)
                .request(),
            "Charlie never held the hop's snapshot"
        ).to.equal(null);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeOnChainSlashesNotSubset,
            peerIndices: [charlie.index]
        });
        await h.event.waitForPeers("onDisputeKilled", [charlie.index], 1, {
            mode: "atLeast"
        });

        const kill = await readDisputeKill(h, alice.address);
        expect(kill.killer).to.equal(charlie.address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeOnChainSlashesNotSubset
        ]);
        await h.assert.dispute.slashedOnChainExactly([alice.address]);
    });

    it("the colluders offer side-chain final points below seated Charlie's JOIN against his honest dispute -> the chain refuses both the regression and the conflict counter, the kill attempt slashes its sender, and Charlie's dispute stays committed", async function () {
        const h = TestSession.getHarness();
        const history = await stageSeatedJoinerHistory(h);
        const alice = h.getPeer(history.aliceIndex);
        const charlie = h.getPeer(history.charlieIndex);

        let auditingData: DisputeAuditingDataStruct | undefined;
        const dispute = await uploadSelfRemovalDispute(
            h,
            charlie.index,
            async (_dispute, constructed) => {
                auditingData = globalThis.structuredClone(constructed);
            },
            { markMalicious: false }
        );
        await h.assert.dispute.committedWait({
            peersIndices: [charlie.index],
            expectedCount: 1
        });
        if (!auditingData) throw new Error("Charlie's dispute was not built");
        const lastMilestoneIndex =
            dispute.input.stateProof.milestones.length - 1;
        const latestFinalized = Block.fromBlockConfirmation(
            dispute.input.stateProof.milestones[lastMilestoneIndex]!
                .blockConfirmations[0]!
        );
        const latestFinalizedSnapshot = StateSnapshot.from(
            auditingData.milestoneSnapshots.at(-1)!
        );
        expect(
            latestFinalizedSnapshot.hash,
            "G is the snapshot of the last milestone's first block"
        ).to.equal(latestFinalized.stateSnapshotHash);
        expect(
            latestFinalizedSnapshot.latestInboundMessageBlockHash,
            "G is past Charlie's JOIN"
        ).to.equal(history.charlieFinal.latestInboundMessageBlockHash);
        expect(
            latestFinalized.height - 1,
            "a side-chain height lies between the anchor and G"
        ).to.be.greaterThan(history.anchor.blockHeight);

        const below = await forgeSideChainFinalProof(h, history, {
            height: latestFinalized.height - 1,
            genesisStateSnapshotData: auditingData.genesisStateSnapshotData
        });
        const atG = await forgeSideChainFinalProof(h, history, {
            height: latestFinalized.height,
            genesisStateSnapshotData: auditingData.genesisStateSnapshotData
        });
        for (const side of [below, atG]) {
            const walk = await h.channelManager.verifyMilestones.staticCall(
                side.finalProof
            );
            expect(walk.valid, "the side-chain point is final").to.equal(true);
            expect(StateSnapshot.from(walk.finalizedSnapshot).hash).to.equal(
                side.finalSnapshot.hash
            );
            expect(
                side.finalSnapshot.latestInboundMessageBlockHash,
                "the side chain never consumed the JOIN"
            ).to.equal(history.anchor.latestInboundMessageBlockHash);
        }
        // the side chain consumed no JOIN G skipped: there is no block to name
        const regression = {
            finalProof: below.finalProof,
            latestFinalizedSnapshot: latestFinalizedSnapshot.toStruct(),
            joinInboundBlockHash: ethers.ZeroHash
        };
        const conflict = {
            finalProof: atG.finalProof,
            milestoneIndex: lastMilestoneIndex,
            blockIndex: 0,
            latestFinalizedSnapshot: latestFinalizedSnapshot.toStruct()
        };
        expect(
            await h.channelManager.isDisputeFinalPointRegression.staticCall(
                dispute,
                regression
            ),
            "the side-chain point's inbound is not above G's"
        ).to.equal(false);
        expect(
            await h.channelManager.isDisputeConflictingWithFinalState.staticCall(
                dispute,
                conflict
            ),
            "the side-chain point's inbound is below G's"
        ).to.equal(false);

        h.contextApi.markMaliciousPeer({ maliciousPeerIndex: alice.index });
        const tx =
            await alice.p2pInstance.stateChannelManagerContract.applyDisputeFraudProofs(
                [
                    {
                        proofType: toSolidityDisputeFraudProofType(
                            DisputeFraudProofType.DisputeFinalPointRegression
                        ),
                        participant: charlie.address,
                        dispute,
                        encodedProof: Codec.encode(
                            regression,
                            DisputeFraudProofType.DisputeFinalPointRegression
                        )
                    },
                    {
                        proofType: toSolidityDisputeFraudProofType(
                            DisputeFraudProofType.DisputeConflictsWithFinalState
                        ),
                        participant: charlie.address,
                        dispute,
                        encodedProof: Codec.encode(
                            conflict,
                            DisputeFraudProofType.DisputeConflictsWithFinalState
                        )
                    }
                ]
            );
        await tx.wait();

        const kills = await h.channelManager.queryFilter(
            h.channelManager.filters.DisputeKilled(h.channelId)
        );
        expect(
            kills.filter((log) => log.args.disputer === charlie.address),
            "no kill of Charlie's dispute lands"
        ).to.have.length(0);
        expect(
            await h.channelManager.getWindowCommitments(
                h.channelId,
                dispute.input.forkId
            )
        ).to.include(hash(Codec.encode(dispute, Type.Dispute)));
        await h.assert.dispute.slashedOnChainExactly([alice.address]);
    });
});
