import { ForkId } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";
import type { TestPeer } from "@test/harness/core/types";
import type { Block } from "@/models";

export type WaitForPeersToSyncOptions = {
    timeoutMs?: number;
    minHeight?: number;
    waitForFinalization: boolean;
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
     * Wait until all peers share the same tip (hash + height), optionally requiring
     * the tip to be at least `minHeight`, and optionally requiring union agreement
     * (`didEveryoneSignBlock`) on that tip.
     */
    public async waitForPeersToSync(
        peers: TestPeer[],
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

        const loadTips = (): (Block | undefined)[] =>
            peers.map((peer) =>
                peer.stateManager.storage.blocks.getLatestBlock(forkId)
            );

        const checkSync = async () => {
            if (peers.length === 0) return true;

            const tipBlocks = loadTips();

            if (tipBlocks.some((b) => b === undefined)) {
                if (tipBlocks.every((b) => b === undefined)) return true;
                return false;
            }

            const blocks = tipBlocks as Block[];
            const { hash, height } = blocks[0];

            if (!blocks.every((b) => b.hash === hash && b.height === height)) {
                return false;
            }

            if (minHeight !== undefined && height < minHeight) {
                return false;
            }

            if (waitForFinalization) {
                for (let i = 0; i < peers.length; i++) {
                    if (
                        !peers[
                            i
                        ].stateManager.agreementManager.didEveryoneSignBlock(
                            blocks[i]
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

        const tipMaybe = loadTips();

        const peerStates = peers.map((peer, i) => {
            const block = tipMaybe[i];
            const base = block
                ? `hash=${block.hash} height=${block.height}`
                : "no_block";
            let fin = "";
            if (waitForFinalization && block) {
                const ok =
                    peer.stateManager.agreementManager.didEveryoneSignBlock(
                        block
                    );
                const union = peer.stateManager.storage.getParticipantsUnion(
                    block.coordinates,
                    block.stateSnapshotHash
                ).length;
                fin = ` finalize@h=${block.height} ok=${ok} sigs=${block.allSignatures.size}/${union}`;
            }
            return `Peer ${peer.index}: ${base}${fin}`;
        });

        let reason = "";
        const latest = tipMaybe[0];
        if (minHeight !== undefined) {
            reason = ` (expected height ${minHeight}, have ${latest?.height ?? "?"})`;
        }
        if (waitForFinalization && latest) {
            const union = peers[0].stateManager.storage.getParticipantsUnion(
                latest.coordinates,
                latest.stateSnapshotHash
            ).length;
            const allOk = tipMaybe.every(
                (block, i) =>
                    block &&
                    peers[i].stateManager.agreementManager.didEveryoneSignBlock(
                        block
                    )
            );
            reason += ` (finalization@h=${latest.height}: allPeers=${allOk} sigs=${latest.allSignatures.size} union=${union})`;
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
