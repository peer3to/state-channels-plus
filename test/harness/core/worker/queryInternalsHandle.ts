import type {
    P2pInternalsInterface,
    ProfileSummary,
    TransportSummary
} from "../interfaces/P2pInternalsInterface";
import type {
    Address,
    ChannelId,
    ForkId,
    Hash,
    Signature,
    Timestamp
} from "@/types/types";
import type { TransportType } from "@/transport";
import type { BlockConfirmationStruct } from "@typechain-types/contracts/V1/types/DataTypes";
import type { PeerCaller } from "../../threaded/rpc/rpc-client";

export class WorkerP2pInternalsHandle implements P2pInternalsInterface {
    constructor(private readonly rpc: PeerCaller) {}

    openConnections(): Promise<TransportSummary[]> {
        return this.rpc.call("queryInternals.openConnections", {}) as Promise<
            TransportSummary[]
        >;
    }
    getProfileByEvmAddress(addr: Address): Promise<ProfileSummary | undefined> {
        return this.rpc.call("queryInternals.getProfileByEvmAddress", {
            addr
        }) as Promise<ProfileSummary | undefined>;
    }
    getProfileByConnectionId(
        connectionId: string
    ): Promise<ProfileSummary | undefined> {
        return this.rpc.call("queryInternals.getProfileByConnectionId", {
            connectionId
        }) as Promise<ProfileSummary | undefined>;
    }
    connectionCount(): Promise<number> {
        return this.rpc.call(
            "queryInternals.connectionCount",
            {}
        ) as Promise<number>;
    }
    isHandshakeCompletedWith(otherAddr: Address): Promise<boolean> {
        return this.rpc.call("queryInternals.isHandshakeCompletedWith", {
            otherAddr
        }) as Promise<boolean>;
    }
    self(): Promise<Address> {
        return this.rpc.call("queryInternals.self", {}) as Promise<Address>;
    }
    didPeerAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return this.rpc.call("queryInternals.isForkDisputedService", {
            op: "didPeerAcknowledgeDisputedFork",
            args: [peerAddress, forkId]
        }) as Promise<boolean>;
    }
    didIAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return this.rpc.call("queryInternals.isForkDisputedService", {
            op: "didIAcknowledgeDisputedFork",
            args: [peerAddress, forkId]
        }) as Promise<boolean>;
    }
    requestDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        return this.rpc.call("queryInternals.isForkDisputedService", {
            op: "requestDisputeAcknowledgment",
            args: [channelId, forkId]
        }) as Promise<boolean>;
    }
    respondToDisputeAcknowledgment(
        peerAddress: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        return this.rpc.call("queryInternals.isForkDisputedService", {
            op: "respondToDisputeAcknowledgment",
            args: [peerAddress, channelId, forkId]
        }) as Promise<void>;
    }
    onDisputeAcknowledgmentRequest(
        fromAddr: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        return this.rpc.call("queryInternals.callServiceWithTransport", {
            serviceName: "isForkDisputedService",
            methodName: "onDisputeAcknowledgmentRequest",
            otherAddr: fromAddr,
            args: [channelId, forkId]
        }) as Promise<void>;
    }
    onInitHandshakeRequest(
        fromAddr: Address,
        hash: Hash,
        time: Timestamp
    ): Promise<void> {
        return this.rpc.call("queryInternals.callServiceWithTransport", {
            serviceName: "initHandshakeService",
            methodName: "onInitHandshakeRequest",
            otherAddr: fromAddr,
            args: [hash, time]
        }) as Promise<void>;
    }
    onInitHandshakeResponse(
        fromAddr: Address,
        signature: Signature,
        time: Timestamp,
        preferred: TransportType
    ): Promise<void> {
        return this.rpc.call("queryInternals.callServiceWithTransport", {
            serviceName: "initHandshakeService",
            methodName: "onInitHandshakeResponse",
            otherAddr: fromAddr,
            args: [signature, time, preferred]
        }) as Promise<void>;
    }
    initHandshakeTo(toAddr: Address): Promise<void> {
        return this.rpc.call("queryInternals.callServiceMethodWithTransport", {
            serviceName: "initHandshakeService",
            methodName: "initHandshake",
            otherAddr: toAddr,
            args: []
        }) as Promise<void>;
    }
    getPreferredTransportType(): Promise<number> {
        return this.rpc.call(
            "queryInternals.getPreferredTransportType",
            {}
        ) as Promise<number>;
    }
    getInitChallenge(
        otherAddr: Address
    ): Promise<{ randomChallengeHash: string; initTime: number } | undefined> {
        return this.rpc.call("queryInternals.getInitChallenge", {
            otherAddr
        }) as Promise<
            { randomChallengeHash: string; initTime: number } | undefined
        >;
    }
    clearInitChallenge(otherAddr: Address): Promise<void> {
        return this.rpc.call("queryInternals.clearInitChallenge", {
            otherAddr
        }) as Promise<void>;
    }
    getTransportStatus(
        otherAddr: Address
    ): Promise<{ present: boolean; isClosed?: boolean }> {
        return this.rpc.call("queryInternals.getTransportStatus", {
            otherAddr
        }) as Promise<{
            present: boolean;
            isClosed?: boolean;
        }>;
    }
    blockForkIsDisputed(
        block: BlockConfirmationStruct,
        peerAddress: string
    ): Promise<void> {
        return this.rpc.call("queryInternals.blockForkIsDisputed", {
            block,
            peerAddress
        }) as Promise<void>;
    }
}
