// @spec-test-coverage-ignore: shared join test setup exercised by owning mapped test declarations
import { PeerTestHarness } from "@test/fixtures/PeerTestHarness";
import type { HarnessControlRpc } from "@test/fixtures/customRpc/harnessControl/HarnessControlRpc";
import { Signer } from "ethers";
import { slotAccountIndex } from "@test/harness/core/slotAccounts";
import { Status } from "@/types";
import { addressesEqual, DetachedPromises, SignatureUtils } from "@/utils";
import {
    JoinChannelConfirmationStruct,
    JoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import Clock from "@/Clock";
import { TestPeer } from "@test/harness/core/types";
import StateSnapshot from "@/models/StateSnapshot";
import type { PreparedJoinChannelConfirmation } from "@/rpc/services";

export type AddPeerOptions = {
    signer?: Signer;
    statusTimeoutMs?: number;
    statusTimeoutMessage?: string;
};

export type BuildJoinChannelConfirmationParams = {
    joiner: { address: string; signer: Signer };
    channelId: JoinChannelStruct["channelId"];
    jcOverrides?: Partial<JoinChannelStruct>;
};

export class JoinActions<
    TCustomRpc extends HarnessControlRpc = HarnessControlRpc
> {
    constructor(protected harness: PeerTestHarness<TCustomRpc>) {}

    protected thresholdSignerForAddress(address: string): Signer | undefined {
        return this.harness.peers.find((candidate) =>
            addressesEqual(candidate.address, address)
        )?.signer;
    }

    private async buildJoinChannel(
        joiner: { address: string },
        channelId: JoinChannelStruct["channelId"],
        overrides?: Partial<JoinChannelStruct>
    ): Promise<JoinChannelStruct> {
        const chainTime = await Clock.getBlockchainTime();
        return {
            participant: joiner.address,
            channelId,
            balance: { amount: 500n, data: "0x00" },
            deadlineTimestamp: BigInt(chainTime.timestamp + 120),
            ...overrides
        };
    }

    /** Add a spectator without waiting for sync (lets a test install host-side
     * stubs before sync starts). Prefer {@link addSpectatorWait}. */
    async addSpectator(
        options?: AddPeerOptions
    ): Promise<TestPeer<TCustomRpc>> {
        if (!this.harness.canAddPeer) {
            throw new Error("Harness not initialized; call setup() first");
        }

        const index = this.harness.peers.length;
        const resolvedSigner =
            options?.signer ?? this.harness.signerFor(slotAccountIndex(index));
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
            await this.harness
                .control(peer)
                .network.connectToChannel(this.harness.channelId.toString())
                .request();
        }

        return peer;
    }

    async addSpectatorWait(
        options?: AddPeerOptions
    ): Promise<TestPeer<TCustomRpc>> {
        const peer = await this.addSpectator(options);
        if (this.harness.channelId) {
            await this.harness.event.waitUntilPeerStatus(
                peer.index,
                Status.SYNCED,
                {
                    timeoutMs:
                        options?.statusTimeoutMs ??
                        this.harness.event.protocolEventTimeoutMs(),
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${peer.index} did not reach SYNCED after connect`
                }
            );
        }
        return peer;
    }

    async addSpectatorDetached(
        options?: AddPeerOptions
    ): Promise<TestPeer<TCustomRpc>> {
        const peer = await this.addSpectator(options);
        if (this.harness.channelId) {
            const promise = this.harness.event.waitUntilPeerStatus(
                peer.index,
                Status.SYNCED,
                {
                    timeoutMs:
                        options?.statusTimeoutMs ??
                        this.harness.event.protocolEventTimeoutMs(),
                    timeoutMessage:
                        options?.statusTimeoutMessage ??
                        `Spectator peer ${peer.index} did not reach SYNCED after connect`
                }
            );
            DetachedPromises.collect(promise);
        }
        return peer;
    }

    async joinChannelWait(params: {
        joiner: TestPeer<TCustomRpc>;
        channelId?: JoinChannelStruct["channelId"];
        jcOverrides?: Partial<JoinChannelStruct>;
    }): Promise<JoinChannelConfirmationStruct> {
        const channelId = params.channelId ?? this.harness.channelId;
        const joinChannel = await this.buildJoinChannel(
            params.joiner,
            channelId,
            params.jcOverrides
        );
        const prepared =
            await params.joiner.p2pInstance.p2pSigner.collectJoinChannelConfirmation(
                joinChannel
            );
        await params.joiner.p2pInstance.p2pSigner.joinChannel(
            prepared.confirmation,
            prepared.expectedSnapshotHash,
            prepared.expectedForkId
        );
        return prepared.confirmation;
    }

    async buildJoinChannelConfirmation(
        params: BuildJoinChannelConfirmationParams
    ): Promise<PreparedJoinChannelConfirmation> {
        const { joiner, channelId, jcOverrides } = params;
        const jc = await this.buildJoinChannel(joiner, channelId, jcOverrides);
        const { encoded, signature: joinerSignature } =
            await SignatureUtils.signJoinChannel(jc, joiner.signer);
        const snapshot = StateSnapshot.from(
            await this.harness.channelManager.getStateSnapshot(channelId)
        );
        const thresholdParticipants = await this.harness
            .control(this.harness.getPeer(0))
            .query.getOnChainThresholdSet()
            .request();
        const existingParticipantSigners = thresholdParticipants.map(
            (participant) => {
                const signer = this.thresholdSignerForAddress(
                    String(participant)
                );
                if (!signer) {
                    throw new Error(
                        `buildJoinChannelConfirmation: no harness signer for ${participant}`
                    );
                }
                return signer;
            }
        );
        const confirmationSignatures = await Promise.all(
            existingParticipantSigners.map((signer) =>
                SignatureUtils.signJoinChannel(jc, signer).then((s) =>
                    String(s.signature)
                )
            )
        );
        return {
            confirmation: {
                signedJoinChannel: {
                    encodedJoinChannel: String(encoded),
                    signature: String(joinerSignature)
                },
                signatures: confirmationSignatures
            },
            expectedSnapshotHash: snapshot.hash,
            expectedForkId: snapshot.forkID
        };
    }
}
