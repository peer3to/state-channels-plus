import StateSnapshot from "@/models/StateSnapshot";
import { Status } from "@/types";
import { MathTestSession as TestSession } from "@test/harness";
import { expectDecodedError } from "@test/test_utils/customErrorAssertions";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * Plan 35, E42: the join transaction's snapshot pin, through the joiner's SDK
 * join. A real snapshot update landing while the prepared join waits at its
 * send makes the pin stale; with no update the pin matches and the joiner is
 * admitted.
 */
describe("E2E: join snapshot guard", function () {
    it("E42 control: a join prepared against snapshot S with no snapshot update before execution passes the snapshot guard and the joiner is admitted", async function () {
        const h = TestSession.getHarness();
        const {
            joiner,
            stateSnapshot: snapshotAtPreparation,
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        } = await h.scenario.syncSpectatorAndPrepareJoin();
        expect(expectedSnapshotHash).to.equal(
            StateSnapshot.from(snapshotAtPreparation).hash
        );

        // no snapshot update lands between preparation and execution
        expect(
            StateSnapshot.from(
                await h.channelManager.getStateSnapshot(h.channelId)
            ).hash
        ).to.equal(expectedSnapshotHash);
        const joined = await joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );

        expect(joined).to.equal(true);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.include(joiner.address);
        expect(await h.control(joiner).query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );

        // the next block consumes the join: the joiner participates
        await h.assert.storage.honestPeersObserveInboundMessageWait({
            peerIndices: [0, 1, 2]
        });
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2]
        });
        await h.event.waitUntilPeerStatus(joiner.index, Status.PARTICIPATING);
        expect(
            await h.control(joiner).query.getParticipants().request()
        ).to.include(joiner.address);
    });

    it("E42: a join prepared against snapshot S and held at its send while a real snapshot update lands reverts with RaceConditionJoinChannelSnapshotMismatch; the joiner aborts and is not admitted", async function () {
        const h = TestSession.getHarness();
        const { joiner, confirmation, expectedSnapshotHash, expectedForkId } =
            await h.scenario.syncSpectatorAndPrepareJoin();
        const releaseSubmission = await h.rpcStub.holdMembershipSubmission(
            joiner.index,
            "joinChannel"
        );
        const join = joiner.p2pInstance.p2pSigner.joinChannel(
            confirmation,
            expectedSnapshotHash,
            expectedForkId
        );
        // observed below; keeps a failure from being an unhandled rejection meanwhile
        join.catch(() => undefined);
        await waitFor(
            async () =>
                (await h
                    .control(joiner)
                    .stub.getHeldMembershipReceiptCount()
                    .request()) === 1,
            h.event.protocolEventTimeoutMs()
        );

        // the participants finalize a newer block and post its snapshot
        await h.transition.advanceState({
            count: 1,
            waitForPeers: [0, 1, 2],
            waitForFinalization: true
        });
        const posted = await h.transition.postSnapshotWait();
        expect(posted, "a newer snapshot was posted").to.not.equal(undefined);
        const current = StateSnapshot.from(
            await h.channelManager.getStateSnapshot(h.channelId)
        ).hash;
        expect(current).to.not.equal(expectedSnapshotHash);

        await releaseSubmission();
        expect(await join).to.equal(false);

        // the race revert aborts the joiner and disposes its runtime: its
        // status comes from the forwarded hooks, not from the runtime
        expect(joiner.eventSpies.onAbort?.called).to.equal(true);
        const statusChanges = (
            joiner.eventSpies.onStatusChanged?.getCalls() ?? []
        ).map((call): [Status, Status] => [call.args[0], call.args[1]]);
        expect(statusChanges.at(-1)).to.deep.equal([
            Status.SYNCED,
            Status.OPENED
        ]);
        expect(
            await h.channelManager.getPendingParticipants(h.channelId)
        ).to.not.include(joiner.address);
        expect(
            await h.channelManager.getParticipants(h.channelId)
        ).to.not.include(joiner.address);

        // the joiner's runtime is disposed, so the revert is pinned by
        // replaying the same join on the chain: the stale pin against the
        // new snapshot
        let revert: unknown;
        try {
            await h.channelManager
                .connect(joiner.signer)
                .joinChannel.staticCall(
                    confirmation,
                    expectedSnapshotHash,
                    expectedForkId
                );
            expect.fail("expected the stale join to revert");
        } catch (error) {
            revert = error;
        }
        const mismatch = expectDecodedError(
            revert,
            "RaceConditionJoinChannelSnapshotMismatch",
            "the join must revert on its stale snapshot pin"
        );
        // (currentSnapshotHash, submittedSnapshotHash)
        expect(mismatch.errorDescription.args.map(String)).to.deep.equal([
            String(current),
            String(expectedSnapshotHash)
        ]);
    });
});
