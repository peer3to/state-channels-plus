import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, sleep } from "@/utils";
import { ForkId } from "@/types/types";
import { BytesLike } from "ethers";
import { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, SignatureUtils, Type } from "@/utils";
import Clock from "@/Clock";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { NetworkController } from "./NetworkController";

/**
 * Handles channel-related operations: open, join, verify
 */
export class ChannelActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    /**
     * Open a channel with all current peers
     */
    async openChannel(): Promise<ForkId> {
        this.logger.info("Opening channel...");
        await Clock.init(this.harness.peers[0].signer.provider!);

        const openChannel = this.buildOpenChannelStruct();
        const signatures = await this.signOpenChannelStruct(openChannel);
        return this.submitOpenChannel(openChannel, signatures);
    }

    private buildOpenChannelStruct(
        args: { participantAddresses?: string[] } = {}
    ): OpenChannelStruct {
        const participantAddresses =
            args.participantAddresses ??
            this.harness.peers.map((p) => p.address);

        return createOpenChannelTestObject(participantAddresses, {
            channelId: this.harness.options.channelId,
            initialBalance: this.harness.options.initialBalance
        });
    }

    private async signOpenChannelStruct(
        openChannel: OpenChannelStruct,
        signerIndices?: number[]
    ): Promise<BytesLike[]> {
        const indices =
            signerIndices ?? this.harness.peers.map((peer) => peer.index);
        const signatures = await Promise.all(
            indices.map((i: number) =>
                SignatureUtils.signOpenChannel(
                    openChannel,
                    this.harness.peers[i].signer
                ).then((s) => s.signature as BytesLike)
            )
        );
        return signatures;
    }

    private async submitOpenChannel(
        openChannel: OpenChannelStruct,
        signatures: BytesLike[]
    ): Promise<ForkId> {
        this.harness.setChannelId(openChannel.channelId);
        this.logger.debug(`Channel created with ID: ${openChannel.channelId}`);

        // Connect peers to the channel
        for (const peer of this.harness.peers) {
            await peer.p2pInstance.p2pSigner.connectToChannel(
                openChannel.channelId
            );
            peer.logger.verbose(
                `Connected to channel ${openChannel.channelId}`,
                { component: "ChannelActions" }
            );
        }

        if (this.harness.options.autoConnect) {
            const networkController = new NetworkController(
                this.harness,
                this.logger
            );
            await networkController.connectAllPeers();
        }

        this.logger.debug(
            "Submitting channel open transaction to blockchain..."
        );
        const tx = await this.harness.channelManager.open({
            encodedOpenChannel: Codec.encode(openChannel, Type.OpenChannel),
            signatures
        });

        await Promise.all([tx.wait(), sleep(100)]);

        const isValidForkId = (forkId: ForkId | undefined): boolean =>
            !!forkId && forkId !== "0x00" && forkId !== "0x0";

        const getPeerForkIds = () =>
            this.harness.peers.map((peer) => peer.stateManager.forkId);

        this.logger.debug("Waiting for fork ID to be set on all peers...");

        // Wait for onSetState event on all peers (called when forkId is set)
        const eventCounts = this.harness.peers.map((_, index: number) => ({
            peerId: index,
            expectedCount: 1
        }));

        const stateSetOnAllPeers =
            await this.harness.eventActions.waitForEventCounts(
                "onSetState",
                eventCounts,
                2000,
                { mode: "atLeast" }
            );

        if (!stateSetOnAllPeers) {
            throw new Error(
                "Failed to get fork ID on all peers after waiting 2000ms."
            );
        }

        // Verify all peers have the same valid fork ID
        const peerForkIds = getPeerForkIds();
        const allValidAndSame =
            peerForkIds.every(isValidForkId) &&
            peerForkIds.every((id) => id === peerForkIds[0]);

        if (!allValidAndSame) {
            throw new Error(
                `Fork IDs are not consistent across peers: ${peerForkIds.join(", ")}`
            );
        }

        this.harness.activeForkId = peerForkIds[0] as ForkId;

        // State machine is already initialized when onSetState fires
        // (setState is called before forkId is set and before onSetState is called)
        if (!this.harness.activeForkId) {
            throw new Error("Fork ID was not set after waiting for onSetState");
        }

        this.logger.info(
            `Channel opened successfully with fork ID: ${this.harness.activeForkId}`
        );
        return this.harness.activeForkId;
    }
}
