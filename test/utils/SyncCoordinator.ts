import { ForkId, Hash } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";
import type { TestPeer } from "@test/harness/core/types";
import type { Block } from "@/models";

/**
 * Options for {@link SyncCoordinator.waitForPeersToSync}. Fields interact as follows:
 *
 * - **Tip for sync:** `blockHashInStorage` if set, otherwise each peer’s latest block on `forkId`.
 * - **`minHeight`:** Peers must have tip height ≥ this. If set **without** `blockHashInStorage`,
 *   finalization (when enabled) checks the block **at** `minHeight` when the tip is **above**
 *   `minHeight`; if the tip **equals** `minHeight`, the tip block is reused (no extra lookup).
 * - **`blockHashInStorage`:** Tip is fixed to that block; `minHeight` only asserts that block’s
 *   height is ≥ `minHeight`. Finalization uses that same block.
 */
export type WaitForPeersToSyncOptions = {
    /** Barrier timeout (default 8000). */
    timeoutMs?: number;
    /**
     * If set, every peer’s tip for this wait is that block (by storage hash). If omitted, tip is
     * `getLatestBlock(forkId)` per peer.
     */
    blockHashInStorage?: Hash;
    /**
     * When true, require `didEveryoneSignBlock` (participants union) on the agreement target block
     * for each peer. Which block that is depends on `blockHashInStorage` and `minHeight`; see type doc.
     */
    waitForFinalization?: boolean;
    /**
     * Minimum tip height before success. Also pins which height is checked for finalization when
     * `blockHashInStorage` is omitted and `waitForFinalization` is true; see type doc.
     */
    minHeight?: number;
};

/**
 * Handles synchronization operations and assertions for test peers.
 * Provides both async waiting and synchronous checking methods.
 */
export class SyncCoordinator {
    private logger: Logger;
    private eventBarrier: EventBarrier;

    constructor(logger: Logger, eventBarrier: EventBarrier) {
        this.logger = logger.child({ component: "SyncCoordinator" });
        this.eventBarrier = eventBarrier;
    }

