import type P2PManager from "@/P2PManager";
import { TransportType } from "@/transport";
import { config } from "@/utils/config";

import { HolepunchRelay } from "../HolepunchRelay";
import type {
    HolepunchRuntime,
    HolepunchSwarm,
    HolepunchSwarmUpdate
} from "../HolepunchTypes";
import { BrowserHolepunchRelayConnectionFactory } from "./HolepunchRelayConnectionFactory";

export class BrowserHolepunchRuntime implements HolepunchRuntime {
    private readonly borrowedSwarm?: HolepunchSwarm;
    private readonly relay?: HolepunchRelay;
    private readonly onSwarm: HolepunchSwarmUpdate;
    private started = false;
    private disposed = false;
    private disposalPromise?: Promise<void>;

    public constructor(p2pManager: P2PManager, onSwarm: HolepunchSwarmUpdate) {
        const runtimeGlobal = globalThis as typeof globalThis & {
            Hyperswarm?: HolepunchSwarm;
        };
        this.borrowedSwarm = runtimeGlobal.Hyperswarm;
        this.onSwarm = onSwarm;

        p2pManager.logger.info("Using browser Hyperswarm relay");
        p2pManager.preferredTransport = TransportType.WEBRTC;
        if (!this.borrowedSwarm) {
            this.relay = new HolepunchRelay(
                config.HOLEPUNCH_RELAYER_URLS,
                onSwarm,
                new BrowserHolepunchRelayConnectionFactory(),
                p2pManager.logger
            );
        }
    }

    public start(): void {
        if (this.started || this.disposed) {
            return;
        }
        this.started = true;
        if (this.borrowedSwarm) {
            this.onSwarm(this.borrowedSwarm);
            return;
        }
        this.relay?.start();
    }

    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }
        this.disposed = true;
        this.disposalPromise = this.relay?.dispose() ?? Promise.resolve();
        return this.disposalPromise;
    }
}

export function createHolepunchRuntime(
    p2pManager: P2PManager,
    onSwarm: HolepunchSwarmUpdate
): HolepunchRuntime {
    return new BrowserHolepunchRuntime(p2pManager, onSwarm);
}
