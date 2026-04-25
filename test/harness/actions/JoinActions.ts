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
import { MathConsumerFacet__factory } from "@typechain-types";

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

    private async addSpectator(options?: AddPeerOptions): Promise<TestPeer> {
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

    async addSpectatorWait(options?: AddPeerOptions): Promise<TestPeer> {
        const peer = await this.addSpectator(options);
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

    async addSpectatorDetached(options?: AddPeerOptions): Promise<TestPeer> {
        const peer = await this.addSpectator(options);
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

    async forceInboundJoinWait(options?: {
        deposit?: bigint;
        timeoutMs?: number;
        waitForHonestPeersObserve?: boolean;
    }): Promise<{ participant: string }> {
        const deposit = options?.deposit ?? 250n;
        const timeoutMs = options?.timeoutMs ?? 15000;
        const waitForHonestPeersObserve =
            options?.waitForHonestPeersObserve ?? true;

        const submitter = this.harness.peers[0];
        if (!submitter) {
            throw new Error("forceInboundJoinWait: harness has no peers");
        }

        const participant = hre.ethers.Wallet.createRandom().address;
        const previousLatestHash =
            submitter.stateManager.storage.inboundMessages.getLatestBlockHash();

        const consumerFacet = MathConsumerFacet__factory.connect(
            await this.harness.channelManager.getAddress(),
            submitter.signer
        );
        const tx = await consumerFacet.forceInboundJoin(
            this.harness.channelId,
            participant,
            deposit
        );
        await tx.wait();

        if (waitForHonestPeersObserve) {
            await this.harness.assert.storage.honestPeersObserveInboundMessageWait(
                {
                    previousLatestHash: previousLatestHash ?? undefined,
                    timeoutMs
                }
            );
        }

        return { participant };
    }
}
