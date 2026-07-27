import { Buffer } from "buffer";

import type P2PManager from "@/P2PManager";
import { HolepunchTransport } from "@/transport";
import { createHolepunchRuntime } from "@platform/HolepunchRuntime";

import type {
    HolepunchConnectionListener,
    HolepunchRuntime,
    HolepunchSwarm,
    TopicKey
} from "./HolepunchTypes";

class Holepunch {
    private readonly p2pManager: P2PManager;
    private readonly topics = new Map<TopicKey, Buffer>();
    private readonly runtime: HolepunchRuntime;
    private swarm?: HolepunchSwarm;
    private connectionCount = 0;
    private disposed = false;
    private disposalPromise?: Promise<void>;
    private readonly connectionListener: HolepunchConnectionListener = (
        socket,
        info
    ) => {
        this.p2pManager.logger.info("New holepunch peer connection", {
            connectionCount: ++this.connectionCount,
            transportType: "HOLEPUNCH"
        });
        this.p2pManager.logger.debug("Holepunch peer info", {
            peerInfo: info
        });
        new HolepunchTransport(socket, info, this.p2pManager);
    };

    public constructor(p2pManager: P2PManager) {
        this.p2pManager = p2pManager;
        this.runtime = createHolepunchRuntime(
            p2pManager,
            this.updateSwarm.bind(this)
        );
        this.runtime.start();
    }

    //Mark resources for garbage collection
    public dispose(): Promise<void> {
        if (this.disposalPromise) {
            return this.disposalPromise;
        }

        this.disposed = true;
        this.disposalPromise = (async () => {
            await this.leaveTopics();
            this.detachConnectionListener(this.swarm);
            this.swarm = undefined;
            await this.runtime.dispose();
        })();
        return this.disposalPromise;
    }

    public async join(topic: Buffer): Promise<void> {
        if (this.disposed) {
            return;
        }

        const topicKey: TopicKey = topic.toString("hex");
        if (this.topics.has(topicKey)) {
            return;
        }
        this.topics.set(topicKey, topic);
        this.joinTopic(this.swarm, topic);
    }

    private updateSwarm(swarm: HolepunchSwarm): void {
        if (this.disposed || this.swarm === swarm) {
            return;
        }

        this.detachConnectionListener(this.swarm);
        this.swarm = swarm;
        swarm.on("connection", this.connectionListener);
        this.rejoinTopics();
    }

    private detachConnectionListener(swarm?: HolepunchSwarm): void {
        swarm?.off("connection", this.connectionListener);
    }

    private joinTopic(swarm: HolepunchSwarm | undefined, topic: Buffer): void {
        if (!swarm) {
            return;
        }
        swarm.join(topic, {
            server: true,
            client: true
        });
        this.p2pManager.logger.debug("Joined holepunch topic", {
            topic: topic.toString("hex")
        });
    }

    private rejoinTopics(): void {
        for (const topic of this.topics.values()) {
            this.joinTopic(this.swarm, topic);
        }
    }

    private async leaveTopics(): Promise<void> {
        const leavePromises: Promise<unknown>[] = [];
        for (const topic of this.topics.values()) {
            if (this.swarm) {
                leavePromises.push(Promise.resolve(this.swarm.leave(topic)));
            }
            this.p2pManager.logger.debug("Left holepunch topic", {
                topic: topic.toString("hex")
            });
        }
        this.topics.clear();
        await Promise.all(leavePromises);
    }
}

export default Holepunch;
