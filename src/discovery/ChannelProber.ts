import { Buffer } from "buffer";

import { Status } from "@/types";
import type { Address, ChannelId } from "@/types/types";
import type { Logger } from "@/utils";
import { addressesEqual } from "@/utils/address";
import { config } from "@/utils/config";
import type { EventBus } from "@/events/EventBus";

// DEVIATION (approved) — one shared SDK/P2P instance, not one per candidate.
// The original ask was a fixed pool of separate SDK/P2P instances (each
// owning one direct spectate attempt) so up to `concurrency` candidates could
// be probed truly in parallel. Running N `p2pSetup` instances in one process
// is unsafe today: `HolepunchRelay.init()` overwrites a static singleton,
// `Holepunch.setupSwarm()` strips the swarm's existing "connection" listener
// (a second instance on a shared swarm steals the first's), and `p2pSetup` ->
// `createConfig()` mutates a module-level config singleton. One shared
// Hyperswarm was also explicitly wanted so the same peer dedupes to one
// physical connection - which argues for one instance, not many, anyway.
//
// DEVIATION (approved) — concurrency lives in rendezvous, not in sync. A
// `StateManager` holds exactly one active channel: `channelId`/`status` and
// the cascaded `disputeManager`/`eventSyncService`/`stateChannelEventListener`
// scoping are single mutable fields (`StateManager.setChannelId`), and
// `P2PManager.onHandshakeCompleted` auto-fires `spectateService.sync` keyed
// off whatever `channelId` happens to be set at that moment. Two candidates
// can't both be "armed" (connected + syncing) on one instance without racing
// that state. So probing splits into a PARALLEL, stateless rendezvous phase
// (join up to `concurrency` candidate topics on the shared swarm, wait for a
// verified peer - this never touches `StateManager`, which is exactly why it
// stays safe under fan-out) and a SERIALIZED, stateful sync phase (leave
// every other joined topic first, then arm exactly one candidate via the
// existing `connectToChannel` -> wait-for-`SYNCED` path). Do not "optimize"
// this by arming a channel during rendezvous - `onHandshakeCompleted` only
// auto-syncs once a channel is armed and OPEN, so staying unarmed during
// rendezvous is what keeps concurrent topic joins safe.
//
// ATTRIBUTION — hyperswarm leaves `PeerInfo.topics` empty for an inbound
// connection, so a verified handshake can't be attributed to "the candidate
// whose topic it came in on" by transport metadata alone. Attribution instead
// checks identity: once a peer's handshake completes, ask the chain whether
// that address is a participant of the candidate channel still being
// rendezvous'd (`StateManager.getOnChainParticipantUnion`, which takes an
// explicit `channelId` and never touches the shared instance state).

export type ProbeStage = "rendezvous" | "sync";

export type ProbeAttempt = {
    channelId: ChannelId;
    stage: ProbeStage;
    outcome: "ok" | "timeout" | "error";
    reason?: string;
};

export type ProbeResult =
    | {
          status: "usable";
          channelId: ChannelId;
          peerAddress: Address;
          attempts: ProbeAttempt[];
      }
    | { status: "exhausted"; attempts: ProbeAttempt[] };

export type RendezvousResult =
    | { outcome: "verified"; peerAddress: Address }
    | { outcome: "timeout" }
    // Cancelled because a sibling candidate already produced a verified peer
    // - not a failure of this candidate, so the orchestrator requeues it.
    | { outcome: "aborted" }
    | { outcome: "error"; reason: string };

export type SyncResult =
    | { outcome: "synced" }
    | { outcome: "timeout" }
    | { outcome: "error"; reason: string };

/**
 * Injected seam (phase 1): attempt rendezvous for a single candidate.
 * Must resolve within `timeoutMs` or when `signal` aborts, and must leave
 * behind no listener/timer/joined-topic on every exit path.
 */
export type RendezvousAttemptFn = (
    channelId: ChannelId,
    timeoutMs: number,
    signal: AbortSignal
) => Promise<RendezvousResult>;

/**
 * Injected seam (phase 2): arm `channelId` (the only armed candidate at any
 * moment - the orchestrator guarantees no rendezvous is in flight while this
 * runs) and wait for the existing spectate/sync path to reach `SYNCED`.
 */
export type SyncAttemptFn = (
    channelId: ChannelId,
    peerAddress: Address,
    timeoutMs: number,
    signal: AbortSignal
) => Promise<SyncResult>;

