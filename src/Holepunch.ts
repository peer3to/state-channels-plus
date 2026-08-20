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
    topics: Buffer[] = [];
    connectionCount = 0;
    private readonly isBrowserRuntime: boolean;
    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;

        // `window` is absent in a Web Worker, so RUN_SDK_IN_THREAD (Holepunch
        // running inside the SDK's browser worker) must also detect the worker
        // scope — otherwise it falls through to the node path and
        // `@hyperswarm/dht` throws "not supported in browsers". Mirrors
        // isWorkerRuntime() in WebRTCSetup/connection/WebRTCProvider.ts.
        const browserGlobal = globalThis as any;
        this.isBrowserRuntime =
            typeof window !== "undefined" ||
            (typeof browserGlobal.WorkerGlobalScope !== "undefined" &&
                browserGlobal instanceof browserGlobal.WorkerGlobalScope);
        if (this.isBrowserRuntime) {
            this.p2pManager.logger.info("Using browser Hyperswarm relay");
            p2pManager.preferredTransport = TransportType.WEBRTC;
            const relayerUrls = config.HOLEPUNCH_RELAYER_URLS;
            const relayerUpdateCallback = () => {
                const swarm = HolepunchRelay.getInstance().getSwarm();
                this.swarm = browserGlobal.Hyperswarm || swarm;
                this.setupSwarm();
            };
            HolepunchRelay.init(
                relayerUrls,
                relayerUpdateCallback,
                this.p2pManager.logger
            );
        }
        // Node: the swarm is created lazily on the first join(). An eagerly
        // created Hyperswarm owns a live DHT socket (native utp udp/poll
        // handles) even when the local debug transport is active and no topic
        // is ever joined — and unclosed native handles abort worker teardown
        // at uv_loop_close (see evm/node/workerShutdown.ts).
    }

    private setupSwarm() {
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
    }

    private ensureNodeSwarm() {
        if (this.swarm || this.isBrowserRuntime) return;
        // @ts-ignore
        this.swarm = global.Hyperswarm || new Hyperswarm();
        this.setupSwarm();
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
        this.ensureNodeSwarm();
        this.topics.push(topic);
        this.swarm.join(topic, {
            server: true,
            client: true
        });
        this.p2pManager.logger.debug("Joined holepunch topic", {
            topic: topic.toString("hex")
        });
        return;
    }

    public async leave(topic: Buffer) {
        const index = this.topics.findIndex((joinedTopic) =>
            joinedTopic.equals(topic)
        );
        if (index === -1) return;
        this.topics.splice(index, 1);
        if (!this.swarm) return;
        await Promise.resolve(this.swarm.leave(topic));
        this.p2pManager.logger.debug("Left holepunch topic", {
            topic: topic.toString("hex")
        });
    }

    private rejoinTopics() {
        for (const topic of this.topics) {
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
        for (const topic of this.topics) {
            this.swarm.leave(topic);
            this.p2pManager.logger.debug("Left holepunch topic", {
                topic: topic.toString("hex")
            });
        }
        this.topics = [];
    }
}

export default Holepunch;
