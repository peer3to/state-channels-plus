// Worker-side spy registry: counts events and pushes frames to the orchestrator.

import type { PeerHandler } from "../rpc/rpc-server";

export type EventName = string;

export type SpyPushFrame = {
    kind: "push";
    topic: "spy";
    peerIndex: number;
    payload: {
        name: EventName;
        count: number;
        lastArgs: readonly unknown[];
    };
};

export const SPY_PUSH_TOPIC = "spy";
export const SPY_RESET_RPC = "spy.reset";

export class SpyRegistry {
    private counts = new Map<EventName, number>();

    constructor(
        private readonly peerIndex: number,
        private readonly server: PeerHandler
    ) {}

    bump(name: EventName, args: readonly unknown[]): void {
        const c = (this.counts.get(name) ?? 0) + 1;
        this.counts.set(name, c);
        this.server.push(SPY_PUSH_TOPIC, {
            peerIndex: this.peerIndex,
            name,
            count: c,
            lastArgs: args
        });
    }

    reset(): void {
        this.counts.clear();
    }

    register(): void {
        this.server.register(SPY_RESET_RPC, async () => {
            this.reset();
            return {};
        });
    }
}