/**
 * The narrow slice of `LocalP2pSigner` the default rendezvous/sync
 * implementations need - a real `LocalP2pSigner` satisfies this
 * structurally, and a test can hand in a minimal real object (no mocking
 * framework, no spies) when it also injects its own
 * `rendezvousAttempt`/`syncAttempt` and never exercises the defaults.
 */
export type ChannelProberSigner = {
    connectToChannel(channelId: ChannelId): Promise<void>;
    getChannelStatus(): Promise<Status>;
    p2pManager: {
        holepunch: {
            join(topic: Buffer): Promise<void>;
            leave(topic: Buffer): Promise<void>;
        };
        stateManager: {
            events: EventBus;
            getOnChainParticipantUnion(
                channelId: ChannelId
            ): Promise<Address[]>;
        };
    };
};

export type ChannelProberDeps = {
    signer: ChannelProberSigner;
    logger: Logger;
    events: EventBus;
};

export type ChannelProberOptions = {
    /** Rendezvous fan-out cap. Defaults to config.CHANNEL_PROBE_CONCURRENCY. */
    concurrency?: number;
    /** Per-candidate, per-phase timeout. Defaults to config.CHANNEL_PROBE_TIMEOUT_MS. */
    timeoutMs?: number;
    /** Test seam - see {@link RendezvousAttemptFn}. Defaults to the real Holepunch/chain-backed rendezvous. */
    rendezvousAttempt?: RendezvousAttemptFn;
    /** Test seam - see {@link SyncAttemptFn}. Defaults to the real connect/sync path. */
    syncAttempt?: SyncAttemptFn;
};

/**
 * Probes an ordered (newest-first) list of candidate channel ids and reports
 * the first one that is actually joinable - spectate/sync completed, not
 * merely "a socket connected". See the deviation notes above for why
 * concurrency is bounded to the rendezvous phase only.
 */
export class ChannelProber {
    private readonly signer: ChannelProberSigner;
    private readonly logger: Logger;
    private readonly events: EventBus;
    private readonly concurrency: number;
    private readonly timeoutMs: number;
    private readonly rendezvousAttempt: RendezvousAttemptFn;
    private readonly syncAttempt: SyncAttemptFn;
    // Invariant: at most one candidate is armed (connectToChannel called) at
    // any moment. Enforced defensively in runSync - see the deviation note.
    private armed: ChannelId | undefined;

    constructor(deps: ChannelProberDeps, options: ChannelProberOptions = {}) {
        this.signer = deps.signer;
        this.logger = deps.logger.child({ component: "ChannelProber" });
        this.events = deps.events;
        this.concurrency = Math.max(
            1,
            options.concurrency ?? config.CHANNEL_PROBE_CONCURRENCY
        );
        this.timeoutMs = Math.max(
            0,
            options.timeoutMs ?? config.CHANNEL_PROBE_TIMEOUT_MS
        );
        this.rendezvousAttempt =
            options.rendezvousAttempt ??
            ((channelId, timeoutMs, signal) =>
                this.defaultRendezvousAttempt(channelId, timeoutMs, signal));
        this.syncAttempt =
            options.syncAttempt ??
            ((channelId, peerAddress, timeoutMs, signal) =>
                this.defaultSyncAttempt(
                    channelId,
                    peerAddress,
                    timeoutMs,
                    signal
                ));
    }

    /**
     * Runs the pool over `candidates` (newest-first) and returns the first
     * usable one, plus a per-candidate/per-phase outcome list for
     * observability. Never returns while a candidate is still armed.
     */
    public async probe(candidates: ChannelId[]): Promise<ProbeResult> {
        const attempts: ProbeAttempt[] = [];
        const record = (attempt: ProbeAttempt): void => {
            attempts.push(attempt);
            this.events.emit("discovery", "probeStage", [
                {
                    channelId: String(attempt.channelId),
                    stage: attempt.stage,
                    outcome: attempt.outcome,
                    reason: attempt.reason
                }
            ]);
        };

        const queue = [...candidates];
        for (;;) {
            const winner = await this.runRendezvousPool(queue, record);
            if (!winner) return { status: "exhausted", attempts };

            const synced = await this.runSync(
                winner.channelId,
                winner.peerAddress,
                record
            );
            if (synced) {
                return {
                    status: "usable",
                    channelId: winner.channelId,
                    peerAddress: winner.peerAddress,
                    attempts
                };
            }
            // Sync failed/timed out for the armed candidate - fall through
            // and resume the rendezvous pool over whatever candidates remain
            // (the failed one is not requeued; it got its full timeout).
        }
    }

