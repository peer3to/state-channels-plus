import type ATransport from "@/transport/ATransport";
import ARpcService from "@/rpc/ARpcService";
import { HandshakeCompletedGuard } from "@/rpc/guards";
import type P2PManager from "@/P2PManager";
import type {
    JoinChannelConfirmationStruct,
    JoinChannelStruct,
    SignedJoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";
import type {
    Address,
    ChannelId,
    ForkId,
    Hash,
    Signature
} from "@/types/types";
import { addressesEqual, Codec, SignatureUtils, Type } from "@/utils";
import StateSnapshot from "@/models/StateSnapshot";
import Clock from "@/Clock";
import JoinChannelRpcMethods from "./JoinChannelRpcMethods";

export type PreparedJoinChannelConfirmation = {
    confirmation: JoinChannelConfirmationStruct;
    expectedSnapshotHash: Hash;
    expectedForkId: ForkId;
};

export default class JoinChannelService extends ARpcService<JoinChannelRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "JoinChannelService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(transport: ATransport): JoinChannelRpcMethods {
        return new JoinChannelRpcMethods(transport, this);
    }

    public async collectJoinChannelConfirmation(
        joinChannel: JoinChannelStruct
    ): Promise<PreparedJoinChannelConfirmation> {
        const sm = this.p2pManager.stateManager;
        if (!addressesEqual(joinChannel.participant, sm.signerAddress)) {
            throw new Error(
                "collectJoinChannelConfirmation: participant must be the local signer"
            );
        }

        const initialChainTime = await Clock.getBlockchainTime();
        if (
            Number(joinChannel.deadlineTimestamp) <= initialChainTime.timestamp
        ) {
            throw new Error("collectJoinChannelConfirmation: join expired");
        }

        const snapshot = StateSnapshot.from(
            await sm.stateChannelManagerContract.getStateSnapshot(
                joinChannel.channelId
            )
        );
        const expectedSnapshotHash = snapshot.hash;
        const expectedForkId = snapshot.forkID;
        const thresholdParticipants = await sm.getOnChainThresholdSet(
            String(joinChannel.channelId) as ChannelId
        );
        const localAddress = String(sm.signerAddress);

        for (const participant of thresholdParticipants) {
            if (
                !addressesEqual(participant, localAddress) &&
                !this.p2pManager.profileManager.getTransportByEvmAddress(
                    participant
                )
            ) {
                throw new Error(
                    `collectJoinChannelConfirmation: no transport for threshold participant ${participant}`
                );
            }
        }

        const chainTime = await Clock.getBlockchainTime();
        const remainingSeconds =
            Number(joinChannel.deadlineTimestamp) - chainTime.timestamp;
        if (remainingSeconds <= 0) {
            throw new Error("collectJoinChannelConfirmation: join expired");
        }
        const timeoutMs = Math.min(
            sm.timeConfig.agreementTime * 1000,
            remainingSeconds * 1000
        );
        const { encoded, signature } = await SignatureUtils.signJoinChannel(
            joinChannel,
            sm.signer
        );
        const signedJoinChannel: SignedJoinChannelStruct = {
            encodedJoinChannel: encoded,
            signature: String(signature)
        };
        const encodedSignedJoinChannel = String(
            Codec.encode(signedJoinChannel, Type.SignedJoinChannel)
        );
        const signatures = await Promise.all(
            thresholdParticipants.map(async (participant) => {
                const response = addressesEqual(participant, localAddress)
                    ? {
                          signature: await SignatureUtils.signMsg(
                              encoded,
                              sm.signer
                          )
                      }
                    : await this.remoteRpc.joinChannelService
                          .requestJoinSignature(
                              encodedSignedJoinChannel,
                              String(expectedSnapshotHash),
                              String(expectedForkId)
                          )
                          .request(participant, { timeoutMs });
                const recovered = SignatureUtils.getSignerAddress(
                    encoded,
                    String(response.signature)
                );
                if (!addressesEqual(recovered, participant)) {
                    throw new Error(
                        `collectJoinChannelConfirmation: invalid signature from ${participant}`
                    );
                }
                return String(response.signature);
            })
        );

        return {
            confirmation: {
                signedJoinChannel,
                signatures
            },
            expectedSnapshotHash,
            expectedForkId
        };
    }

    public async signJoinRequest(
        transport: ATransport,
        encodedSignedJoinChannel: string,
        expectedSnapshotHash: Hash,
        expectedForkId: ForkId
    ): Promise<{ signature: Signature }> {
        const peerAddress = transport.peerAddress;
        if (!peerAddress) {
            throw new Error("requestJoinSignature: missing peer address");
        }
        const signedJoinChannel = Codec.decode(
            encodedSignedJoinChannel,
            Type.SignedJoinChannel
        );
        const encodedJoinChannel = String(signedJoinChannel.encodedJoinChannel);
        const joinChannel = Codec.decode(encodedJoinChannel, Type.JoinChannel);
        const signer = SignatureUtils.getSignerAddress(
            encodedJoinChannel,
            String(signedJoinChannel.signature) as Signature
        );
        if (
            !addressesEqual(signer, joinChannel.participant) ||
            !addressesEqual(peerAddress, joinChannel.participant)
        ) {
            throw new Error(
                "requestJoinSignature: invalid participant signature"
            );
        }

        const sm = this.p2pManager.stateManager;
        if (String(joinChannel.channelId) !== String(sm.getChannelId())) {
            throw new Error("requestJoinSignature: channel mismatch");
        }
        const chainTime = await Clock.getBlockchainTime();
        if (Number(joinChannel.deadlineTimestamp) < chainTime.timestamp) {
            throw new Error("requestJoinSignature: join expired");
        }

        const snapshot = StateSnapshot.from(
            await sm.stateChannelManagerContract.getStateSnapshot(
                joinChannel.channelId
            )
        );
        if (String(snapshot.forkID) !== String(expectedForkId)) {
            throw new Error("requestJoinSignature: fork mismatch");
        }
        if (String(snapshot.hash) !== String(expectedSnapshotHash)) {
            throw new Error("requestJoinSignature: snapshot mismatch");
        }
        const thresholdParticipants = await sm.getOnChainThresholdSet(
            String(joinChannel.channelId) as ChannelId
        );
        if (
            !thresholdParticipants.some((participant) =>
                addressesEqual(participant, sm.signerAddress)
            )
        ) {
            throw new Error(
                "requestJoinSignature: local signer not in threshold"
            );
        }

        // TODO: add a configurable admission filter, including optional snapshot-scoped consent.
        const signature = await SignatureUtils.signMsg(
            encodedJoinChannel,
            sm.signer
        );
        return { signature: String(signature) };
    }
}
