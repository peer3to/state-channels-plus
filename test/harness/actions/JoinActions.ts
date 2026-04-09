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
import { TestPeer } from "@test/harness/core/types";

export type AddPeerOptions = {
    signer?: Signer;
    statusTimeoutMs?: number;
    statusTimeoutMessage?: string;
};

export type BuildJoinChannelConfirmationParams = {
    joiner: { address: string; signer: Signer };
    channelId: JoinChannelStruct["channelId"];
    existingParticipantSigners: readonly Signer[];
    jcOverrides?: Partial<JoinChannelStruct>;
};

export class JoinActions {
    constructor(private harness: PeerTestHarness) {}

    private async addPeer(options?: AddPeerOptions): Promise<TestPeer> {
        if (!this.harness.canAddPeer) {
            throw new Error("Harness not initialized; call setup() first");
        }

        const index = this.harness.peers.length;
        const signers = await hre.ethers.getSigners();
        const resolvedSigner = options?.signer ?? signers[index];
        if (!resolvedSigner) {
            throw new Error(
                `No signer available to create peer at index ${index}`
            );
        }

        await this.harness.createPeer(index, resolvedSigner);
        const peer = this.harness.peers[index];
        if (!peer) {
            throw new Error(`Failed to create peer ${index}`);
        }

        if (this.harness.channelId) {
            await peer.p2pInstance.p2pSigner.connectToChannel(
                this.harness.channelId
            );
            await LocalDiscoveryServer.connectToPeers(
                peer.stateManager.p2pManager.self,
                this.harness.channelId,
                peer.address
            );
        }

        return peer;
    }

    async addPeerWait(options?: AddPeerOptions): Promise<TestPeer> {
        const peer = await this.addPeer(options);
        if (this.harness.channelId) {
            await this.harness.event.waitUntilPeerStatus(
                peer.index,
                Status.SYNCED,
                {
                    timeoutMs: options?.statusTimeoutMs ?? 15000,
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${peer.index} did not reach SYNCED after connect`
                }
            );
        }
        return peer;
    }

    async addPeerDetached(options?: AddPeerOptions): Promise<TestPeer> {
        const peer = await this.addPeer(options);
        if (this.harness.channelId) {
            const promise = this.harness.event.waitUntilPeerStatus(
                peer.index,
                Status.SYNCED,
                {
                    timeoutMs: options?.statusTimeoutMs ?? 15000,
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${peer.index} did not reach SYNCED after connect`
                }
            );
            DetachedPromises.collect(promise);
        }
        return peer;
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