    /**
     * Phase 1: a worker pool of up to `concurrency` rendezvous attempts over
     * `queue` (mutated in place - candidates it doesn't resolve stay for the
     * next call). Returns as soon as one candidate is verified, but not
     * before every other in-flight attempt has actually settled (its topic
     * left, its listeners removed) - that ordering is what makes "exactly
     * one candidate armed at a time" true rather than merely intended.
     */
    private async runRendezvousPool(
        queue: ChannelId[],
        record: (attempt: ProbeAttempt) => void
    ): Promise<{ channelId: ChannelId; peerAddress: Address } | undefined> {
        let winner: { channelId: ChannelId; peerAddress: Address } | undefined;
        const controllers = new Map<number, AbortController>();
        const active = new Map<number, Promise<void>>();
        let nextWorkerId = 0;

        const runOne = async (
            workerId: number,
            channelId: ChannelId,
            controller: AbortController
        ): Promise<void> => {
            const result = await this.rendezvousAttempt(
                channelId,
                this.timeoutMs,
                controller.signal
            );
            controllers.delete(workerId);
            switch (result.outcome) {
                case "verified":
                    if (!winner) {
                        winner = { channelId, peerAddress: result.peerAddress };
                        record({
                            channelId,
                            stage: "rendezvous",
                            outcome: "ok"
                        });
                        for (const other of controllers.values()) other.abort();
                    } else {
                        // A sibling already won this round. This candidate
                        // still reached a real peer - requeue it instead of
                        // discarding it, so a later round (should the
                        // current winner's sync fail) doesn't waste a fresh
                        // topic join re-proving what we already know.
                        queue.unshift(channelId);
                    }
                    break;
                case "timeout":
                    record({
                        channelId,
                        stage: "rendezvous",
                        outcome: "timeout"
                    });
                    break;
                case "error":
                    record({
                        channelId,
                        stage: "rendezvous",
                        outcome: "error",
                        reason: result.reason
                    });
                    break;
                case "aborted":
                    // Never got a real shot - give it another one later.
                    queue.unshift(channelId);
                    break;
            }
        };

        const spawnNext = (): boolean => {
            if (winner || queue.length === 0) return false;
            const channelId = queue.shift()!;
            const workerId = nextWorkerId++;
            const controller = new AbortController();
            controllers.set(workerId, controller);
            active.set(
                workerId,
                runOne(workerId, channelId, controller).finally(() => {
                    active.delete(workerId);
                })
            );
            return true;
        };

        for (let i = 0; i < this.concurrency; i++) spawnNext();

        while (active.size > 0) {
            await Promise.race(active.values());
            if (!winner) {
                while (active.size < this.concurrency && spawnNext());
            }
        }

        return winner;
    }

    /**
     * Phase 2: arms exactly `channelId` (never while anything else is
     * armed - see the invariant on `armed`) and waits for the existing
     * spectate/sync path to confirm `SYNCED` against `peerAddress`.
     */
    private async runSync(
        channelId: ChannelId,
        peerAddress: Address,
        record: (attempt: ProbeAttempt) => void
    ): Promise<boolean> {
        if (this.armed !== undefined) {
            throw new Error(
                "ChannelProber: invariant violated - a candidate is already armed"
            );
        }
        this.armed = channelId;
        try {
            const controller = new AbortController();
            const result = await this.syncAttempt(
                channelId,
                peerAddress,
                this.timeoutMs,
                controller.signal
            );
            if (result.outcome === "synced") {
                record({ channelId, stage: "sync", outcome: "ok" });
                return true;
            }
            record({
                channelId,
                stage: "sync",
                outcome: result.outcome,
                reason: result.outcome === "error" ? result.reason : undefined
            });
            return false;
        } finally {
            this.armed = undefined;
        }
    }

    // ---- Default (real) seam implementations -----------------------------

