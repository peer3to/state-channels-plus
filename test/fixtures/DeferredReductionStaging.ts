// @spec-test-coverage-ignore: shared reduction-attempt staging exercised by the mapped ReductionExecutor test declarations
import type { MathPeerTestHarness } from "./MathPeerTestHarness";
import type { ForkId } from "@/types/types";
import { waitFor } from "@test/utils/waitFor";

/**
 * Waits out the fork's kill period on the peer, then runs one executor
 * attempt there and reports whether it threw, and the fork and status it
 * left.
 */
export async function tryReduceAfterKillPeriod(
    h: MathPeerTestHarness,
    peerIndex: number,
    forkId: ForkId
) {
    // let the kill period lapse - before that the attempt returns at
    // the gate and never reaches the reduce computation
    await waitFor(
        async () =>
            h.execOnHost(
                h.getPeer(peerIndex),
                async (sm, a) => {
                    const { isExpired } =
                        await sm.reductionManager.isKillPeriodExpiredCached(
                            a.forkId
                        );
                    return isExpired;
                },
                { forkId }
            ),
        h.event.protocolEventTimeoutMs()
    );

    // drive the executor directly: ReductionManager.tryReduce returns
    // the shared completion promise, which a deferred attempt leaves
    // pending on purpose
    return await h.execOnHost(
        h.getPeer(peerIndex),
        async (sm, args) => {
            let threw = "";
            try {
                await sm.reductionManager["reductionExecutor"].tryReduce(
                    args.forkId
                );
            } catch (e) {
                threw = e instanceof Error ? e.message : String(e);
            }
            return {
                threw,
                forkIdAfter: String(sm.forkId),
                statusAfter: sm.status
            };
        },
        { forkId },
        {
            timeoutMs: h.event.hostExecTimeoutMs()
        }
    );
}
