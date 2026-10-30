// @spec-test-coverage-ignore: shared wait on a peer's scheduled reduction; executable evidence belongs to its calling test declarations
import type { ForkId } from "@/types/types";
import type { MathPeerTestHarness } from "@test/fixtures/MathPeerTestHarness";

/**
 * Until the reduction attempt `entered` counts reaches `count` on
 * `peerIndex`. A later dispute in the window moves the peer's scheduled
 * reduction, so the evidence-period bound restarts whenever that schedule
 * changes, not once from the first dispute.
 */
export async function waitUntilScheduledReductionEntered(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId,
    entered: () => Promise<number>,
    count = 1
): Promise<void> {
    const boundMs = h.event.evidencePeriodWaitMs(2);
    let trigger: number | null = null;
    let deadline = Date.now() + boundMs;
    while ((await entered()) < count) {
        const scheduled = await h.execOnHost(
            h.getPeer(peerIndex),
            (sm, args) =>
                sm.reductionManager["timeouts"].get(args.forkId)
                    ?.triggerTimestamp ?? null,
            { forkId }
        );
        if (scheduled !== null && scheduled !== trigger) {
            trigger = scheduled;
            deadline = Date.now() + boundMs;
        }
        if (Date.now() > deadline)
            throw new Error(
                `peer ${peerIndex} entered no reduction attempt within ${boundMs}ms of its last scheduled reduction`
            );
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
}
