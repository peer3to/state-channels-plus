// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type { ForkId } from "@/types/types";
import { MathTestSession as TestSession } from "@test/harness";
import { waitFor } from "@test/utils/waitFor";

// A persistent peer keeps its channel in its own temporary partition; a
// restart disposes its runtime and starts it again with the same key. The
// participant timeout is long enough that no peer times out the restarting one.
export const RESTART_TIME_CONFIG = { p2pTime: 30 };

type Harness = ReturnType<typeof TestSession.getHarness>;

/** every peer but `downIndex` authors `count` blocks, each by the peer whose turn it is */
export async function authorWhileDown(
    h: Harness,
    forkId: ForkId,
    count: number,
    downIndex: number
) {
    const live = h.peers.filter((peer) => peer.index !== downIndex);
    const query = h.control(live[0]).query;
    for (let index = 0; index < count; index++) {
        const height = await query.getLatestBlockHeight(forkId).request();
        let author: (typeof live)[number] | undefined;
        await waitFor(async () => {
            for (const peer of live) {
                const nextToWrite = await h
                    .control(peer)
                    .query.getNextToWrite()
                    .request();
                if (nextToWrite === peer.address) author = peer;
            }
            return author !== undefined;
        });
        await author!.p2pInstance.p2pContractInstance.add(1);
        await waitFor(async () =>
            (
                await Promise.all(
                    live.map((peer) =>
                        h
                            .control(peer)
                            .query.getLatestBlockHeight(forkId)
                            .request()
                    )
                )
            ).every((latest) => latest === height! + 1)
        );
    }
}
