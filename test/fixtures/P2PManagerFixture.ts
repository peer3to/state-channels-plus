// @spec-test-coverage-ignore: shared runtime setup for P2PManager component tests
import path from "node:path";

import { MathStateMachine } from "@typechain-types";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import type { RemoteRpcProxyType } from "@/rpc/RemoteRpcProxy";
import { Status } from "@/types";
import type { HarnessOptions } from "@test/harness/core/types";

export type HandshakeRoutingFixtureResult = {
    connected: boolean;
    hookIsChannelOpened: boolean;
    hookCount: number;
    syncCallCount: number;
    syncTargets: string[];
};

export type P2PManagerFixtureSetup = {
    openChannel?: boolean;
    timeConfig?: HarnessOptions["timeConfig"];
};

export class P2PManagerFixture {
    private readonly harness = new PeerTestHarness<
        PingPongRpc,
        MathStateMachine
    >({ deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT });

    public async setup(options: P2PManagerFixtureSetup = {}): Promise<void> {
        await this.harness.setup(2, {
            autoConnect: false,
            timeConfig: options.timeConfig,
            customRpcManifest: {
                module: path.resolve(
                    __dirname,
                    "customRpc/PingPongRpcManifest.ts"
                )
            }
        });
        if (options.openChannel) await this.harness.lifecycle.openChannel();
    }

    public async cleanup(): Promise<void> {
        await this.harness.cleanup();
    }

    public control(): RemoteRpcProxyType<PingPongRpc> {
        return this.harness.control(
            this.harness.getPeer(0)
        ) as RemoteRpcProxyType<PingPongRpc>;
    }

    public address(index: number): string {
        return String(this.harness.getPeerAddresses()[index]);
    }

    public getHarness(): PeerTestHarness<PingPongRpc, MathStateMachine> {
        return this.harness;
    }

    public async runHandshakeRouting(
        status: Status
    ): Promise<HandshakeRoutingFixtureResult> {
        const peer = this.harness.getPeer(0);
        const remoteAddress = this.address(1);
        await this.control().stub.stubRecordSpectateSync(false).request();
        this.harness.event.resetEventSpies(0);

        await this.control().stub.setPeerStatus(status).request();
        await this.control()
            .network.joinSelectedKey(this.harness.channelId!.toString())
            .request();
        await this.harness
            .control(this.harness.getPeer(1))
            .network.joinSelectedKey(this.harness.channelId!.toString())
            .request();
        await this.harness.event.waitForEventCounts(
            "onConnection",
            [{ peerId: 0, expectedCount: 1 }],
            undefined,
            { mode: "atLeast" }
        );

        const connectedAddresses = await this.control()
            .query.getConnectedPeerAddresses()
            .request();
        const syncCallCount = await this.control()
            .stub.getSpectateSyncCallCount()
            .request();
        const syncTargets =
            syncCallCount > 0
                ? await this.control()
                      .stub.waitForSpectateSyncCalls(syncCallCount)
                      .request()
                : [];
        const onConnection = peer.eventSpies.onConnection;
        return {
            connected: connectedAddresses.includes(remoteAddress),
            hookIsChannelOpened: Boolean(onConnection?.firstCall?.args[1]),
            hookCount: onConnection?.callCount ?? 0,
            syncCallCount,
            syncTargets
        };
    }
}
