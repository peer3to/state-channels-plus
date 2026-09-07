// @spec-test-coverage-ignore: shared staging for public leave guards
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import { Codec, Type } from "@/utils";
import { expect } from "chai";
import { ethers } from "ethers";

export async function assertPendingLeaveGuard(
    h: MathPeerTestHarness,
    operation:
        | "joinLobby"
        | "joinChannel"
        | "topUpBalance"
        | "collectJoinChannelConfirmation"
) {
    const prepared = await h.scenario.syncSpectatorAndPrepareJoin(0);
    const leaver = h.getPeer(1);
    const signer = leaver.p2pInstance.p2pSigner;
    const leave = signer.leaveChannel();
    void leave.catch(() => undefined);
    try {
        await h.event.waitUntilLeavePhase(leaver.index, "awaiting-exit");
        const attempt =
            operation === "joinLobby"
                ? signer.joinLobby(ethers.id("pending-leave-lobby"))
                : operation === "collectJoinChannelConfirmation"
                  ? signer.collectJoinChannelConfirmation(
                        Codec.decode(
                            prepared.confirmation.signedJoinChannel
                                .encodedJoinChannel,
                            Type.JoinChannel
                        )
                    )
                  : signer[operation](
                        prepared.confirmation,
                        prepared.expectedSnapshotHash,
                        prepared.expectedForkId
                    );
        await expect(attempt).to.be.rejectedWith(
            "terminal channel leave is pending"
        );
    } finally {
        await leaver.p2pInstance.dispose();
    }
    await expect(leave).to.be.rejectedWith("disposed");
}
