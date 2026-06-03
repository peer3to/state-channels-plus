import { ForkId, Hash, BlockHeight } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";
import type { PeerHandle } from "@test/harness/core/PeerHandle";

type BlockTip = { hash: Hash; height: BlockHeight };

export type WaitForPeersToSyncOptions = {
    timeoutMs?: number;
    minHeight?: number;
    waitForFinalization: boolean;
};

/**
 * Handles synchronization operations and assertions for test peers.
 */
export class SyncCoordinator {
    private logger: Logger;
    private eventBarrier: EventBarrier;

    constructor(logger: Logger, eventBarrier: EventBarrier) {
        this.logger = logger.child({ component: "SyncCoordinator" });
        this.eventBarrier = eventBarrier;
    }

    /**
     * Wait until all peers share the same tip (hash + height), optionally requiring
     * the tip to be at least `minHeight`, and optionally requiring union agreement
     * (`didEveryoneSignBlock`) on that tip.
     */
    public async waitForPeersToSync(
        peers: PeerHandle[],
        forkId: ForkId,
        options?: WaitForPeersToSyncOptions
    ): Promise<void> {
        const {
            timeoutMs = 8000,
            waitForFinalization,
            minHeight
        } = options || {};

        this.logger.verbose(`Waiting for ${peers.length} peers to sync`, {
            forkId,
            timeout: timeoutMs,
            peerIndices: peers.map((p) => p.index),
            minHeight
        });

        const loadTips = (): Promise<(BlockTip | undefined)[]> =>
            Promise.all(
                peers.map((peer) => peer.blocks.queryLatestBlock(forkId))
            );

        const checkSync = async () => {
            if (peers.length === 0) return true;

            const tipBlocks = await loadTips();

            if (tipBlocks.some((b) => b === undefined)) {
                if (tipBlocks.every((b) => b === undefined)) return true;
                return false;
            }

            const blocks = tipBlocks as BlockTip[];
            const { hash, height } = blocks[0];

            if (!blocks.every((b) => b.hash === hash && b.height === height)) {
                return false;
            }

            if (minHeight !== undefined && height < minHeight) {
                return false;
            }

            if (waitForFinalization) {
                const finalized = await Promise.all(
                    peers.map((peer, i) =>
                        peer.blocks.queryDidEveryoneSignBlock(
                            String(blocks[i].hash)
                        )
                    )
                );
                if (!finalized.every(Boolean)) return false;
            }

            return true;
        };

        let barrierError: EventBarrierCapturedError | undefined;
        try {
            await this.eventBarrier.waitFor(checkSync, {
                timeoutMs,
                timeoutMessage: waitForFinalization
                    ? `Peers failed to sync and finalize within ${timeoutMs}ms`
                    : `Peers failed to sync within ${timeoutMs}ms`
            });
            return;
        } catch (error) {
            barrierError = error as EventBarrierCapturedError;
        }

        const tipMaybe = await loadTips();
        const finalizedMaybe = waitForFinalization
            ? await Promise.all(
                  peers.map((peer, i) => {
                      const block = tipMaybe[i];
                      return block
                          ? peer.blocks.queryDidEveryoneSignBlock(
                                String(block.hash)
                            )
                          : Promise.resolve(false);
                  })
              )
            : [];

        const peerStates = peers.map((peer, i) => {
            const block = tipMaybe[i];
            const base = block
                ? `hash=${block.hash} height=${block.height}`
                : "no_block";
            const fin =
                waitForFinalization && block
                    ? ` finalize@h=${block.height} ok=${finalizedMaybe[i]}`
                    : "";
            return `Peer ${peer.index}: ${base}${fin}`;
        });

        let reason = "";
        const latest = tipMaybe[0];
        if (minHeight !== undefined) {
            reason = ` (expected height ${minHeight}, have ${latest?.height ?? "?"})`;
        }
        if (waitForFinalization && latest) {
            const allOk = finalizedMaybe.every(Boolean);
            reason += ` (finalization@h=${latest.height}: allPeers=${allOk})`;
        } else if (waitForFinalization) {
            reason += " (finalization: no tip block)";
        }

        const syncError = new Error(
            `Peers at indices [${peers.map((p) => p.index).join(", ")}] failed to synchronize within ${timeoutMs}ms${reason}. States: ${peerStates.join("; ")}`
        ) as EventBarrierCapturedError;
        syncError.capturedBarrierStack = barrierError?.capturedBarrierStack;
        throw syncError;
    }
}

export default SyncCoordinator;
