import HolepunchRelay from "@/HolepunchRelay";
import type P2PManager from "@/P2PManager";
import type { BannablePeerInfo } from "@/PeerProfile";
import { isWorkerRuntime } from "@/rpc/network/services/WebRTCSetup/connection/WebRTCProvider";
import { HolepunchTransport, TransportType } from "@/transport";
import { config } from "@/utils/config";
import { Buffer } from "buffer";
//@ts-ignore
import Hyperswarm from "hyperswarm";

class Holepunch {
    swarm: any;
    p2pManager: P2PManager;
    topics: Buffer[] = [];
    connectionCount = 0;
    /** When each joined topic was last announced, for the discovery timing logs. */
    private readonly announcedAtMs = new Map<string, number>();
    private lastAttemptedCount = 0;
    /** Bound once, so `off` removes only this listener from a shared swarm. */
    private readonly onSwarmUpdate = () => this.logConnectionAttempts();
    private readonly isBrowserRuntime: boolean;
    /** The browser relay this instance started; absent in Node. */
    private relay?: HolepunchRelay;
    constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;

        // `window` is absent in a Web Worker, so RUN_SDK_IN_THREAD (Holepunch
        // running inside the SDK's browser worker) must also detect the worker
        // scope — otherwise it falls through to the node path and
        // `hyperdht` throws "not supported in browsers".
        this.isBrowserRuntime =
            typeof window !== "undefined" || isWorkerRuntime();
        if (this.isBrowserRuntime) {
            this.p2pManager.logger.info("Using browser Hyperswarm relay");
            p2pManager.preferredTransport = TransportType.WEBRTC;
            const relayerUrls = config.HOLEPUNCH_RELAYER_URLS;
            const relayerUpdateCallback = () => {
                this.swarm?.off("update", this.onSwarmUpdate);
                const swarm = HolepunchRelay.getInstance().getSwarm();
                this.swarm = (globalThis as any).Hyperswarm || swarm;
                this.setupSwarm();
            };
            this.relay = HolepunchRelay.init(
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

    //Mark resources for garbage collection
    public async dispose() {
        this.relay?.dispose();
        this.leaveTopics();
        this.swarm?.off("update", this.onSwarmUpdate);
        const teardown = Promise.resolve(
            typeof this.swarm?.destroy === "function"
                ? this.swarm.destroy()
                : this.swarm?.close?.()
        );
        // Browser: the relay is closed, so the teardown never gets its replies.
        if (this.relay) void teardown.catch(() => undefined);
        else await teardown;
    }
    public async join(topic: Buffer) {
        this.ensureNodeSwarm();
        this.topics.push(topic);
        this.announceTopic(topic);
        return;
    }

    public async leave(topic: Buffer) {
        const index = this.topics.findIndex((joinedTopic) =>
            joinedTopic.equals(topic)
        );
        if (index === -1) return;
        this.topics.splice(index, 1);
        if (!this.topics.some((joinedTopic) => joinedTopic.equals(topic)))
            this.announcedAtMs.delete(topic.toString("hex"));
        if (!this.swarm) return;
        await Promise.resolve(this.swarm.leave(topic));
        this.p2pManager.logger.debug("Left holepunch topic", {
            topic: topic.toString("hex")
        });
    }

    private setupSwarm() {
        this.swarm.removeAllListeners(["connection"]); // since hyperwarm is injected into the runtime, creating a new Holepunch object still holds the same refrence to hyperwarm
        this.swarm.on("connection", (socket: any, info: any) => {
            this.p2pManager.logger.info("New holepunch peer connection", {
                connectionCount: ++this.connectionCount,
                transportType: "HOLEPUNCH",
                isInitiator: socket.isInitiator,
                ...this.getTopicTimings()
            });
            this.p2pManager.logger.debug("Holepunch peer info", {
                peerInfo: info
            });
            new HolepunchTransport(
                socket,
                this.bannablePeerInfo(info),
                this.p2pManager.rpcRouter
            );
        });
        // Only this handler: the swarm can be shared, and Hyperswarm keeps
        // its own `update` listener.
        this.swarm.off("update", this.onSwarmUpdate);
        this.lastAttemptedCount = this.getAttemptedCount();
        this.swarm.on("update", this.onSwarmUpdate);
        this.rejoinTopics();
    }

    /**
     * Hyperswarm has no attempt event: it emits `update` after each outbound
     * dial, and its stats count the dials.
     */
    private logConnectionAttempts(): void {
        const attempted = this.getAttemptedCount();
        if (attempted > this.lastAttemptedCount) {
            this.p2pManager.logger.debug(
                "Holepunch connection attempt started",
                {
                    attempts: attempted - this.lastAttemptedCount,
                    connecting: this.swarm.connecting,
                    knownPeers: this.swarm.peers?.size,
                    ...this.getTopicTimings()
                }
            );
        }
        this.lastAttemptedCount = attempted;
    }

    private getAttemptedCount(): number {
        return this.swarm.stats?.connects?.client?.attempted ?? 0;
    }

    /**
     * Hyperswarm's peer info. Releasing a ban only clears Hyperswarm's flag:
     * a peer whose connection closed while banned has left the retry queue.
     * A lookup of the joined topics finds it again if it is still announced.
     */
    private bannablePeerInfo(info: any): BannablePeerInfo {
        return {
            publicKey: info.publicKey,
            ban: (value = true) => {
                info.ban(value);
                if (!value) this.refreshTopics();
            }
        };
    }

    private ensureNodeSwarm() {
        if (this.swarm || this.isBrowserRuntime) return;
        // @ts-ignore
        this.swarm = global.Hyperswarm || new Hyperswarm();
        this.setupSwarm();
    }

    /**
     * A lookup that runs while another peer's announce is still in flight
     * misses that peer, and Hyperswarm looks up a topic again only every 10
     * minutes. So once this announce is done, the topic is looked up once:
     * of two peers that joined together, the one that finishes later finds
     * the other.
     */
    private announceTopic(topic: Buffer): void {
        const discovery = this.swarm.join(topic, {
            server: true,
            client: true
        });
        const topicHex = topic.toString("hex");
        this.announcedAtMs.set(topicHex, Date.now());
        this.p2pManager.logger.debug("Joined holepunch topic", {
            topic: topicHex
        });
        discovery
            .flushed()
            .then(() => {
                this.p2pManager.logger.debug("Holepunch topic announced", {
                    topic: topicHex,
                    sinceJoinMs: this.getSinceAnnounceMs(topicHex)
                });
                this.refreshTopic(topic);
            })
            .catch((error: unknown) =>
                this.p2pManager.logger.debug("Holepunch announce failed", {
                    topic: topic.toString("hex"),
                    error
                })
            );
    }

    private refreshTopics() {
        for (const topic of this.topics) this.refreshTopic(topic);
    }

    /** One lookup of a still-joined topic; a failed one is retried by Hyperswarm's own refresh. */
    private refreshTopic(topic: Buffer) {
        if (!this.swarm || this.swarm.destroyed) return;
        if (!this.topics.some((joined) => joined.equals(topic))) return;
        const topicHex = topic.toString("hex");
        this.swarm
            .status(topic)
            ?.refresh()
            .then(() =>
                this.p2pManager.logger.debug(
                    "Holepunch topic lookup finished",
                    {
                        topic: topicHex,
                        sinceJoinMs: this.getSinceAnnounceMs(topicHex),
                        knownPeers: this.swarm.peers?.size,
                        connections: this.swarm.connections?.size
                    }
                )
            )
            .catch((error: unknown) =>
                this.p2pManager.logger.debug("Holepunch topic lookup failed", {
                    topic: topic.toString("hex"),
                    error
                })
            );
    }

    private getSinceAnnounceMs(topicHex: string): number | undefined {
        const announcedAtMs = this.announcedAtMs.get(topicHex);
        return announcedAtMs === undefined
            ? undefined
            : Date.now() - announcedAtMs;
    }

    /** Milliseconds since each joined topic was announced. */
    private getTopicTimings(): { sinceJoinMs: Record<string, number> } {
        const sinceJoinMs: Record<string, number> = {};
        for (const topic of this.topics) {
            const topicHex = topic.toString("hex");
            const elapsedMs = this.getSinceAnnounceMs(topicHex);
            if (elapsedMs !== undefined) sinceJoinMs[topicHex] = elapsedMs;
        }
        return { sinceJoinMs };
    }

    private rejoinTopics() {
        for (const topic of this.topics) {
            this.announceTopic(topic);
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
        this.announcedAtMs.clear();
    }
}

export default Holepunch;
