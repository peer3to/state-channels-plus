import type {
    InitChallengeSummary,
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
import type { PeerCaller } from "../../threaded/rpc/PeerCaller";
import { ROUTES } from "@test/harness/threaded/worker/routeNames";

export class WorkerP2pInternalsHandle implements P2pInternalsInterface {
    constructor(private readonly rpc: PeerCaller) {}

    openConnections(): Promise<TransportSummary[]> {
        return this.rpc.call(
            ROUTES.queryInternals.openConnections,
            {}
        ) as Promise<TransportSummary[]>;
    }
    getProfileByEvmAddress(addr: Address): Promise<ProfileSummary | undefined> {
        return this.rpc.call(ROUTES.queryInternals.getProfileByEvmAddress, {
            addr
        }) as Promise<ProfileSummary | undefined>;
    }
    connectionCount(): Promise<number> {
        return this.rpc.call(
            ROUTES.queryInternals.connectionCount,
            {}
        ) as Promise<number>;
    }
    isHandshakeCompletedWith(otherAddr: Address): Promise<boolean> {
        return this.rpc.call(ROUTES.queryInternals.isHandshakeCompletedWith, {
            otherAddr
        }) as Promise<boolean>;
    }
    didPeerAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return this.rpc.call(ROUTES.queryInternals.isForkDisputedService, {
            op: "didPeerAcknowledgeDisputedFork",
            args: [peerAddress, forkId]
        }) as Promise<boolean>;
    }
    didIAcknowledgeDisputedFork(
        peerAddress: Address,
        forkId: ForkId
    ): Promise<boolean> {
        return this.rpc.call(ROUTES.queryInternals.isForkDisputedService, {
            op: "didIAcknowledgeDisputedFork",
            args: [peerAddress, forkId]
        }) as Promise<boolean>;
    }
    requestDisputeAcknowledgment(
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<boolean> {
        return this.rpc.call(ROUTES.queryInternals.isForkDisputedService, {
            op: "requestDisputeAcknowledgment",
            args: [channelId, forkId]
        }) as Promise<boolean>;
    }
    respondToDisputeAcknowledgment(
        peerAddress: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        return this.rpc.call(ROUTES.queryInternals.isForkDisputedService, {
            op: "respondToDisputeAcknowledgment",
            args: [peerAddress, channelId, forkId]
        }) as Promise<void>;
    }
    onDisputeAcknowledgmentRequest(
        fromAddr: Address,
        channelId: ChannelId,
        forkId: ForkId
    ): Promise<void> {
        return this.rpc.call(ROUTES.queryInternals.callServiceWithTransport, {
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
        return this.rpc.call(ROUTES.queryInternals.callServiceWithTransport, {
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
        return this.rpc.call(ROUTES.queryInternals.callServiceWithTransport, {
            serviceName: "initHandshakeService",
            methodName: "onInitHandshakeResponse",
            otherAddr: fromAddr,
            args: [signature, time, preferred]
        }) as Promise<void>;
    }
    initHandshakeTo(toAddr: Address): Promise<void> {
        return this.rpc.call(
            ROUTES.queryInternals.callServiceMethodWithTransport,
            {
                serviceName: "initHandshakeService",
                methodName: "initHandshake",
                otherAddr: toAddr,
                args: []
            }
        ) as Promise<void>;
    }
    getPreferredTransportType(): Promise<number> {
        return this.rpc.call(
            ROUTES.queryInternals.getPreferredTransportType,
            {}
        ) as Promise<number>;
    }
    getInitChallenge(
        otherAddr: Address
    ): Promise<InitChallengeSummary | undefined> {
        return this.rpc.call(ROUTES.queryInternals.getInitChallenge, {
            otherAddr
        }) as Promise<InitChallengeSummary | undefined>;
    }
    clearInitChallenge(otherAddr: Address): Promise<void> {
        return this.rpc.call(ROUTES.queryInternals.clearInitChallenge, {
            otherAddr
        }) as Promise<void>;
    }
    getTransportStatus(
        otherAddr: Address
    ): Promise<{ present: boolean; isClosed?: boolean }> {
        return this.rpc.call(ROUTES.queryInternals.getTransportStatus, {
            otherAddr
        }) as Promise<{
            present: boolean;
            isClosed?: boolean;
        }>;
    }
    blockForkIsDisputed(
        block: BlockConfirmationStruct,
        peerAddress: Address
    ): Promise<void> {
        return this.rpc.call(ROUTES.queryInternals.blockForkIsDisputed, {
            block,
            peerAddress
        }) as Promise<void>;
    }
}
