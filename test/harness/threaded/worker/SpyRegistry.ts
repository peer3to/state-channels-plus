// Worker-side spy registry: counts events and pushes frames to the orchestrator.

import type { PeerHandler } from "../rpc/rpc-server";

import { PUSH_TOPICS, ROUTES } from "./routeNames";

export type EventName = string;

export type SpyPushFrame = {
    kind: "push";
    topic: typeof PUSH_TOPICS.spy;
    peerIndex: number;
    payload: {
        name: EventName;
        count: number;
        lastArgs: readonly unknown[];
    };
};

export class SpyRegistry {
    private counts = new Map<EventName, number>();

    constructor(
        private readonly peerIndex: number,
        private readonly server: PeerHandler
    ) {}

    bump(name: EventName, args: readonly unknown[]): void {
        const c = (this.counts.get(name) ?? 0) + 1;
        this.counts.set(name, c);
        this.server.push(PUSH_TOPICS.spy, {
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
        this.server.register(ROUTES.spy.reset, async () => {
            this.reset();
            return {};
        });
    }
}
