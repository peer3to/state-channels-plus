import type Block from "@/models/Block";
import {
    forgeSupportAboveDisputeTail,
    stageFrozenViewBehindDisputeTail
} from "@test/fixtures/DisputeAuditStaging";
import {
    stageForgedSupportPayloads,
    syncSpectatorFromAllRunningPeers
} from "@test/fixtures/SyncProofStaging";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

// Support a state-proof walk checks but does not prove final is retained as
// evidence only: it never stands in a peer's executed history, so it can
// neither ground an accusation against a later honest dispute nor move a
// synced view above the proven endpoint.
describe("E2E: retained proof support stays out of executed history", function () {
    it("E50: a lagging auditor audits a dispute retaining a forged block above its tail, then the honest disputes replaying the real block there → it counters none of them, only the forger is slashed", async function () {
        const h = TestSession.getHarness();
        const { forkId, frozenIndex, live } =
            await stageFrozenViewBehindDisputeTail(h);
        const [posterIndex, ...honestIndices] = live;
        const poster = h.getPeer(posterIndex);
        // the lagging auditor only audits and kills in this window
        await h.dispute.suppressDisputeInitiation([frozenIndex]);
        const frozenApplies =
            await h.rpcStub.recordDisputeFraudProofApplies(frozenIndex);
        // the honest auditors' submissions wait until the lagging auditor
        // has audited the forged dispute
        const honestSubmissions = await Promise.all(
            honestIndices.map((index) =>
                h.rpcStub.recordDisputeSubmissions(index, {
                    hold: true,
                    forward: true
                })
            )
        );
        let forged: Block | undefined;
        let shadowed: Block | undefined;
        await h.tamper.postTamperedDispute(posterIndex, async (dispute) => {
            ({ forged, shadowed } = await forgeSupportAboveDisputeTail(
                h,
                dispute
            ));
        });
        const auditor = h.control(h.getPeer(frozenIndex)).query;
        await waitFor(
            async () =>
                (await auditor.getBlockByHash(forged!.hash).request()) !==
                    null ||
                (
                    await auditor
                        .getRetainedEvidenceAt(forkId, forged!.height)
                        .request()
                ).length > 0,
            h.event.protocolEventTimeoutMs()
        );
        for (const submissions of honestSubmissions)
            await submissions.release();

        await h.dispute.resolveDisputeWait({
            forkId,
            honestPeerIndices: honestIndices,
            assertMaliciousRemoved: false
        });

        // the lagging auditor replayed an honest dispute's real tail block
        expect(
            (await auditor.getBlockByHeight(forkId, shadowed!.height).request())
                ?.hash
        ).to.equal(shadowed!.hash);
        expect(
            (
                await auditor
                    .getRetainedEvidenceAt(forkId, forged!.height)
                    .request()
            ).map((block) => block.hash)
        ).to.deep.equal([forged!.hash]);
        const countered = (await frozenApplies.applies()).flatMap(
            (apply) => apply.participants
        );
        expect(
            countered.filter((participant) => participant !== poster.address)
        ).to.deep.equal([]);
        await h.assert.dispute.slashedOnChainExactly([poster.address]);
    });

    it("E51: a spectator syncs from a proof whose forged support sits above its proven endpoint, then follows the channel → its head stops at the endpoint, the forged block never enters its history, it catches up without blacklisting a responder", async function () {
        const h = TestSession.getHarness();
        const staged = await stageForgedSupportPayloads(h);
        const { forkId, forgedSecond } = staged;
        const endpoint = staged.anchor.blockHeight + 1;
        const spectator = await syncSpectatorFromAllRunningPeers(
            h,
            staged.poisoned
        );
        const query = h.control(spectator).query;
        expect(await query.getLatestBlockHeight(forkId).request()).to.equal(
            endpoint
        );
        expect(await query.getBlockByHeight(forkId, endpoint + 1).request()).to
            .be.null;

        await h.transition.advanceState({
            count: 2,
            waitForPeers: [0, 1, 2],
            waitForFinalization: true
        });
        await h.assert.sync.peersInSyncWait({
            peerIndices: [0, 1, 2, spectator.index]
        });

        expect(
            (await query.getBlockByHeight(forkId, endpoint + 1).request())?.hash
        ).to.not.equal(forgedSecond.hash);
        expect(
            (
                await query
                    .getRetainedEvidenceAt(forkId, endpoint + 1)
                    .request()
            ).map((block) => block.hash)
        ).to.deep.equal([forgedSecond.hash]);
        for (const index of [0, 1, 2])
            expect(
                await query.isBlacklisted(h.getPeer(index).address).request(),
                `peer ${index} is not blacklisted`
            ).to.equal(false);
    });
});
