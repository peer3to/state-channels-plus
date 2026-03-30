import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, sleep } from "@/utils";
import { ForkId } from "@/types/types";
import { BytesLike, Signer } from "ethers";
import {
    OpenChannelStruct,
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, SignatureUtils, Type } from "@/utils";
import Clock from "@/Clock";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { NetworkController } from "../NetworkController";
import { HarnessOptions } from "@test/harness/core/types";

export type BuildJoinChannelConfirmationParams = {
    joiner: { address: string; signer: Signer };
    channelId: JoinChannelStruct["channelId"];
    existingParticipantSigners: readonly Signer[];
    jcOverrides?: Partial<JoinChannelStruct>;
};

/**
 * Handles channel-related operations: open, join, verify
 */
export class LifecycleActions {
    constructor(
        private harness: PeerTestHarness,
        private logger: Logger
    ) {}

    /**
     * Full channel bootstrap in one call:
     * setup peers -> open channel -> optional initial transitions
     */
    async start(
        numPeers: number,
        transitionCount: number = 0,
        options?: HarnessOptions & { waitForFinalization?: boolean }
    ): Promise<ForkId> {
        await this.harness.setup(numPeers, options);
        const forkId = await this.openChannel();

        if (transitionCount > 0) {
            await this.harness.transition.advanceState({
                count: transitionCount,
                waitForFinalization: options?.waitForFinalization ?? true
            });
        }

        return forkId;
    }

    async timeoutSetup(peerCount: number = 3, transitionCount: number = 0) {
        await this.start(peerCount, transitionCount, {
            timeConfig: {
                p2pTime: 1,
                agreementTime: 2,
                chainFallbackTime: 2,
                evidenceTime: 3
            }
        });
    }

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

    async buildJoinChannelConfirmation(
        params: BuildJoinChannelConfirmationParams
    ): Promise<JoinChannelConfirmationStruct> {
        const { joiner, channelId, existingParticipantSigners, jcOverrides } =
            params;
        if (existingParticipantSigners.length === 0) {
            throw new Error(
                "buildJoinChannelConfirmation: existingParticipantSigners must include every current participant signer"
            );
        }
        const jc: JoinChannelStruct = {
            participant: joiner.address,
            channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(Clock.getTimeInSeconds() + 120),
            ...jcOverrides
        };
        const { encoded, signature: joinerSignature } =
            await SignatureUtils.signJoinChannel(jc, joiner.signer);
        const confirmationSignatures = await Promise.all(
            existingParticipantSigners.map((signer) =>
                SignatureUtils.signJoinChannel(jc, signer).then(
                    (s) => s.signature as BytesLike
                )
            )
        );
        return {
            signedJoinChannel: {
                encodedJoinChannel: encoded as BytesLike,
                signature: joinerSignature as BytesLike
            },
            signatures: confirmationSignatures
        };
    }

    // ************** PRIVATE HELPERS ****************

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
            await this.harness.network.waitForP2PConnections();
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

        await this.harness.event.waitForEventCounts(
            "onSetState",
            eventCounts,
            2000,
            { mode: "atLeast" }
        );

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
