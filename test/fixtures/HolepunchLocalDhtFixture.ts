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
        return harness.control(
            harness.getPeer(index)
        ) as RemoteRpcProxyType<PingPongRpc>;
    }
}
