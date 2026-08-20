import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
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
import { resolveTestTimeConfig } from "@test/harness/core/testTimeConfig";

/**
 * Handles channel-related operations: open channel and bootstrap.
 */
export class LifecycleActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(
        protected harness: PeerTestHarness<TCustomRpc>,
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
        const timeConfig = resolveTestTimeConfig(options?.timeConfig);
        await this.start(peerCount, transitionCount, {
            timeConfig
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

        // Kick off P2P connections early so handshaking overlaps with the tx
        // below, but don't block on full connectivity yet: `P2PManager` only
        // promotes a handshaked peer into `openConnections` once it resolves
        // as a dispute participant, which is never resolvable before this
        // very transaction lands on-chain. Waiting for connectivity here
        // (pre-open) would deadlock against that gate. The blocking wait
        // moves below, after the channel is confirmed open.
        const networkController = this.harness.options.autoConnect
            ? new NetworkController(this.harness, this.logger)
            : undefined;
        if (networkController) {
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

        const getPeerForkIds = () => this.harness.peerForkIds();

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
        const peerForkIds = await getPeerForkIds();
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

        // Now that the channel is confirmed open, each participant can
        // resolve the others as dispute participants, so `P2PManager`'s
        // deferred promotions (see `reevaluatePendingChannelMembership`) are
        // free to land - block on full connectivity here instead of before
        // the transaction above.
        if (networkController) {
            await this.harness.network.waitForP2PConnections();
        }

        this.logger.info(
            `Channel opened successfully with fork ID: ${this.harness.activeForkId}`
        );
        return this.harness.activeForkId;
    }
}
