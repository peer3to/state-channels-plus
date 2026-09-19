// @spec-test-coverage-ignore: shared setup for mapped targeted-channel E2E declarations
import type { PeerTestHarness } from "./PeerTestHarness";
import { runtimeIsClosed } from "./RuntimeRootObservation";
import type { ConnectToChannelOptions } from "@/evm/signer/ConnectToChannelOptions";
import { MathTestSession as TestSession } from "@test/harness";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import type { TestPeer } from "@test/harness/core/types";
import { ethers } from "ethers";

export const targetedTestTime = {
    agreementTime: 4,
    p2pTime: 2,
    chainFallbackTime: 2,
    evidenceTime: 2
};

export class TargetedChannelJoinFixture {
    constructor(private readonly harness: PeerTestHarness) {}

    /**
     * A session whose channel is derived from `label` but not yet opened, with
     * no peer connected: the starting point for every targeted-connect case.
     */
    public static async unopened(
        label: string,
        peerCount = 2,
        timeConfig = targetedTestTime
    ) {
        const h = TestSession.getHarness();
        const channelId = ethers.keccak256(
            ethers.AbiCoder.defaultAbiCoder().encode(["string"], [label])
        );
        await h.setup(peerCount, {
            autoConnect: false,
            channelId: label,
            timeConfig
        });
        return { h, channelId, targeted: new TargetedChannelJoinFixture(h) };
    }

    public connect(
        peer: TestPeer,
        channelId: string,
        options: ConnectToChannelOptions = {}
    ): Promise<boolean> {
        return peer.p2pInstance.p2pSigner.connectToChannel(channelId, options);
    }

    public openWithPeers(
        channelId: string,
        peerIndices: number[] = [0, 1],
        options: ConnectToChannelOptions = {}
    ): Promise<boolean[]> {
        return Promise.all(
            peerIndices.map((index) =>
                this.connect(this.harness.getPeer(index), channelId, {
                    autoOpen: true,
                    ...options
                })
            )
        );
    }

    public async isDisposed(peer: TestPeer): Promise<boolean> {
        if (runtimeIsClosed(peer.p2pInstance)) return true;
        try {
            return await this.harness.execOnHost(peer, async (stateManager) =>
                Boolean(stateManager.isDisposed)
            );
        } catch (error) {
            if (runtimeIsClosed(peer.p2pInstance)) return true;
            throw error;
        }
    }

    public async addFreshPeer(): Promise<TestPeer> {
        const index = this.harness.peers.length;
        await this.harness.createPeer(
            index,
            this.harness.signerFor(slotAccountIndex(index))
        );
        return this.harness.getPeer(index);
    }
}
