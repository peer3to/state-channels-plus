// W4 - worker-side spy registry. counts events + pushes frames to the
// orchestrator. one push per bump; orchestrator-side SpyMirror is idempotent
// under max() so re-delivery converges naturally.
//
// W4 D-11 - one push topic ("spy"); lastArgs rides the same frame.
// W4 D-13 - reset is rpc (req/res), not push.
// W0 D-8 - push + pull, same channel.

import type { RpcServer } from "../rpc/rpc-server";

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
        private readonly server: RpcServer
    ) {}

    // step 1 - called from the event-handler proxy on every spied call.
    // post-increment count + lastArgs ride together; orchestrator does max()
    // so re-delivery converges.
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

    // step 1 - rpc handler. orchestrator drives via PeerHandle.resetSpies();
    // two-step (rpc then mirror.noteReset) lives in WorkerPeer per W4 §reset.
    reset(): void {
        this.counts.clear();
    }

    // step 1 - register the reset handler on the worker rpc surface. called
    // by worker entry once during bootstrap.
    register(): void {
        this.server.register(SPY_RESET_RPC, async () => {
            this.reset();
            return {};
        });
    }
}
