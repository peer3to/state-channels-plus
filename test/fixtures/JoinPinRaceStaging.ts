// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import Clock from "@/Clock";
import StateSnapshot from "@/models/StateSnapshot";
import { moveChainSnapshot } from "@test/fixtures/JoinSnapshotRetryStaging";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";
import { waitFor } from "@test/utils/waitFor";

/**
 * A synced joiner collects its join while a snapshot post lands after it
 * pinned the snapshot and before any countersigner reads its own view: the
 * collection is held at its threshold read, the participants move the chain
 * snapshot, then the collection continues.
 */
export async function collectAcrossSnapshotMove(h: MathPeerTestHarness) {
    const joiner = await h.scenario.syncSpectator();
    const pinnedSnapshotHash = String(
        StateSnapshot.from(await h.channelManager.getStateSnapshot(h.channelId))
            .hash
    );
    const stub = h.control(joiner).stub;
    await stub.holdJoinThresholdRead().request();
    const chainTime = await Clock.getBlockchainTime();
    const collecting =
        joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation({
            participant: joiner.address,
            channelId: h.channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(chainTime.timestamp + 120)
        });
    // settled below; keep an early rejection from going unhandled meanwhile
    collecting.catch(() => undefined);
    let movedSnapshotHash: string;
    try {
        await waitFor(
            async () =>
                (await stub.getJoinThresholdReadEntered().request()) === 1,
            h.event.protocolEventTimeoutMs()
        );
        movedSnapshotHash = await moveChainSnapshot(h);
    } finally {
        await stub.releaseJoinThresholdRead().request();
    }
    return {
        joiner,
        pinnedSnapshotHash,
        movedSnapshotHash,
        prepared: await collecting
    };
}
