import type { Address } from "@/types/types";
import type { ConnectionId } from "./common";

export type ProfileSummary = {
    evmAddress: Address;
    connectionId: ConnectionId;
};
export type TransportSummary = {
    connectionId: ConnectionId;
    peerAddress: Address;
    kind: string;
};

export interface P2pInternalsHandle {
    openConnections(): Promise<TransportSummary[]>;
    getProfileByEvmAddress(addr: Address): Promise<ProfileSummary | undefined>;
    getProfileByConnectionId(
        connectionId: ConnectionId
    ): Promise<ProfileSummary | undefined>;
    connectionCount(): Promise<number>;
    isHandshakeCompletedWith(otherAddr: Address): Promise<boolean>;
    // Serialisable peer address for orchestrator-side LocalDiscoveryServer wiring.
    self(): Promise<Address>;
    isForkDisputedService(req: {
        op:
            | "didPeerAcknowledgeDisputedFork"
            | "didIAcknowledgeDisputedFork"
            | "requestDisputeAcknowledgment"
            | "respondToDisputeAcknowledgment"
            | "onDisputeAcknowledgmentRequest";
        args: unknown;
    }): Promise<unknown>;
    initHandshakeService(req: {
        op:
            | "initHandshake"
            | "onInitHandshakeRequest"
            | "onInitHandshakeResponse"
            | "getChallenge"
            | "clearChallenge";
        args: unknown;
    }): Promise<unknown>;
    // Resolve transport in-thread by peer address, then call createRPCMethods(transport).method(...).
    callServiceWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown>;
    // Resolve transport in-thread, then call service.method(transport, ...args).
    callServiceMethodWithTransport(req: {
        serviceName: string;
        methodName: string;
        otherAddr: Address;
        args: unknown[];
    }): Promise<unknown>;
    getPreferredTransportType(): Promise<number>;
    getInitChallenge(otherAddr: Address): Promise<
        | {
              randomChallengeHash: string;
              initTime: number;
          }
        | undefined
    >;
    clearInitChallenge(otherAddr: Address): Promise<void>;
    getTransportStatus(otherAddr: Address): Promise<{
        present: boolean;
        isClosed?: boolean;
    }>;
    blockForkIsDisputed(req: {
        block: unknown;
        peerAddress: string;
    }): Promise<void>;
}