    /**
     * Joins `channelId`'s topic on the shared swarm and waits for a
     * handshake whose address is an on-chain participant of THIS candidate.
     * Binds no `StateManager` state - safe to run for several candidates at
     * once. Leaves the topic on every exit path (verified, timeout, abort,
     * error).
     */
    private defaultRendezvousAttempt(
        channelId: ChannelId,
        timeoutMs: number,
        signal: AbortSignal
    ): Promise<RendezvousResult> {
        const holepunch = this.signer.p2pManager.holepunch;
        const topic = Buffer.alloc(32).fill(String(channelId));

        return new Promise<RendezvousResult>((resolve) => {
            let settled = false;
            const finish = (result: RendezvousResult): void => {
                if (settled) return;
                settled = true;
                unsubscribe();
                clearTimeout(timer);
                signal.removeEventListener("abort", onAbort);
                void holepunch.leave(topic).catch((error) => {
                    this.logger.warn(
                        "ChannelProber: failed to leave rendezvous topic",
                        {
                            channelId: String(channelId),
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        }
                    );
                });
                resolve(result);
            };

            const unsubscribe = this.signer.p2pManager.stateManager.events.on(
                "p2pEventHooks",
                "handshakeCompleted",
                (peerAddress) => {
                    void this.isCandidateParticipant(channelId, peerAddress)
                        .then((isParticipant) => {
                            if (isParticipant) {
                                finish({ outcome: "verified", peerAddress });
                            }
                        })
                        .catch((error) => {
                            finish({
                                outcome: "error",
                                reason:
                                    error instanceof Error
                                        ? error.message
                                        : String(error)
                            });
                        });
                }
            );

            const onAbort = (): void => finish({ outcome: "aborted" });
            signal.addEventListener("abort", onAbort);

            const timer = setTimeout(
                () => finish({ outcome: "timeout" }),
                timeoutMs
            );

            void holepunch.join(topic).catch((error) => {
                finish({
                    outcome: "error",
                    reason:
                        error instanceof Error ? error.message : String(error)
                });
            });
        });
    }

    private async isCandidateParticipant(
        channelId: ChannelId,
        peerAddress: Address
    ): Promise<boolean> {
        const participants =
            await this.signer.p2pManager.stateManager.getOnChainParticipantUnion(
                channelId
            );
        return participants.some((participant) =>
            addressesEqual(participant, peerAddress)
        );
    }

    /**
     * Arms `channelId` via the existing `connectToChannel` and waits for the
     * existing spectate/sync path to reach `SYNCED`, bounded by `timeoutMs`
     * and `signal`. Leaves no listener/timer behind on any exit path.
     */
    private async defaultSyncAttempt(
        channelId: ChannelId,
        _peerAddress: Address,
        timeoutMs: number,
        signal: AbortSignal
    ): Promise<SyncResult> {
        try {
            await this.signer.connectToChannel(channelId);
        } catch (error) {
            return {
                outcome: "error",
                reason: error instanceof Error ? error.message : String(error)
            };
        }
        return this.waitForSyncedOrTimeout(timeoutMs, signal);
    }

    private waitForSyncedOrTimeout(
        timeoutMs: number,
        signal: AbortSignal
    ): Promise<SyncResult> {
        return new Promise<SyncResult>((resolve) => {
            let settled = false;
            const finish = (result: SyncResult): void => {
                if (settled) return;
                settled = true;
                unsubscribe();
                clearTimeout(timer);
                signal.removeEventListener("abort", onAbort);
                resolve(result);
            };

            const unsubscribe = this.signer.p2pManager.stateManager.events.on(
                "p2pEventHooks",
                "onStatusChanged",
                (_oldStatus, newStatus) => {
                    if (newStatus >= Status.SYNCED) {
                        finish({ outcome: "synced" });
                    }
                }
            );

            const onAbort = (): void => finish({ outcome: "timeout" });
            signal.addEventListener("abort", onAbort);

            const timer = setTimeout(
                () => finish({ outcome: "timeout" }),
                timeoutMs
            );

            this.signer
                .getChannelStatus()
                .then((current) => {
                    if (current >= Status.SYNCED) finish({ outcome: "synced" });
                })
                .catch((error) => {
                    // Left subscribed: a subsequent real onStatusChanged
                    // transition still resolves this correctly, and the
                    // timeout/abort above is the backstop if it never comes.
                    this.logger.warn(
                        "ChannelProber: getChannelStatus check failed",
                        {
                            error:
                                error instanceof Error
                                    ? error.message
                                    : String(error)
                        }
                    );
                });
        });
    }
}