    /**
     * Wait until all peers share the same tip (hash + height), optionally at least `minHeight`,
     * and optionally until union agreement (`didEveryoneSignBlock`) on the agreement target.
     * @see {@link WaitForPeersToSyncOptions} for how options combine.
     */
    public async waitForPeersToSync(
        peers: TestPeer[],
        forkId: ForkId,
        options?: WaitForPeersToSyncOptions
    ): Promise<void> {
        const {
            timeoutMs = 8000,
            blockHashInStorage,
            waitForFinalization = false,
            minHeight
        } = options || {};

        // One load per check: each peer's tip (by hash or latest on fork).
        const loadTipBlocks = (): (Block | undefined)[] =>
            peers.map((peer) =>
                blockHashInStorage
                    ? peer.stateManager.storage.blocks.getBlock(
                          blockHashInStorage
                      )
                    : peer.stateManager.storage.blocks.getLatestBlock(forkId)
            );

        /**
         * Blocks to pass to `didEveryoneSignBlock` per peer. `tipHeight` is the synced tip
         * height (caller supplies it explicitly); compare to `minHeight` from options to
         * decide whether the agreement target is the tip or an older block.
         *
         * - Hash or no minHeight → same as tip (one block per peer, already loaded).
         * - minHeight only, tipHeight === minHeight → same as tip (no second lookup).
         * - minHeight only, tipHeight > minHeight → `getBlock(forkId, minHeight)` per peer.
         */
        const blocksForAgreementWait = (
            tipBlocks: Block[],
            tipHeight: number
        ): Block[] | undefined => {
            const onlyMinHeight =
                blockHashInStorage == null && minHeight !== undefined;

            if (!onlyMinHeight || tipHeight === minHeight) {
                return tipBlocks;
            }

            const atPinnedHeight = peers.map((peer) =>
                peer.stateManager.storage.blocks.getBlock(forkId, minHeight!)
            );
            if (atPinnedHeight.some((b) => b === undefined)) return undefined;
            const expectedHash = atPinnedHeight[0]!.hash;
            if (!atPinnedHeight.every((b) => b!.hash === expectedHash))
                return undefined;
            return atPinnedHeight as Block[];
        };

        this.logger.verbose(`Waiting for ${peers.length} peers to sync`, {
            forkId,
            timeout: timeoutMs,
            peerIndices: peers.map((p) => p.index),
            useEventBarrier: !!this.eventBarrier,
            minHeight
        });

        const checkSync = async () => {
            if (peers.length === 0) return true;

            const blockAtTip = loadTipBlocks();

            if (blockAtTip.some((b) => b === undefined)) {
                if (blockAtTip.every((b) => b === undefined)) return true;
                return false;
            }

            const tipBlocks = blockAtTip as Block[];
            const firstHash = tipBlocks[0].hash;
            const firstHeight = tipBlocks[0].height;

            if (
                !tipBlocks.every(
                    (b) => b.hash === firstHash && b.height === firstHeight
                )
            ) {
                return false;
            }

            if (minHeight !== undefined && firstHeight < minHeight) {
                return false;
            }

            if (waitForFinalization) {
                const agreementBlocks = blocksForAgreementWait(
                    tipBlocks,
                    firstHeight
                );
                if (!agreementBlocks) return false;
                for (let i = 0; i < peers.length; i++) {
                    if (
                        !peers[
                            i
                        ].stateManager.agreementManager.didEveryoneSignBlock(
                            agreementBlocks[i]
                        )
                    ) {
                        return false;
                    }
                }
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

        const tipMaybe = loadTipBlocks();
        const agreementBlocks =
            waitForFinalization && tipMaybe.every((b) => b)
                ? blocksForAgreementWait(
                      tipMaybe as Block[],
                      tipMaybe[0]!.height
                  )
                : undefined;

        const peerStates = peers.map((peer, i) => {
            const block = tipMaybe[i];
            const base = block
                ? `hash=${block.hash} height=${block.height}`
                : "no_block";
            let fin = "";
            if (waitForFinalization && agreementBlocks?.[i]) {
                const fb = agreementBlocks[i];
                const ok =
                    peer.stateManager.agreementManager.didEveryoneSignBlock(fb);
                const union = peer.stateManager.storage.getParticipantsUnion(
                    fb.coordinates,
                    fb.stateSnapshotHash
                ).length;
                fin = ` finalize@h=${fb.height} ok=${ok} sigs=${fb.allSignatures.size}/${union}`;
            }
            return `Peer ${peer.index}: ${base}${fin}`;
        });

        let reason = "";
        const latest = tipMaybe[0];
        if (minHeight !== undefined) {
            reason = ` (expected height ${minHeight}, have ${latest?.height ?? "?"})`;
        }
        if (waitForFinalization && agreementBlocks?.[0]) {
            const fb = agreementBlocks[0];
            const union = peers[0].stateManager.storage.getParticipantsUnion(
                fb.coordinates,
                fb.stateSnapshotHash
            ).length;
            const allOk = agreementBlocks.every((block, i) =>
                peers[i].stateManager.agreementManager.didEveryoneSignBlock(
                    block
                )
            );
            reason += ` (finalization@h=${fb.height}: allPeers=${allOk} sigs=${fb.allSignatures.size} union=${union})`;
        } else if (waitForFinalization) {
            reason +=
                " (finalization: block missing or peers disagree on block at target height)";
        }
        const syncError = new Error(
            `Peers at indices [${peers.map((p) => p.index).join(", ")}] failed to synchronize within ${timeoutMs}ms${reason}. States: ${peerStates.join("; ")}`
        ) as EventBarrierCapturedError;
        syncError.capturedBarrierStack = barrierError?.capturedBarrierStack;
        throw syncError;
    }
}

export default SyncCoordinator;
