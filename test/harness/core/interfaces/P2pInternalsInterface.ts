import type {
    Address,
    ChannelId,
    ForkId,
    Hash,
    Signature,
    Timestamp
} from "@/types/types";
import type { TransportType } from "@/transport";
import type { ConnectionId } from "./common";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";

export type ProfileSummary = {
    evmAddress: Address;
    connectionId: ConnectionId;
};

export type TransportSummary = {
    connectionId: ConnectionId;
    peerAddress: Address;
    kind: string;
};

export type InitChallengeSummary = {
    randomChallengeHash: Hash;
    initTime: number;
};

export type TransportStatus = {
    present: boolean;
    isClosed?: boolean;
};

export interface P2pInternalsInterface {
    // --- connections & profiles ---

    openConnections(): Promise<TransportSummary[]>;

    getProfileByEvmAddress(addr: Address): Promise<ProfileSummary | undefined>;

    connectionCount(): Promise<number>;

    isHandshakeCompletedWith(otherAddr: Address): Promise<boolean>;

    // --- dispute acknowledgment ---

    didPeerAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean>;

    didIAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean>;

    requestDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean>;

    respondToDisputeAcknowledgment(
        peerAddress: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void>;

    onDisputeAcknowledgmentRequest(
        fromAddr: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void>;

    // --- handshake ---

    onInitHandshakeRequest(
        fromAddr: Address,
        hash: Hash,
        time: Timestamp
    ): Promise<void>;

    onInitHandshakeResponse(
        fromAddr: Address,
        signature: Signature,
        time: Timestamp,
        preferred: TransportType
    ): Promise<void>;

    initHandshakeTo(toAddr: Address): Promise<void>;

    getPreferredTransportType(): Promise<number>;

    getInitChallenge(
        otherAddr: Address
    ): Promise<InitChallengeSummary | undefined>;

    clearInitChallenge(otherAddr: Address): Promise<void>;

    getTransportStatus(otherAddr: Address): Promise<TransportStatus>;

    // --- fork dispute signaling ---

    blockForkIsDisputed(
        block: BlockConfirmationStruct,
        peerAddress: string
    ): Promise<void>;
}
