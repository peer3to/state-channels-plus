import { Codec, Type } from "@/utils";
import {
    commitmentOf,
    committedDisputeLogs,
    killedDisputeLogs,
    stageKillAndReplacement,
    stageSpamAfterOwnDispute,
    waitPastKillPeriod
} from "@test/fixtures/DisputeWindowWorkflowStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

const KILL_PERIOD_EXPIRED = "RaceConditionDisputeKillPeriodExpired";

/**
 * Plan 35 (milestone-only state proof): an invalid initial dispute is killed
 * and the honest auditor's own evidence lands at once (E49 with its
 * kill-then-dispute ordering extension), and challenge timing against the
 * kill window (E22).
 */
describe("E2E: kill then dispute, and challenge timing", function () {
    it("E49: an invalid opener is killed and the auditor's own dispute lands in the same multicall, kill first, with the killed submitter's slash as its reason; reduction completes from it", async function () {
        const h = TestSession.getHarness();
        const { forkId, replacer, spammer, spam, replacement, loneKills } =
            await stageKillAndReplacement(h, { holdReplacement: false });

        await waitFor(
            async () =>
                (await replacement.submissions()).some(
                    (submission) => submission.waited
                ),
            h.event.protocolEventTimeoutMs()
        );
        const submissions = await replacement.submissions();
        expect(submissions).to.have.length(1);
        const [submission] = submissions;
        const own = Codec.decode(submission.encodedDispute, Type.Dispute);
        // the kill and the replacement are one transaction, the kill first
        expect(submission.method).to.equal("multicallBestEffortLast");
        expect(submission.innerMethods).to.deep.equal([
            "applyDisputeFraudProofs",
            own.postedAuditingData
                ? "uploadDisputeWithCalldata"
                : "uploadDispute"
        ]);
        expect(submission.revert).to.equal(null);
        expect(own.input.disputer).to.equal(replacer.address);
        // the replacement counts the slash its own kill establishes
        expect(own.input.onChainSlashes).to.include(spammer.address);
        // the kill rode in the multicall: no lone kill was sent
        expect(await loneKills.applies()).to.deep.equal([]);

        // on chain: no other dispute came between the spam and the
        // replacement, and the kill was applied before the upload
        const committed = await committedDisputeLogs(h);
        expect(
            committed.slice(0, 2).map((log) => log.commitment)
        ).to.deep.equal([commitmentOf(spam), commitmentOf(own)]);
        const killed = await killedDisputeLogs(h);
        expect(killed).to.have.length(1);
        expect(killed[0].disputer).to.equal(spammer.address);
        expect(killed[0].transactionHash).to.equal(
            committed[1].transactionHash
        );
        expect(killed[0].logIndex).to.be.lessThan(committed[1].logIndex);
        expect(
            await h.channelManager.getOnChainSlashedParticipants(h.channelId)
        ).to.include(spammer.address);
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            forkId
        );
        expect(commitments).to.include(commitmentOf(own));
        expect(commitments).to.not.include(commitmentOf(spam));

        // the committed replacement is the evidence the reduction uses: the
        // honest peers reduce and the slashed spammer is removed
        const reduction = await h.dispute.resolveDisputeWait({ forkId });
        const remaining = [replacer, h.getPeer(2), h.getPeer(3)];
        expect(await h.peerForkIds(remaining)).to.deep.equal(
            remaining.map(() => reduction.newForkId)
        );
        for (const peer of remaining) {
            expect(
                await h.control(peer).query.getParticipants().request()
            ).to.have.members(remaining.map((p) => p.address));
        }
    });

    it("E49 ext: when the kill in the kill-then-dispute multicall cannot land (kill period over), the whole multicall reverts: no replacement claiming the unestablished slash is committed, and the failure is fatal", async function () {
        const h = TestSession.getHarness();
        const { forkId, replacer, spammer, spam, replacement, loneKills } =
            await stageKillAndReplacement(h, { holdReplacement: true });

        // the audit and the multicall were built inside the kill window
        await replacement.waitUntilHeld();
        const [held] = await replacement.submissions();
        const claimed = Codec.decode(held.encodedDispute, Type.Dispute);
        expect(held.method).to.equal("multicallBestEffortLast");
        expect(held.innerMethods[0]).to.equal("applyDisputeFraudProofs");
        expect(claimed.input.onChainSlashes).to.include(spammer.address);

        const period = await waitPastKillPeriod(h, forkId, replacer.index);
        expect(period.isExpired).to.equal(true);
        await replacement.release();
        await TestSession.settleDetached({
            expectedErrorIncludes: KILL_PERIOD_EXPIRED
        });

        const [sent] = await replacement.submissions();
        expect(sent.waited).to.equal(false);
        // the fallback lone kill sees the closed period and sends nothing
        expect(await loneKills.applies()).to.deep.equal([]);
        expect(await killedDisputeLogs(h)).to.deep.equal([]);
        expect(
            await h.channelManager.getOnChainSlashedParticipants(h.channelId)
        ).to.not.include(spammer.address);
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            forkId
        );
        expect(commitments).to.have.length(1);
        expect(commitments).to.include(commitmentOf(spam));
        expect(commitments).to.not.include(commitmentOf(claimed));
        expect(
            await h.control(replacer).query.didIDispute(forkId).request()
        ).to.equal(false);
    });

    it("E22: an audit that completes inside the kill window kills the invalid dispute in time: the challenge lands before the period ends and slashes the submitter", async function () {
        const h = TestSession.getHarness();
        const { forkId, killer, spammer, own, spam, kills } =
            await stageSpamAfterOwnDispute(h, { holdKill: false });

        await h.event.waitForPeers("onDisputeKilled", [killer.index], 1, {
            mode: "atLeast"
        });
        // the kill event can reach the killer before its own receipt wait
        // returns: wait for the sender's settled view of the transaction
        await waitFor(
            async () =>
                (await kills.applies()).some(
                    (apply) => apply.waited || apply.error !== null
                ),
            h.event.protocolEventTimeoutMs()
        );
        const applies = await kills.applies();
        expect(applies).to.have.length(1);
        expect(applies[0].participants).to.deep.equal([spammer.address]);
        expect(applies[0].waited).to.equal(true);
        expect(applies[0].error).to.equal(null);

        const killed = await killedDisputeLogs(h);
        expect(killed).to.have.length(1);
        expect(killed[0].disputer).to.equal(spammer.address);
        const { killPeriodEnd } = await h.query.killPeriod(
            forkId,
            killer.index
        );
        expect(killed[0].timestamp).to.be.lessThan(killPeriodEnd);
        expect(
            await h.channelManager.getOnChainSlashedParticipants(h.channelId)
        ).to.include(spammer.address);
        const commitments = await h.channelManager.getWindowCommitments(
            h.channelId,
            forkId
        );
        expect(commitments).to.have.length(1);
        expect(commitments).to.include(commitmentOf(own));
        expect(commitments).to.not.include(commitmentOf(spam));
        await TestSession.settleDetached();
    });

    it("E22: a challenge sent after the kill period ends reverts with RaceConditionDisputeKillPeriodExpired and is fatal: no kill, no slash, the invalid dispute stays committed", async function () {
        const h = TestSession.getHarness();
        const { forkId, killer, spammer, spam, kills } =
            await stageSpamAfterOwnDispute(h, { holdKill: true });

        // the audit finished inside the window; its challenge waits at the send
        await kills.waitUntilHeld(1);
        const period = await waitPastKillPeriod(h, forkId, killer.index);
        expect(period.isExpired).to.equal(true);
        await kills.release();
        await TestSession.settleDetached({
            expectedErrorIncludes: KILL_PERIOD_EXPIRED
        });

        const applies = await kills.applies();
        expect(applies).to.have.length(1);
        expect(applies[0].waited).to.equal(false);
        expect(applies[0].customError).to.equal(KILL_PERIOD_EXPIRED);
        expect(await killedDisputeLogs(h)).to.deep.equal([]);
        expect(
            await h.channelManager.getOnChainSlashedParticipants(h.channelId)
        ).to.not.include(spammer.address);
        expect(
            await h.channelManager.getWindowCommitments(h.channelId, forkId)
        ).to.include(commitmentOf(spam));
    });
});
