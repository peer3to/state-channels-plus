// @spec-test-coverage-ignore: shared staging for the force-join grace after a landed join
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { Status } from "@/types";
import { waitFor } from "@test/utils/waitFor";
import { expect } from "chai";

/**
 * The join lands, then the submission reports `failure`: the call still
 * returns true, the joiner stays pending and observes its own join, which
 * starts the force-join grace. Returns the joiner's peer index.
 */
export async function assertLandedJoinStartsGrace(
    h: MathPeerTestHarness,
    failure: "uncertain" | "alreadyExists"
): Promise<number> {
    const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
    const joiner = h.getPeer(prepared.joiner.index);
    const control = h.control(joiner);
    await control.stub
        .landMembershipSubmissionThenFail("joinChannel", failure)
        .request();
    try {
        expect(
            await joiner.p2pInstance.p2pSigner.joinChannel(
                prepared.confirmation,
                prepared.expectedSnapshotHash,
                prepared.expectedForkId
            )
        ).to.equal(true);
        await waitFor(
            async () =>
                (await h.execOnHost(
                    joiner,
                    async (sm) =>
                        sm.storage.forceJoin.getCountingStartsAt() ?? null
                )) !== null,
            h.event.protocolEventTimeoutMs()
        );
        expect(await control.query.getStatus().request()).to.equal(
            Status.PENDING_PARTICIPANT
        );
    } finally {
        await control.stub.releaseMembershipReceipt().request();
    }
    return prepared.joiner.index;
}
