// @spec-test-coverage-ignore: shared setup for mapped targeted-channel E2E declarations
import type { PeerTestHarness } from "./PeerTestHarness";
import type { ConnectToChannelOptions } from "@/evm/signer/ConnectToChannelOptions";
import type { TestPeer } from "@test/harness/core/types";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";

export class TargetedChannelJoinFixture {
    constructor(private readonly harness: PeerTestHarness) {}

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
        return this.harness.execOnHost(peer, async (stateManager) =>
            Boolean(stateManager.isDisposed)
        );
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
