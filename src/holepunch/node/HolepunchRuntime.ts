// @ts-expect-error hyperswarm does not publish TypeScript declarations.
import Hyperswarm from "hyperswarm";

import type P2PManager from "@/P2PManager";
import type {
    HolepunchRuntime,
    HolepunchSwarm,
    HolepunchSwarmUpdate
} from "../HolepunchTypes";

export class NodeHolepunchRuntime implements HolepunchRuntime {
    private readonly swarm: HolepunchSwarm;
    private readonly ownsSwarm: boolean;
    private readonly onSwarm: HolepunchSwarmUpdate;
    private started = false;
    private disposed = false;
    private disposalPromise?: Promise<void>;

    public constructor(onSwarm: HolepunchSwarmUpdate) {
        const runtimeGlobal = globalThis as typeof globalThis & {
            Hyperswarm?: HolepunchSwarm;
        };
        const injectedSwarm = runtimeGlobal.Hyperswarm;
        this.swarm = injectedSwarm ?? new Hyperswarm();
        this.ownsSwarm = injectedSwarm === undefined;
        this.onSwarm = onSwarm;
    }

    public start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        this.onSwarm(this.swarm);
    }

    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }
        this.disposed = true;
        this.disposalPromise = this.ownsSwarm
            ? Promise.resolve(this.swarm.destroy()).then(() => undefined)
            : Promise.resolve();
        return this.disposalPromise;
    }
}

export function createHolepunchRuntime(
    _p2pManager: P2PManager,
    onSwarm: HolepunchSwarmUpdate
): HolepunchRuntime {
    return new NodeHolepunchRuntime(onSwarm);
}
