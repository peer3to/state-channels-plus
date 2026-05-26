// W4 - orchestrator-side spy mirror. ingests {topic:"spy"} push frames,
// stores per-peer (name -> {count, lastArgs}), wakes the harness-wide
// eventCountsBarrier so EventActions.waitForEventCounts resumes.
//
// W4 D-12 - EventBarrier stays orchestrator-side, untouched. mirror writes
//           signal the barrier; other barriers stay orchestrator-local.
// W4 §reset - noteReset is package-private to W4 / PeerHandle. only
//             WorkerPeer.resetSpies() calls it, after the rpc round-trip.

import type { EventBarrier } from "@/utils";

export type SpyMirrorFramePayload = {
    peerIndex: number;
    name: string;
    count: number;
    lastArgs: readonly unknown[];
};

type MirrorSlot = {
    count: number;
    lastArgs: readonly unknown[] | undefined;
};

export class SpyMirror {
    private rows = new Map<number, Map<string, MirrorSlot>>();

    constructor(private readonly eventCountsBarrier: EventBarrier) {}

    // step 1 - W3 routes every {topic:"spy"} push frame here.
    // count carries a post-increment value -> max() converges even with
    // re-delivery or out-of-order frames (fifo means usually just assign).
    // lastArgs follows the count; on >= we overwrite (== keeps the latest
    // args under redelivery without losing the most-recent tuple).
    ingest(payload: SpyMirrorFramePayload): void {
        const row =
            this.rows.get(payload.peerIndex) ?? new Map<string, MirrorSlot>();
        const slot = row.get(payload.name) ?? {
            count: 0,
            lastArgs: undefined
        };
        if (payload.count >= slot.count) {
            slot.count = payload.count;
            slot.lastArgs = payload.lastArgs;
        }
        row.set(payload.name, slot);
        this.rows.set(payload.peerIndex, row);
        // step 1 - wake the existing harness barrier.
        void this.eventCountsBarrier.signal();
    }

    getCount(peerIndex: number, name: string): number {
        return this.rows.get(peerIndex)?.get(name)?.count ?? 0;
    }

    getLastArgs(
        peerIndex: number,
        name: string
    ): readonly unknown[] | undefined {
        return this.rows.get(peerIndex)?.get(name)?.lastArgs;
    }

    // step 1 - package-private. only WorkerPeer.resetSpies() invokes it,
    // and only after the rpc round-trip resolves (fifo guarantees prior
    // pushes have landed). zeroes the row in place; subsequent push frames
    // overwrite via max() from the new baseline.
    noteReset(peerIndex: number): void {
        this.rows.get(peerIndex)?.clear();
    }
}

export class WorkerSpyUnsupportedError extends Error {
    constructor(name: string, member: string) {
        super(
            `WorkerEventSpy.${member} is inline-only (W4 D-14). ` +
                `spy '${name}' cannot expose per-call history in worker mode; ` +
                `restrict the scenario to inline peers or add per-call args ` +
                `propagation to the spy push frame.`
        );
        this.name = "WorkerSpyUnsupportedError";
    }
}

// step 1 - synthetic spy shape that mirrors the sinon members tests read.
// inline peers return real sinon.SinonSpy (structurally compatible); worker
// peers return one of these per event-name, backed by the mirror.
// see W4 §one-class EventActions audit table.
export interface WorkerEventSpy {
    readonly callCount: number;
    readonly lastCall: { args: readonly unknown[] } | undefined;
    resetHistory(): void;
    getCalls(): readonly { args: readonly unknown[] }[];
}

// step 1 - build a WorkerEventSpy backed by a SpyMirror for a given (peer, name).
// resetHistory is a no-op here; real clearing happens in WorkerPeer.resetSpies()
// via the rpc + noteReset pair.
export function makeWorkerEventSpy(
    mirror: SpyMirror,
    peerIndex: number,
    name: string
): WorkerEventSpy {
    return {
        get callCount() {
            return mirror.getCount(peerIndex, name);
        },
        get lastCall() {
            const args = mirror.getLastArgs(peerIndex, name);
            return args === undefined ? undefined : { args };
        },
        resetHistory() {
            // step 1 - no-op. WorkerPeer.resetSpies() owns the rpc + noteReset
            // ordering. calling resetHistory() directly on a worker spy is a
            // partial reset; the action surface routes through resetSpies().
        },
        getCalls(): never {
            throw new WorkerSpyUnsupportedError(name, "getCalls");
        }
    };
}
