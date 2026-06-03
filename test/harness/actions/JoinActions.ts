import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import hre from "hardhat";
import { Signer, BytesLike } from "ethers";
import { Status } from "@/types";
import {
    DetachedPromises,
    LocalDiscoveryServer,
    SignatureUtils
} from "@/utils";
import {
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import type { PeerHandle } from "@test/harness/core/PeerHandle";
import { TestPeer } from "@test/harness/core/types";

export type JoinerRef = Pick<TestPeer, "index" | "address" | "signer">;

export type AddPeerOptions = {
    signer?: Signer;
    statusTimeoutMs?: number;
    statusTimeoutMessage?: string;
};

export type BuildJoinChannelConfirmationParams = {
    joiner: JoinerRef;
    channelId: JoinChannelStruct["channelId"];
    existingParticipantSigners: readonly Signer[];
    jcOverrides?: Partial<JoinChannelStruct>;
};

export class JoinActions {
    constructor(protected harness: PeerTestHarness) {}

    private async addSpectator(options?: AddPeerOptions): Promise<PeerHandle> {
        if (!this.harness.canAddPeer) {
            throw new Error("Harness not initialized; call setup() first");
        }

        const index = this.harness.peerCount;
        const signers = await hre.ethers.getSigners();
        const resolvedSigner = options?.signer ?? signers[index];
        if (!resolvedSigner) {
            throw new Error(
                `No signer available to create peer at index ${index}`
            );
        }

        await this.harness.createPeer(index, resolvedSigner);
        const handle = this.harness.getPeerHandle(index);

        if (this.harness.channelId) {
            await handle.lifecycle.connectToChannel(this.harness.channelId);
            // Worker peers already dialed discovery during p2pSetup.
            if (!handle.__workerBackend) {
                const peer = this.harness.getPeer(index);
                await LocalDiscoveryServer.connectToPeers(
                    peer.stateManager.p2pManager.self,
                    this.harness.channelId,
                    peer.address
                );
            }
        }

        return handle;
    }

    async addSpectatorWait(options?: AddPeerOptions): Promise<PeerHandle> {
        const handle = await this.addSpectator(options);
        if (this.harness.channelId) {
            await this.harness.event.waitUntilPeerStatus(
                handle.index,
                Status.SYNCED,
                {
                    timeoutMs: options?.statusTimeoutMs ?? 15000,
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${handle.index} did not reach SYNCED after connect`
                }
            );
        }
        return handle;
    }

    async addSpectatorDetached(options?: AddPeerOptions): Promise<PeerHandle> {
        const handle = await this.addSpectator(options);
        if (this.harness.channelId) {
            const promise = this.harness.event.waitUntilPeerStatus(
                handle.index,
                Status.SYNCED,
                {
                    timeoutMs: options?.statusTimeoutMs ?? 15000,
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${handle.index} did not reach SYNCED after connect`
                }
            );
            DetachedPromises.collect(promise);
        }
        return handle;
    }

    async joinChannelWait(params: {
        joiner: JoinerRef;
        existingParticipantSigners: readonly Signer[];
        channelId?: JoinChannelStruct["channelId"];
        jcOverrides?: Partial<JoinChannelStruct>;
    }): Promise<JoinChannelConfirmationStruct> {
        const channelId = params.channelId ?? this.harness.channelId;
        const confirmation = await this.buildJoinChannelConfirmation({
            joiner: params.joiner,
            channelId,
            existingParticipantSigners: params.existingParticipantSigners,
            jcOverrides: params.jcOverrides
        });
        await this.harness
            .getPeerHandle(params.joiner.index)
            .lifecycle.joinChannel(confirmation);
        return confirmation;
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
}
