//@ts-ignore
import Hyperswarm from "hyperswarm";
//@ts-ignore
//@ts-ignore
import type P2PManager from "@/P2PManager";
import { HolepunchTransport, TransportType } from "@/transport";
import { Buffer } from "buffer";
import HolepunchRelay from "@/HolepunchRelay";
import { config } from "@/utils/config";

class Holepunch {
    swarm: any;
    p2pManager: P2PManager;
    // Keyed by topic.toString("hex") so byte-identical topics from separate
    // Buffer instances dedupe instead of accumulating on every join() call.
    topics: Map<string, Buffer> = new Map();
    connectionCount = 0;
    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        const setup = () => {
            this.swarm.removeAllListeners(["connection"]); // since hyperwarm is injected into the runtime, creating a new Holepunch object still holds the same refrence to hyperwarm
            this.swarm.on("connection", (socket: any, info: any) => {
                this.p2pManager.logger.info("New holepunch peer connection", {
                    connectionCount: ++this.connectionCount,
                    transportType: "HOLEPUNCH"
                });
                this.p2pManager.logger.debug("Holepunch peer info", {
                    peerInfo: info
                });
                new HolepunchTransport(socket, info, this.p2pManager);
            });
            this.rejoinTopics();
        };

        // `window` is absent in a Web Worker, so RUN_SDK_IN_THREAD (Holepunch
        // running inside the SDK's browser worker) must also detect the worker
        // scope — otherwise it falls through to the node path and
        // `@hyperswarm/dht` throws "not supported in browsers". Mirrors
        // isWorkerRuntime() in WebRTCSetup/connection/WebRTCProvider.ts.
        const browserGlobal = globalThis as any;
        const isBrowserRuntime =
            typeof window !== "undefined" ||
            (typeof browserGlobal.WorkerGlobalScope !== "undefined" &&
                browserGlobal instanceof browserGlobal.WorkerGlobalScope);
        if (isBrowserRuntime) {
            this.p2pManager.logger.info("Using browser Hyperswarm relay");
            p2pManager.preferredTransport = TransportType.WEBRTC;
            const relayerUrls = config.HOLEPUNCH_RELAYER_URLS;
            const relayerUpdateCallback = () => {
                const swarm = HolepunchRelay.getInstance().getSwarm();
                this.swarm = browserGlobal.Hyperswarm || swarm;
                setup();
            };
            HolepunchRelay.init(
                relayerUrls,
                relayerUpdateCallback,
                this.p2pManager.logger
            );
        } else {
            // @ts-ignore
            this.swarm = global.Hyperswarm || new Hyperswarm();
            setup();
        }
    }
    //Mark resources for garbage collection
    public async dispose() {
        this.leaveTopics();
        if (typeof this.swarm?.destroy === "function") {
            await Promise.resolve(this.swarm.destroy());
            return;
        }
        if (typeof this.swarm?.close === "function") {
            await Promise.resolve(this.swarm.close());
        }
    }
    public async join(topic: Buffer) {
        // Re-register on every call (harmless-but-safe) since rejoinTopics
        // already re-registers everything on every relay update anyway.
        this.topics.set(topic.toString("hex"), topic);
        this.swarm.join(topic, {
            server: true,
            client: true
        });
        this.p2pManager.logger.debug("Joined holepunch topic", {
            topic: topic.toString("hex")
        });
        return;
    }

    private rejoinTopics() {
        for (const topic of this.topics.values()) {
            this.swarm.join(topic, {
                server: true,
                client: true
            });
            this.p2pManager.logger.debug("Joined holepunch topic", {
                topic: topic.toString("hex")
            });
        }
    }

    private leaveTopics() {
        for (const topic of this.topics.values()) {
            this.swarm.leave(topic);
            this.p2pManager.logger.debug("Left holepunch topic", {
                topic: topic.toString("hex")
            });
        }
        this.topics.clear();
    }
}

export default Holepunch;
