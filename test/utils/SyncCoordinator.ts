// @spec-test-coverage-ignore: shared sync-wait utility exercised by owning mapped test declarations
import { ForkId } from "@/types/types";
import { Logger, EventBarrier } from "@/utils";
import type { EventBarrierCapturedError } from "@/utils/EventBarrier";
import type { TestPeer } from "@test/harness/core/types";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";

/** Resolves a peer's typed harness-control RPC proxy (the harness's `control`). */
type ControlFn<TCustomRpc extends HarnessControlRpc> = (
    peer: TestPeer<TCustomRpc>
) => RemoteRpcProxyType<HarnessControlRpc>;

export type WaitForPeersToSyncOptions = {
    timeoutMs?: number;
    minHeight?: number;
    waitForFinalization: boolean;
};

/**
 * Handles synchronization operations and assertions for test peers. Tips are
 * read host-side via each peer's harness-control RPC (the live state manager is
 * behind the runtime port).
 */
export class SyncCoordinator<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    private logger: Logger;
    private eventBarrier: EventBarrier;
    private control: ControlFn<TCustomRpc>;
    private defaultTimeoutMs: number;

    constructor(
        logger: Logger,
        eventBarrier: EventBarrier,
        control: ControlFn<TCustomRpc>,
        defaultTimeoutMs: number
    ) {
        this.logger = logger.child({ component: "SyncCoordinator" });
        this.eventBarrier = eventBarrier;
        this.control = control;
        this.defaultTimeoutMs = defaultTimeoutMs;
    }

    private loadTips(peers: TestPeer<TCustomRpc>[], forkId: ForkId) {
        return Promise.all(
            peers.map((peer) =>
                this.control(peer).query.getSyncTip(forkId).request()
            )
        );
    }

    /**
     * Wait until all peers share the same tip (hash + height) with its
     * snapshot and state-machine state stored, optionally requiring the tip
     * to be at least `minHeight`, and optionally requiring union agreement
     * (`finalized`) on that tip. A block is visible the moment it is stored;
     * its state lands a beat later, so the tip alone is not "in sync".
     */
    public async waitForPeersToSync(
        peers: TestPeer<TCustomRpc>[],
        forkId: ForkId,
        options?: WaitForPeersToSyncOptions
    ): Promise<void> {
        const {
            timeoutMs = this.defaultTimeoutMs,
            waitForFinalization,
            minHeight
        } = options || {};

        this.logger.verbose(`Waiting for ${peers.length} peers to sync`, {
            forkId,
            timeout: timeoutMs,
            peerIndices: peers.map((p) => p.index),
            minHeight
        });

        const checkSync = async () => {
            if (peers.length === 0) return true;

            const tips = await this.loadTips(peers, forkId);
            const present = tips.filter((t) => t !== null);

            if (present.length === 0) return true; // no peer has a tip yet
            if (present.length < tips.length) return false; // only some do

            const { hash, height, stateHash } = present[0];

            if (!present.every((t) => t.hash === hash && t.height === height)) {
                return false;
            }
            if (
                stateHash === null ||
                !present.every((t) => t.stateHash === stateHash)
            ) {
                return false;
            }

            if (minHeight !== undefined && height < minHeight) {
                return false;
            }

            if (waitForFinalization && !present.every((t) => t.finalized)) {
                return false;
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

        const tipMaybe = await this.loadTips(peers, forkId);

        const peerStates = peers.map((peer, i) => {
            const tip = tipMaybe[i];
            const base = tip
                ? `hash=${tip.hash} height=${tip.height} state=${tip.stateHash ?? "missing"}`
                : "no_block";
            let fin = "";
            if (waitForFinalization && tip) {
                fin = ` finalize@h=${tip.height} ok=${tip.finalized} sigs=${tip.signatures}/${tip.union}`;
            }
            return `Peer ${peer.index}: ${base}${fin}`;
        });

        let reason = "";
        const latest = tipMaybe[0];
        if (minHeight !== undefined) {
            // Report the lowest tip: a dead fork shows as one peer stuck below
            // the others, which a single peer's height would hide.
            const heights = tipMaybe.map((tip) => tip?.height);
            const lowest = heights.some((height) => height === undefined)
                ? "?"
                : Math.min(...heights.map((height) => Number(height)));
            reason = ` (expected height ${minHeight}, lowest peer height ${lowest})`;
        }
        if (waitForFinalization && latest) {
            const allOk = tipMaybe.every((tip) => tip && tip.finalized);
            reason += ` (finalization@h=${latest.height}: allPeers=${allOk} sigs=${latest.signatures} union=${latest.union})`;
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
