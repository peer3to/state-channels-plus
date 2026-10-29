// @spec-test-coverage-ignore: two runtimes on real Hyperswarm over a local DHT testnet, staged for mapped Holepunch discovery tests
import type { RemoteRpcProxyType } from "@/rpc/network/RemoteRpcProxy";
import type { HolepunchSwarmProbe } from "@test/fixtures/customRpc/p2pManagerProbe/P2PManagerProbeService";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import {
    createLocalDhtNetwork,
    type LocalDhtNetwork
} from "@test/fixtures/distributed/testTransport";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { ethers } from "ethers";
import { setTimeout } from "node:timers/promises";

/** Longer than Hyperswarm 4.17's shortest redial backoff plus its jitter (2 s). */
const REDIAL_WINDOW_MS = 3_000;

/**
 * Two runtimes whose Holepunch joins one topic on real Hyperswarm. Their DHT
 * nodes bootstrap from a private testnet on 127.0.0.1, so discovery,
 * announce, lookup and the dial are Hyperswarm's own.
 */
export class HolepunchLocalDhtFixture {
    private readonly runtimes = new P2PManagerFixture();
    private network?: LocalDhtNetwork;
    private readonly topic = ethers.id(
        `holepunch-local-dht-${String(process.pid)}-${String(Date.now())}`
    );

    public async setup(): Promise<void> {
        this.network = await createLocalDhtNetwork();
        await this.runtimes.setup();
    }

    public async cleanup(): Promise<void> {
        await this.runtimes.cleanup();
        await this.network?.close();
    }

    /** Both runtimes join the topic at the same moment. */
    public async joinTogether(): Promise<void> {
        const bootstrapPort = this.network!.bootstrapPort;
        await Promise.all(
            [0, 1].map((index) =>
                this.control(index)
                    .p2pManagerProbe.joinHolepunchOnLocalDht(
                        this.topic,
                        bootstrapPort
                    )
                    .request()
            )
        );
    }

    /**
     * Runtime 0 joins and finishes its announce and its lookup before
     * runtime 1 joins, so only runtime 1 finds the other and dials it.
     */
    public async joinInOrder(): Promise<void> {
        const bootstrapPort = this.network!.bootstrapPort;
        await this.control(0)
            .p2pManagerProbe.joinHolepunchOnLocalDht(this.topic, bootstrapPort)
            .request();
        await this.control(0)
            .p2pManagerProbe.waitForHolepunchAnnounced()
            .request();
        await this.control(1)
            .p2pManagerProbe.joinHolepunchOnLocalDht(this.topic, bootstrapPort)
            .request();
    }

    /** Runtime `index` leaves the topic; resolves once its unannounce is done. */
    public async leave(index: number): Promise<boolean> {
        return this.control(index)
            .p2pManagerProbe.leaveHolepunchOnLocalDht(this.topic)
            .request();
    }

    /** Runtime `index` closes every swarm connection it has. */
    public async closeConnections(index: number): Promise<boolean> {
        return this.control(index)
            .p2pManagerProbe.closeHolepunchSwarmConnections()
            .request();
    }

    public async waitForOpenSwarmConnections(
        index: number,
        count: number
    ): Promise<boolean> {
        return this.control(index)
            .p2pManagerProbe.waitForOpenSwarmConnections(count)
            .request();
    }

    /** Public keys (hex) a DHT lookup of the topic from runtime `index` finds. */
    public async announcedPeerKeys(index: number): Promise<string[]> {
        return this.control(index)
            .p2pManagerProbe.lookUpHolepunchPeerKeys(this.topic)
            .request();
    }

    /**
     * Runtime `index`'s state after a window longer than Hyperswarm's
     * shortest redial backoff (at most 2 s), so a dial or connection that
     * follows the lookup shows in it.
     */
    public async stateAfterRedialWindow(
        index: number
    ): Promise<HolepunchSwarmProbe> {
        await setTimeout(REDIAL_WINDOW_MS);
        return this.state(index);
    }

    /** Wait until each runtime saw `count` authenticated connections. */
    public async waitForConnections(count: number): Promise<void> {
        await this.runtimes.getHarness().event.waitForEventCounts(
            "onConnection",
            [
                { peerId: 0, expectedCount: count },
                { peerId: 1, expectedCount: count }
            ],
            undefined,
            { mode: "atLeast" }
        );
    }

    public async blacklistOther(index: number): Promise<boolean> {
        return this.control(index)
            .network.blacklistAndDisconnectPeerByAddress(
                this.otherAddress(index)
            )
            .request();
    }

    public async unblacklistOther(index: number): Promise<boolean> {
        return this.control(index)
            .network.unblacklistPeerByAddress(this.otherAddress(index))
            .request();
    }

    /** Look the topic up; the swarm dials each peer it may dial. */
    public async lookUp(index: number): Promise<boolean> {
        return this.control(index)
            .p2pManagerProbe.lookUpHolepunchTopics()
            .request();
    }

    /** Runtime `index` accepts no connection until it dialed once more. */
    public async holdIncomingUntilOwnDial(index: number): Promise<boolean> {
        return this.control(index)
            .p2pManagerProbe.holdIncomingUntilOwnDial()
            .request();
    }

    /** Hyperswarm's verdicts on incoming connections, once there are `count`. */
    public async waitForFirewallVerdicts(
        index: number,
        count: number
    ): Promise<boolean[]> {
        return this.control(index)
            .p2pManagerProbe.waitForFirewallVerdicts(count)
            .request();
    }

    public async state(index: number): Promise<HolepunchSwarmProbe> {
        return this.control(index)
            .p2pManagerProbe.holepunchSwarmState(this.otherAddress(index))
            .request();
    }

    /** One request/response from runtime `index` to the other runtime. */
    public async requestSum(index: number): Promise<number> {
        return this.control(index)
            .p2pManagerProbe.requestSumFrom(this.otherAddress(index))
            .request();
    }

    private otherAddress(index: number): string {
        return this.runtimes.address(1 - index);
    }

    private control(index: number): RemoteRpcProxyType<PingPongRpc> {
        const harness = this.runtimes.getHarness();
        return harness.getPeer(index).p2pInstance.hostRpc;
    }
}
