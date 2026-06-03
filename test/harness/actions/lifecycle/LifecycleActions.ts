import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import { Logger, sleep } from "@/utils";
import { ForkId } from "@/types/types";
import { BytesLike } from "ethers";
import { OpenChannelStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import { Codec, SignatureUtils, Type } from "@/utils";
import Clock from "@/Clock";
import { createOpenChannelTestObject } from "@test/test_utils/testHelpers";
import { NetworkController } from "../NetworkController";
import { HarnessOptions } from "@test/harness/core/types";
import { TimeConfig } from "@/types";

const defaultTimeConfig: TimeConfig = {
    p2pTime: 1,
    agreementTime: 2,
    chainFallbackTime: 2,
    evidenceTime: 8
};

/**
 * Handles channel-related operations: open channel and bootstrap.
 */
export class LifecycleActions {
    constructor(
        protected harness: PeerTestHarness,
        protected logger: Logger
    ) {}

    /**
     * Full channel bootstrap in one call:
     * setup peers -> open channel -> optional initial transitions
     */
    async start(
        numPeers: number,
        transitionCount: number = 0,
        options?: HarnessOptions & {
            waitForFinalization?: boolean;
        }
    ): Promise<ForkId> {
        await this.harness.setup(numPeers, options);
        const forkId = await this.openChannel();

        if (transitionCount > 0) {
            throw new Error(
                "LifecycleActions.start is generic; provide explicit transitions after start() or use a concrete harness lifecycle"
            );
        }

        return forkId;
    }

    async timeoutSetup(
        peerCount: number = 3,
        transitionCount: number = 0,
        options?: {
            timeConfig?: {
                p2pTime?: number;
                agreementTime?: number;
                chainFallbackTime?: number;
                evidenceTime?: number;
            };
        }
    ) {
        const timeConfig = {
            ...defaultTimeConfig,
            ...options?.timeConfig
        };
        await this.start(peerCount, transitionCount, {
            timeConfig
        });
    }

    /**
     * Open a channel with all current peers
     */
    async openChannel(): Promise<ForkId> {
        this.logger.info("Opening channel...");
        await Clock.init(this.harness.getPeerHandle(0).signer.provider!);

        const openChannel = this.buildOpenChannelStruct();
        const signatures = await this.signOpenChannelStruct(openChannel);
        return this.submitOpenChannel(openChannel, signatures);
    }

    private buildOpenChannelStruct(
        args: { participantAddresses?: string[] } = {}
    ): OpenChannelStruct {
        const participantAddresses =
            args.participantAddresses ??
            this.harness.peerHandles.map((h) => h.address);

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
            signerIndices ?? this.harness.peerHandles.map((h) => h.index);
        const signatures = await Promise.all(
            indices.map((i: number) =>
                SignatureUtils.signOpenChannel(
                    openChannel,
                    this.harness.getPeerHandle(i).signer
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

        await Promise.all(
            this.harness.peerHandles.map(async (h) => {
                await h.lifecycle.connectToChannel(
                    openChannel.channelId.toString()
                );
                h.logger.verbose(
                    `Connected to channel ${openChannel.channelId}`,
                    { component: "ChannelActions" }
                );
            })
        );

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
            this.harness.peerHandles.map((h) => h.forkId);

        this.logger.debug("Waiting for fork ID to be set on all peers...");

        const eventCounts = this.harness.peerHandles.map((h) => ({
            peerId: h.index,
            expectedCount: 1
        }));

        await this.harness.event.waitForEventCounts(
            "onSetState",
            eventCounts,
            2000,
            { mode: "atLeast" }
        );

        const peerForkIds = getPeerForkIds();
        const allValidAndSame =
            peerForkIds.every(isValidForkId) &&
            peerForkIds.every((id) => id === peerForkIds[0]);

        if (!allValidAndSame) {
            throw new Error(
                `Fork IDs are not consistent across peers: ${peerForkIds.join(", ")}`
            );
        }

        if (!this.harness.activeForkId) {
            throw new Error("Fork ID was not set after waiting for onSetState");
        }

        this.logger.info(
            `Channel opened successfully with fork ID: ${this.harness.activeForkId}`
        );
        return this.harness.activeForkId;
    }
}
