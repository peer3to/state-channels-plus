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

// step 1 - worker-mode hook: async tip + finalization probes per peer. when
// set, SyncCoordinator routes reads through these instead of the live
// `peer.stateManager.*` (which doesn't exist on worker peers). inline mode
// leaves this undefined and keeps the sync reads.
export type SyncProbe = {
    loadTip: (peerIndex: number, forkId: ForkId) => Promise<Block | undefined>;
    didEveryoneSignBlock: (
        peerIndex: number,
        blockHash: string
    ) => Promise<boolean>;
};

/**
 * Handles synchronization operations and assertions for test peers.
 * Provides both async waiting and synchronous checking methods.
 */
export class SyncCoordinator {
    private logger: Logger;
    private eventBarrier: EventBarrier;
    private probe?: SyncProbe;

    constructor(logger: Logger, eventBarrier: EventBarrier) {
        this.logger = logger.child({ component: "SyncCoordinator" });
        this.eventBarrier = eventBarrier;
    }

    // step 1 - inject a worker-mode probe. one-shot setter; PeerTestHarness
    // wires this immediately after creating the syncCoordinator when
    // dedicatedPeerThread=true.
    setProbe(probe: SyncProbe): void {
        this.probe = probe;
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

        const probe = this.probe;
        const loadTips = async (): Promise<(Block | undefined)[]> => {
            if (probe) {
                return Promise.all(
                    peers.map((peer) => probe.loadTip(peer.index, forkId))
                );
            }
            return peers.map((peer) =>
                peer.stateManager.storage.blocks.getLatestBlock(forkId)
            );
        };

        const checkSync = async () => {
            if (peers.length === 0) return true;

            const tipBlocks = await loadTips();

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
                    if (probe) {
                        const ok = await probe.didEveryoneSignBlock(
                            peers[i].index,
                            String(blocks[i].hash)
                        );
                        if (!ok) return false;
                    } else if (
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

        const tipMaybe = await loadTips();

        // step 1 - in worker mode the live `peer.stateManager.*` reads below
        // are not safe (no in-thread record). degrade diagnostics to tip-only
        // info; finalization detail loses the union count which lives only
        // inside the worker isolate.
        const peerStates = peers.map((peer, i) => {
            const block = tipMaybe[i];
            const base = block
                ? `hash=${block.hash} height=${block.height}`
                : "no_block";
            if (probe) return `Peer ${peer.index}: ${base}`;
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
        if (waitForFinalization && latest && !probe) {
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
