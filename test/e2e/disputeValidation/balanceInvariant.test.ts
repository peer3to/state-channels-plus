import { DisputeFraudProofType } from "@/types/sol-enums";
import {
    assertColludersKilledByConflict,
    postForgedDepositsHead,
    stageBlindPendingAuditor,
    stageParallelHeadAudits,
    waitUntilAuditorStoredBlockAt
} from "@test/fixtures/DisputeAuditStaging";
import { postSelfRemovalDispute } from "@test/fixtures/MilestoneProofStartStaging";
import { readDisputeKill } from "@test/fixtures/OmittedInboundJoinerStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { expect } from "chai";

describe("E2E: dispute validation / balanceInvariant", function () {
    it("an honest dispute with nonzero genesis deposits passes the local balance invariant", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        await h.control(h.getPeer(0)).dispute.setForceExit(true).request();
        const { dispute, auditingData } =
            await h.dispute.fetchConstructedDispute(0);

        expect(
            BigInt(
                auditingData.latestStateSnapshot.snapshotData.totalDeposits
                    .amount
            )
        ).to.be.greaterThan(0n);

        const run = await h.dispute.auditDispute(1, dispute);

        expect(run).to.include({ outcome: "returned", isValid: true });
        expect(run.disputeFraudProofCount).to.equal(0);
    });

    it("peer 2 uploads a dispute whose committed snapshot breaks the balance invariant; a pending auditor without a final block at the forged head → DisputeInvalidBalanceInvariant, then the colluders' real-head disputes → DisputeConflictsWithFinalState (forged audited first)", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const forkId = h.activeForkId!;
        // the colluders' head is one the pending auditor never finalized
        const { auditorIndex, restoreGossip } = await stageBlindPendingAuditor(
            h,
            [0, 1, 2]
        );
        // the participants (the submitter's own node too) hold the real
        // head final: only the auditor's counters may land
        await Promise.all(
            [0, 1, 2].map((index) => h.rpcStub.suppressDisputeKill(index))
        );

        await postForgedDepositsHead(h, 2, [auditorIndex]);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeInvalidBalanceInvariant,
            peerIndices: [auditorIndex]
        });
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast"
        });
        const kill = await readDisputeKill(h, h.getPeer(2).address);
        expect(kill.killer).to.equal(h.getPeer(auditorIndex).address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeInvalidBalanceInvariant
        ]);
        await restoreGossip();
        await assertColludersKilledByConflict(h, {
            forkId,
            auditorIndex,
            submitterIndex: 2,
            colluderIndices: [0, 1]
        });
    });

    it("the colluders' real-head dispute audited first by the pending auditor, then peer 2's forged-head dispute → the auditor accepts the real head and kills the forged dispute with DisputeConflictsWithFinalState (real audited first)", async function () {
        const h = TestSession.getHarness();
        // The real audit precedes the forged upload and its follow-up disputes.
        await h.scenario.preDisputeSetup({ timeConfig: { evidenceTime: 15 } });
        const forkId = h.activeForkId!;
        const { auditorIndex, restoreGossip } = await stageBlindPendingAuditor(
            h,
            [0, 1, 2]
        );
        // the participants hold the real head final: only the auditor's
        // counter may land; peer 2 holds back until its forged dispute
        await Promise.all(
            [0, 1, 2].map((index) => h.rpcStub.suppressDisputeKill(index))
        );
        await h.dispute.suppressDisputeInitiation([1, 2]);

        // peer 0's real-head self-removal dispute opens the window; the
        // pending auditor never signed, so its data is posted
        const realHead = await h
            .control(h.getPeer(0))
            .query.getLatestBlockInfo(forkId)
            .request();
        const real = await postSelfRemovalDispute(h, 0, () => {}, {
            malicious: false
        });
        expect(real.dispute.postedAuditingData).to.equal(true);
        await waitUntilAuditorStoredBlockAt(h, auditorIndex, forkId, realHead);

        await postForgedDepositsHead(h, 2, [auditorIndex]);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeConflictsWithFinalState,
            peerIndices: [auditorIndex]
        });
        // the counter is stored before its kill transaction lands
        await h.event.waitForPeers("onDisputeKilled", [auditorIndex], 1, {
            mode: "atLeast"
        });
        const kill = await readDisputeKill(h, h.getPeer(2).address);
        expect(kill.killer).to.equal(h.getPeer(auditorIndex).address);
        expect(kill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeConflictsWithFinalState
        ]);
        await restoreGossip();
        await h.dispute.resolveDisputeWait({ forkId });
        await h.assert.dispute.slashedOnChainExactly([h.getPeer(2).address]);
    });

    it("the pending auditor audits the forged-head and two real-head disputes at the same time, the forged walk released first → the forged head is stored, its dispute is killed with DisputeInvalidBalanceInvariant, each real-head dispute with DisputeConflictsWithFinalState, and the channel reduces from the auditor's own dispute", async function () {
        const h = TestSession.getHarness();
        const staged = await stageParallelHeadAudits(h);
        const { forkId, auditorIndex, walks, realHead, forgedHead } = staged;
        const auditor = h.getPeer(auditorIndex);

        // the forged audit persists its head first; the real audits, already
        // past their conflict checks, then find the stored forged head
        await walks.release(forgedHead.hash);
        await waitUntilAuditorStoredBlockAt(
            h,
            auditorIndex,
            forkId,
            forgedHead
        );
        await walks.release(realHead.hash);
        await walks.release(realHead.hash);
        await walks.restore();

        // The concurrent real-head audits can kill a different dispute first.
        await h.eventCountsBarrier.waitFor(
            () =>
                auditor.eventSpies.onDisputeKilled
                    ?.getCalls()
                    .some(
                        ({ args }) =>
                            args[1] === forkId &&
                            args[2] === h.getPeer(2).address
                    ) ?? false,
            {
                timeoutMs: h.event.protocolEventTimeoutMs(),
                timeoutMessage:
                    "The auditor did not observe the forged submitter's dispute kill"
            }
        );
        const forgedKill = await readDisputeKill(h, h.getPeer(2).address);
        expect(forgedKill.killer).to.equal(auditor.address);
        expect(forgedKill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeInvalidBalanceInvariant
        ]);
        expect(
            await h
                .control(auditor)
                .query.getBlockHashAt(forkId, staged.headHeight)
                .request(),
            "only the forged head is stored"
        ).to.equal(forgedHead.hash);
        await staged.restoreGossip();
        // both real-head disputes are killed with DisputeConflictsWithFinalState,
        // no fatal error stops the auditor, and the reduction uses its own dispute
        await assertColludersKilledByConflict(h, {
            forkId,
            auditorIndex,
            submitterIndex: 2,
            colluderIndices: [0, 1]
        });
    });

    it("the pending auditor audits the forged-head and two real-head disputes at the same time, the real walks released first → the real head is stored and the forged dispute is killed with DisputeConflictsWithFinalState after its walk", async function () {
        const h = TestSession.getHarness();
        const staged = await stageParallelHeadAudits(h);
        const { forkId, auditorIndex, walks, realHead, forgedHead } = staged;
        const auditor = h.getPeer(auditorIndex);

        // The two real commitments already supply reduction evidence. Keep
        // this held-audit case on the kill-only path for the forged dispute.
        await h.dispute.suppressDisputeInitiation([auditorIndex]);

        // the real audits persist the real head first; the forged audit,
        // already past its conflict check, then finds it after its walk
        await walks.release(realHead.hash);
        await walks.release(realHead.hash);
        await waitUntilAuditorStoredBlockAt(h, auditorIndex, forkId, realHead);
        await walks.release(forgedHead.hash);
        await walks.restore();

        await h.event.waitForPeers("onDisputeKilled", [auditorIndex], 1, {
            mode: "atLeast"
        });
        const forgedKill = await readDisputeKill(h, h.getPeer(2).address);
        expect(forgedKill.killer).to.equal(auditor.address);
        expect(forgedKill.appliedProofTypes).to.deep.equal([
            DisputeFraudProofType.DisputeConflictsWithFinalState
        ]);
        expect(
            await h
                .control(auditor)
                .query.getBlockHashAt(forkId, staged.headHeight)
                .request(),
            "only the real head is stored"
        ).to.equal(realHead.hash);
        await staged.restoreGossip();
        // the real-head disputes stand: peer 0 leaves by its self-removal,
        // peer 2 is slashed, and peer 1 stays with the auditor
        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: [1, auditorIndex]
        });
        await h.assert.dispute.slashedOnChainExactly([h.getPeer(2).address]);
    });

    it("control: the same forged head audited by participants that hold the real final block at that height → DisputeConflictsWithFinalState kills it", async function () {
        const h = TestSession.getHarness();
        await h.scenario.preDisputeSetup();
        const forkId = h.activeForkId!;

        await postForgedDepositsHead(h, 2, []);

        await h.assert.storage.honestPeersStoredDisputeFraudProofWait({
            disputeFraudProofType:
                DisputeFraudProofType.DisputeConflictsWithFinalState,
            peerIndices: [0, 1]
        });
        await h.event.waitForPeers("onDisputeKilled", [0, 1], 1, {
            mode: "atLeast"
        });
        await h.assert.dispute.slashedOnChain(h.getPeer(2).address);
        await h.dispute.resolveDisputeWait({ forkId });
    });
});
