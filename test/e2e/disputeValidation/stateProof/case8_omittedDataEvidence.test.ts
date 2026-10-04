import Block from "@/models/Block";
import { Codec, Type } from "@/utils";
import { storedProofBlock } from "@test/fixtures/DisputeAuditStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import type {
    BlockConfirmationStruct,
    StateSnapshotStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { expect } from "chai";

// Case 8: omitted auditing data. Without data the dispute's handler proves
// only a broken link or a wrong latest state; an earlier run that misses
// the threshold leaves the whole-proof walk unusable, not the dispute
// invalid.
describe("E2E: dispute validation / stateProof / Case 8 (omitted-data evidence)", function () {
    it("an omitted-data dispute with a linked earlier run missing the threshold and a last run final by everyone → no DisputeInvalidStateProof, no kill, the latest-state check still runs, it resolves, no honest slash", async function () {
        const h = TestSession.getHarness();
        await h.lifecycle.start(3, 4);
        // a head final by everyone, so the dispute omits its auditing data
        await h.transition.advanceState({
            count: 1,
            waitForFinalization: true
        });
        const forkId = h.activeForkId!;
        const [disputer, ...auditors] = [0, 1, 2];
        for (const index of [disputer, ...auditors])
            await h.rpcStub.suppressTimeoutCheck(index);
        // an honest self-removal dispute posted on the disputer's behalf;
        // its runtime must not re-upload it
        await h
            .control(h.getPeer(disputer))
            .dispute.setForceExit(true)
            .request();
        await h.dispute.suppressDisputeInitiation([disputer]);
        h.context.leftChannelPeerIndices = [
            ...h.context.leftChannelPeerIndices,
            disputer
        ];
        const latestStateChecks = await h.mirror.observe(
            auditors[0],
            "isCorrectLatestState"
        );
        const snapshots: StateSnapshotStruct[] = [];

        const { dispute } = await h.tamper.postTamperedDispute(
            disputer,
            async (dispute) => {
                const kept = dispute.input.stateProof.milestones;
                const firstKept = Block.fromBlockConfirmation(
                    kept[0].blockConfirmations[0]
                ).height;
                expect(firstKept, "room for an earlier run").to.be.greaterThan(
                    2
                );
                // the two stored blocks below the first kept one, each signed
                // by its author alone: linked, but two of three participants
                // miss the threshold
                const earlier: BlockConfirmationStruct[] = [];
                for (let height = firstKept - 2; height < firstKept; height++) {
                    const stored = await storedProofBlock(
                        h,
                        disputer,
                        forkId,
                        height
                    );
                    if (earlier.length === 0) snapshots.push(stored.snapshot);
                    earlier.push({ ...stored.confirmation, signatures: [] });
                }
                for (const { blockConfirmations } of kept)
                    snapshots.push(
                        (
                            await storedProofBlock(
                                h,
                                disputer,
                                forkId,
                                Block.fromBlockConfirmation(
                                    blockConfirmations[0]
                                ).height
                            )
                        ).snapshot
                    );
                dispute.input.stateProof.milestones = [
                    { blockConfirmations: earlier },
                    ...kept
                ];
            },
            { markMalicious: false }
        );
        expect(dispute.postedAuditingData).to.equal(false);

        // premises on the chain: the full walk fails on finality, the walk
        // without finality is linked, and the last run is final by everyone
        const genesisResult = await h
            .control(h.getPeer(auditors[0]))
            .dispute.getGenesisSnapshotStruct(forkId)
            .request();
        const genesisStateSnapshotData = Codec.decode(
            genesisResult!.encodedSnapshot,
            Type.StateSnapshot
        ).snapshotData;
        const { stateProof } = dispute.input;
        expect(
            (
                await h.channelManager.verifyMilestones({
                    channelId: h.channelId,
                    forkId,
                    stateProof,
                    genesisStateSnapshotData,
                    milestoneSnapshots: snapshots
                })
            ).valid,
            "the earlier run misses the threshold"
        ).to.equal(false);
        expect(
            await h.channelManager.isStateProofLinked(
                h.channelId,
                forkId,
                stateProof,
                genesisStateSnapshotData
            )
        ).to.equal(true);
        expect(
            await h.channelManager.isLastMilestoneFinalByEveryone.staticCall(
                dispute
            )
        ).to.equal(true);

        await h.assert.dispute.committedWait({
            peersIndices: auditors,
            expectedCount: 1
        });
        // the independent latest-state check ran and held
        await waitFor(
            async () => (await latestStateChecks.observation()).local.reads > 0
        );
        expect(
            (await latestStateChecks.observation()).local.answers
        ).to.not.include(false);
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: auditors,
            assertMaliciousRemoved: false
        });

        for (const index of auditors) {
            expect(
                await h
                    .control(h.getPeer(index))
                    .query.getDisputeFraudProofTypes()
                    .request(),
                `peer ${index} stored no fraud proof`
            ).to.deep.equal([]);
            expect(
                h.event.getEventCallCount(index, "onDisputeKilled")
            ).to.equal(0);
        }
        const slashed = await h.query.onChainSlashedParticipants(auditors[0]);
        for (const index of [disputer, ...auditors])
            expect(slashed).to.not.include(h.getPeer(index).address);
    });
});
