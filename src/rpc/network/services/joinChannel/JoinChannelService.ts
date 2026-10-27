import JoinChannelRpcMethods from "./JoinChannelRpcMethods";
import {
    type JoinCollectionFailure,
    type JoinCollectionFailureReason,
    JoinCollectionError
} from "./JoinCollectionError";
import Clock from "@/Clock";
import StateSnapshot from "@/models/StateSnapshot";
import type P2PManager from "@/P2PManager";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import { HandshakeCompletedGuard } from "@/rpc/network/guards";
import type NetworkTransport from "@/transport/NetworkTransport";
import type {
    Address,
    Bytes,
    ChannelId,
    ForkId,
    Hash,
    Signature
} from "@/types/types";
import {
    addressesEqual,
    Codec,
    getChecksumAddress,
    SignatureUtils,
    Type
} from "@/utils";
import { config } from "@/utils/config";
import { errorMessage } from "@/utils/errorMessage";
import type {
    BalanceStruct,
    JoinChannelConfirmationStruct,
    JoinChannelStruct,
    SignedJoinChannelStruct
} from "@typechain-types/contracts/V1/types/DataTypes";

export type PreparedJoinChannelConfirmation = {
    confirmation: JoinChannelConfirmationStruct;
    expectedSnapshotHash: Hash;
    expectedForkId: ForkId;
};

/** One threshold member's countersignature, or why it has none. */
type CountersignatureOutcome =
    | { signature: string }
    | { failure: JoinCollectionFailure };

export default class JoinChannelService extends ANetworkRpcService<JoinChannelRpcMethods> {
    constructor(p2pManager: P2PManager) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({
                component: "JoinChannelService"
            })
        );
        this.guards = [new HandshakeCompletedGuard(this)];
    }

    public createRPCMethods(
        transport: NetworkTransport
    ): JoinChannelRpcMethods {
        return new JoinChannelRpcMethods(transport, this);
    }

    public async prepareJoinChannelConfirmation(
        balance: BalanceStruct
    ): Promise<PreparedJoinChannelConfirmation> {
        const chainTime = await Clock.getBlockchainTime();
        return this.collectJoinChannelConfirmation({
            channelId: this.p2pManager.stateManager.channelId,
            participant: this.p2pManager.stateManager.signerAddress,
            balance,
            deadlineTimestamp: BigInt(
                chainTime.timestamp + config.JOIN_CHANNEL_DEADLINE_SECONDS
            )
        });
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
        const thresholdParticipants =
            await sm.membershipService.getOnChainThresholdSet(
                String(joinChannel.channelId) as ChannelId
            );
        const localAddress = String(sm.signerAddress);

        await this.waitForThresholdReachability(
            thresholdParticipants.map(String),
            localAddress
        );

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
        const outcomes = await Promise.all(
            thresholdParticipants.map(
                async (participant): Promise<CountersignatureOutcome> =>
                    addressesEqual(participant, localAddress)
                        ? {
                              signature: String(
                                  await SignatureUtils.signMsg(
                                      encoded,
                                      sm.signer
                                  )
                              )
                          }
                        : this.requestCountersignature(
                              participant,
                              encoded,
                              encodedSignedJoinChannel,
                              timeoutMs
                          )
            )
        );
        // every member's outcome is in, so the error names each missing one
        const signatures: string[] = [];
        const failures: JoinCollectionFailure[] = [];
        for (const outcome of outcomes) {
            if ("failure" in outcome) failures.push(outcome.failure);
            else signatures.push(outcome.signature);
        }
        if (failures.length > 0) throw new JoinCollectionError(failures);

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
        transport: NetworkTransport,
        encodedSignedJoinChannel: string
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
        if (joinChannel.channelId !== sm.channelId) {
            throw new Error("requestJoinSignature: channel mismatch");
        }
        // No snapshot or fork check: the signature covers only the encoded
        // join. The joiner's pins are separate submission arguments that the
        // contract checks for the joiner.
        // Only local reads: the contract checks the deadline again at
        // submission.
        if (Number(joinChannel.deadlineTimestamp) < Clock.getTimeInSeconds()) {
            throw new Error("requestJoinSignature: join expired");
        }

        if (!(await sm.membershipService.isSignerInThresholdSet())) {
            throw new Error(
                "requestJoinSignature: local signer not in threshold"
            );
        }

        try {
            await sm.diamondStateMachine.requirePositiveBalance(
                joinChannel.balance,
                "join balance"
            );
        } catch (error) {
            this.p2pManager.disconnectAndBlacklistPeerByEvmAddress(peerAddress);
            throw error;
        }

        // TODO: add a configurable admission filter, including optional snapshot-scoped consent.
        const signature = await SignatureUtils.signMsg(
            encodedJoinChannel,
            sm.signer
        );
        return { signature: String(signature) };
    }

    /**
     * One threshold member's countersignature. A failed request or a wrong
     * signer is that member's failure; it does not end the other requests.
     */
    private async requestCountersignature(
        participant: Address,
        encodedJoinChannel: Bytes,
        encodedSignedJoinChannel: string,
        timeoutMs: number
    ): Promise<CountersignatureOutcome> {
        const failure = (
            reason: JoinCollectionFailureReason,
            detail: string
        ): CountersignatureOutcome => ({
            failure: {
                participant: getChecksumAddress(participant),
                reason,
                detail
            }
        });
        let response: { signature: Signature };
        try {
            response = await this.remoteRpc.joinChannelService
                .requestJoinSignature(encodedSignedJoinChannel)
                .request(participant, { timeoutMs });
        } catch (error) {
            return failure("no-answer", errorMessage(error));
        }
        const signature = String(response.signature);
        let recovered: Address;
        try {
            recovered = SignatureUtils.getSignerAddress(
                encodedJoinChannel,
                signature
            );
        } catch (error) {
            return failure("wrong-signer", errorMessage(error));
        }
        if (!addressesEqual(recovered, participant))
            return failure("wrong-signer", `signed by ${recovered}`);
        return { signature };
    }

    private async waitForThresholdReachability(
        thresholdParticipants: string[],
        localAddress: string
    ): Promise<void> {
        const getUnreachable = () =>
            thresholdParticipants.filter(
                (participant) =>
                    !addressesEqual(participant, localAddress) &&
                    !this.p2pManager.profileManager.getTransportByEvmAddress(
                        participant
                    )
            );
        const isReady = () => getUnreachable().length === 0;
        if (isReady()) return;

        const timedOut = new AbortController();
        const timeout =
            this.p2pManager.stateManager.timeoutManager.scheduleTask(
                () => timedOut.abort(),
                this.p2pManager.stateManager.timeConfig.agreementTime *
                    2 *
                    1000,
                "join threshold participant reachability"
            );
        const handshake = await this.p2pManager.stateManager.events.next(
            "p2pEventHooks",
            "handshakeCompleted",
            isReady,
            timedOut.signal
        );
        this.p2pManager.stateManager.timeoutManager.cancelTask(timeout);
        if (!handshake)
            throw new JoinCollectionError(
                getUnreachable().map((participant) => ({
                    participant: getChecksumAddress(participant),
                    reason: "unreachable",
                    detail: "no transport after the reachability grace"
                }))
            );
    }
}
