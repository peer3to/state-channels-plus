import { Codec, Type } from "@/utils";
import {
    commitmentOf,
    holdReductions,
    lastMilestoneFirstBlock,
    latestProofBlock,
    postSpamDispute,
    stageAuditorBehindLastFinalBlock,
    stageOffWireBlock,
    storedStateHashAt
} from "@test/fixtures/DisputeWindowWorkflowStaging";
import { disputeOnHost } from "@test/fixtures/ReplayGasLimitStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Plan 35 (milestone-only state proof), E21: each fatal audit workflow on a
 * live, committed dispute. The auditor's event pipeline fails with the
 * error; it stores no counter and sends no kill and no dispute.
 */
describe("E2E: fatal dispute audits", function () {
    it("E21: a verification read that throws during a live audit is fatal: no fraud proof, no kill, no dispute, and no fallback to the chain read", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup({ peerCount: 4 });
        const forkId = h.activeForkId!;
        const auditor = h.getPeer(0);
        await holdReductions(h);
        for (const index of [1, 2, 3])
            await h.rpcStub.suppressDisputeKill(index);
        const uploads = await h.rpcStub.recordDisputeSubmissions(
            auditor.index,
            { forward: true }
        );
        const kills = await h.rpcStub.recordDisputeFraudProofApplies(
            auditor.index
        );
        const reads = await h.mirror.observe(
            auditor.index,
            "isCorrectLatestState"
        );
        // the executor connection fails the read without a verdict
        await h.mirror.failNextLocalRead(
            auditor.index,
            "isCorrectLatestState",
            "transport"
        );

        // without the fault, the auditor would kill this dispute
        const spam = await postSpamDispute(h, 1);
        await waitFor(
            async () => (await reads.observation()).local.failures.length > 0,
            h.event.protocolEventTimeoutMs()
        );
        await TestSession.settleDetached({
            expectedErrorIncludes: "Malformed RPC request"
        });

        const { local, chain } = await reads.observation();
        expect(local.failures).to.have.length(1);
        expect(chain.reads).to.equal(0);
        expect(
            await h.control(auditor).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([]);
        expect(await uploads.submissions()).to.deep.equal([]);
        expect(await kills.applies()).to.deep.equal([]);
        expect(
            await h.channelManager.getWindowCommitments(h.channelId, forkId)
        ).to.include(commitmentOf(spam));
    });

    it("E21: an auditor missing the full finalized state its replay starts from is fatal: no fallback to a weaker check, no fraud proof, no kill, no dispute", async function () {
        const h = TestSession.getHarness();
        const { forkId, leader, others, authored, height } =
            await stageOffWireBlock(h);
        const auditor = h.getPeer(others[0]);
        const leaderUploads = await h.rpcStub.recordDisputeSubmissions(
            leader.index,
            { forward: true }
        );
        const uploads = await h.rpcStub.recordDisputeSubmissions(
            auditor.index,
            { forward: true }
        );
        const kills = await h.rpcStub.recordDisputeFraudProofApplies(
            auditor.index
        );
        const reads = await h.mirror.observe(
            auditor.index,
            "isCorrectLatestState"
        );
        // the auditor's latest finalized state (height - 1) is the base of
        // the replay of the off-wire block; its full state goes missing
        const baseState = await storedStateHashAt(
            h,
            auditor.index,
            forkId,
            height - 1
        );
        expect(
            await h.control(auditor).stub.deleteStoredState(baseState).request()
        ).to.equal(true);

        await h.control(leader).dispute.setForceExit(true).request();
        await disputeOnHost(h, leader.index, forkId);
        const opening = Codec.decode(
            (await leaderUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        // omitted auditing data: no posted state can stand in for the base
        expect(opening.postedAuditingData).to.equal(false);
        expect(latestProofBlock(opening).hash).to.equal(authored.hash);
        expect(lastMilestoneFirstBlock(opening).height).to.equal(height - 1);

        await waitFor(
            async () => (await reads.observation()).local.reads > 0,
            h.event.protocolEventTimeoutMs()
        );
        await TestSession.settleDetached({
            expectedErrorIncludes: "Dispute replay: the full state of the"
        });

        expect(
            await h.control(auditor).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([]);
        expect(await uploads.submissions()).to.deep.equal([]);
        expect(await kills.applies()).to.deep.equal([]);
        expect(
            await h.control(auditor).query.getNextBlockHeight(forkId).request()
        ).to.equal(height);
    });

    it("E21: an auditor that cannot build the on-chain evidence for a proof it cannot verify (a milestone snapshot it must hold is missing) is fatal: no unsupported counter, no kill, no dispute", async function () {
        const h = TestSession.getHarness();
        const { forkId, writer, auditor, authored, height } =
            await stageAuditorBehindLastFinalBlock(h);
        expect(
            await h
                .control(auditor)
                .query.didEveryoneSignBlockAt(forkId, height)
                .request()
        ).to.equal(false);
        const writerUploads = await h.rpcStub.recordDisputeSubmissions(
            writer.index,
            { forward: true }
        );
        const uploads = await h.rpcStub.recordDisputeSubmissions(
            auditor.index,
            { forward: true }
        );
        const kills = await h.rpcStub.recordDisputeFraudProofApplies(
            auditor.index
        );
        const reads = await h.mirror.observe(
            auditor.index,
            "isCorrectLatestState"
        );
        // the auditor signed the block but no longer holds its snapshot
        expect(
            await h
                .control(auditor)
                .stub.deleteStoredSnapshot(authored.stateSnapshotHash)
                .request()
        ).to.equal(true);

        await h.control(writer).dispute.setForceExit(true).request();
        await disputeOnHost(h, writer.index, forkId);
        const opening = Codec.decode(
            (await writerUploads.submissions())[0].encodedDispute,
            Type.Dispute
        );
        // omitted auditing data and a last milestone the auditor must hop
        // to from its own lower final point, with its own snapshots
        expect(opening.postedAuditingData).to.equal(false);
        expect(lastMilestoneFirstBlock(opening).hash).to.equal(authored.hash);

        await waitFor(
            async () => (await reads.observation()).local.reads > 0,
            h.event.protocolEventTimeoutMs()
        );
        await TestSession.settleDetached({
            expectedErrorIncludes:
                "lacks the milestone snapshots to prove it on chain"
        });

        expect(
            await h.control(auditor).query.getDisputeFraudProofTypes().request()
        ).to.deep.equal([]);
        expect(await uploads.submissions()).to.deep.equal([]);
        expect(await kills.applies()).to.deep.equal([]);
    });
});
