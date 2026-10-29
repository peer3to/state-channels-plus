// @spec-test-coverage-ignore: shared runtime setup for P2PManager component tests

import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import type { RemoteRpcProxyType } from "@/rpc/network/RemoteRpcProxy";
import { Status } from "@/types";
import type { PingPongRpc } from "@test/fixtures/customRpc/PingPongRpcManifest";
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { DEFAULT_MATH_HARNESS_DEPLOYMENT } from "@test/harness/core/defaultMathHarnessDeployment";
import type { HarnessOptions } from "@test/harness/core/types";
import { MathStateMachine } from "@typechain-types";
import path from "node:path";

export type HandshakeRoutingFixtureResult = {
    connected: boolean;
    hookIsChannelOpened: boolean;
    hookCount: number;
    syncCallCount: number;
    syncTargets: string[];
};

export type P2PManagerFixtureSetup = {
    peerCount?: number;
    openChannel?: boolean;
    timeConfig?: HarnessOptions["timeConfig"];
    /** Each peer in its own thread, so a probe's process-wide patch stays in its peer. */
    isolatedPeers?: boolean;
    /** Every host inline in the test process, so a test reads its log store after abort. */
    inlineHosts?: boolean;
};

export class P2PManagerFixture {
    private readonly harness = new PeerTestHarness<
        P2pRuntimeHostRoot<PingPongRpc>,
        MathStateMachine
    >({ deployment: DEFAULT_MATH_HARNESS_DEPLOYMENT });

    public async setup(options: P2PManagerFixtureSetup = {}): Promise<void> {
        await this.harness.setup(options.peerCount ?? 2, {
            autoConnect: false,
            timeConfig: options.timeConfig,
            configOverrides: options.isolatedPeers
                ? { RUN_SDK_IN_THREAD: true }
                : options.inlineHosts
                  ? { RUN_SDK_IN_THREAD: false }
                  : undefined,
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
        return this.harness.getPeer(0).p2pInstance.hostRpc;
    }

    public address(index: number): string {
        return String(this.harness.getPeerAddresses()[index]);
    }

    public getHarness(): PeerTestHarness<
        P2pRuntimeHostRoot<PingPongRpc>,
        MathStateMachine
    > {
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
