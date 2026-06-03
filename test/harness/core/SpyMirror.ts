import type { EventBarrier } from "@/utils";

export type SpyMirrorFramePayload = {
    peerIndex: number;
    name: string;
    count: number;
    lastArgs: readonly unknown[];
};

type MirrorSlot = {
    count: number;
    resetAt: number;
    lastArgs: readonly unknown[] | undefined;
    history: (readonly unknown[])[];
};

export class SpyMirror {
    private rows = new Map<number, Map<string, MirrorSlot>>();

    constructor(private readonly eventCountsBarrier: EventBarrier) {}

    ingest(payload: SpyMirrorFramePayload): void {
        const row =
            this.rows.get(payload.peerIndex) ?? new Map<string, MirrorSlot>();
        const slot = row.get(payload.name) ?? {
            count: 0,
            resetAt: 0,
            lastArgs: undefined,
            history: []
        };
        if (payload.count > slot.count) {
            slot.history.push(payload.lastArgs);
        }
        if (payload.count >= slot.count) {
            slot.count = payload.count;
            slot.lastArgs = payload.lastArgs;
        }
        row.set(payload.name, slot);
        this.rows.set(payload.peerIndex, row);
        void this.eventCountsBarrier.signal();
    }

    reset(peerIndex: number, name: string): void {
        const slot = this.rows.get(peerIndex)?.get(name);
        if (!slot) return;
        slot.resetAt = slot.count;
        slot.lastArgs = undefined;
        slot.history = [];
    }

    getCount(peerIndex: number, name: string): number {
        const slot = this.rows.get(peerIndex)?.get(name);
        return slot ? slot.count - slot.resetAt : 0;
    }

    getLastArgs(
        peerIndex: number,
        name: string
    ): readonly unknown[] | undefined {
        return this.rows.get(peerIndex)?.get(name)?.lastArgs;
    }

    getHistory(
        peerIndex: number,
        name: string
    ): readonly (readonly unknown[])[] {
        return this.rows.get(peerIndex)?.get(name)?.history ?? [];
    }
}

export interface WorkerEventSpy {
    readonly callCount: number;
    readonly lastCall: { args: readonly unknown[] } | undefined;
    resetHistory(): void;
    getCalls(): readonly { args: readonly unknown[] }[];
}

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
            mirror.reset(peerIndex, name);
        },
        getCalls() {
            return mirror.getHistory(peerIndex, name).map((args) => ({ args }));
        }
    };
}
