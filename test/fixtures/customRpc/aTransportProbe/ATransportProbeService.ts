// @spec-test-coverage-ignore: host-side support service for the mapped ATransport component cases
import type P2PManager from "@/P2PManager";
import type Rpc from "@/rpc/Rpc";
import type { RpcResponse } from "@/rpc/Rpc";
import ARpcService from "@/rpc/ARpcService";
import ATransport from "@/transport/ATransport";
import { TransportType } from "@/transport/TransportType";
import type { PingPongRpc } from "../PingPongRpcManifest";
import { ATransportProbeRpcMethods } from "./ATransportProbeRpcMethods";

export type ATransportIdentityProbe = {
    sameReferenceWithoutAddress: boolean;
    distinctWithoutAddresses: boolean;
    oneAddressMissing: boolean;
    sameAddressDifferentCase: boolean;
    differentAddresses: boolean;
    replacementTransportType: boolean;
    baseTransportTrusted: boolean;
    loopbackTransportTrusted: boolean;
};

export type ATransportDeliveryProbe = {
    serializedRpc: string;
    serializedResponse: string;
};

export type ATransportCloseProbe = {
    isClosed: boolean;
    connectionPresentAfterClose: boolean;
    disconnectCalls: number;
    disconnectionEvents: number;
    concreteCloseCalls: number;
};

export type ATransportFailureProbe = {
    serializationErrorPropagated: boolean;
    sendErrorMessage: string | undefined;
};

class RecordingTransport extends ATransport {
    public transportType = TransportType.HOLEPUNCH;
    public readonly serializedFrames: string[] = [];
    public concreteCloseCalls = 0;
    public sendError?: Error;

    public _send(serializedRPC: string): void {
        if (this.sendError) throw this.sendError;
        this.serializedFrames.push(serializedRPC);
    }

    public onMessage(): void {}

    protected _close(): void {
        this.concreteCloseCalls += 1;
    }
}

export class ATransportProbeService extends ARpcService<
    ATransportProbeRpcMethods,
    P2PManager<PingPongRpc>
> {
    constructor(p2pManager: P2PManager<PingPongRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({
                component: "ATransportProbeService"
            })
        );
    }

    public createRPCMethods(transport: ATransport): ATransportProbeRpcMethods {
        return new ATransportProbeRpcMethods(transport, this);
    }

    public probeIdentity(
        firstAddress: string,
        secondAddress: string
    ): ATransportIdentityProbe {
        const sameReference = new RecordingTransport(this.p2pManager);
        const first = new RecordingTransport(this.p2pManager);
        const second = new RecordingTransport(this.p2pManager);

        const sameReferenceWithoutAddress = ATransport.isSamePeer(
            sameReference,
            sameReference
        );
        const distinctWithoutAddresses = ATransport.isSamePeer(first, second);

        first.peerAddress = firstAddress;
        const oneAddressMissing = ATransport.isSamePeer(first, second);

        second.peerAddress = firstAddress.toLowerCase();
        const sameAddressDifferentCase = ATransport.isSamePeer(first, second);

        second.peerAddress = secondAddress;
        const differentAddresses = ATransport.isSamePeer(first, second);

        const replacement = new RecordingTransport(this.p2pManager);
        replacement.transportType = TransportType.WEBRTC;
        replacement.peerAddress = firstAddress;
        const replacementTransportType = ATransport.isSamePeer(
            first,
            replacement
        );

        return {
            sameReferenceWithoutAddress,
            distinctWithoutAddresses,
            oneAddressMissing,
            sameAddressDifferentCase,
            differentAddresses,
            replacementTransportType,
            baseTransportTrusted: first.isTrusted,
            loopbackTransportTrusted:
                this.p2pManager.loopbackTransport.isTrusted
        };
    }

    public probeDelivery(
        rpc: Rpc,
        response: RpcResponse
    ): ATransportDeliveryProbe {
        const transport = new RecordingTransport(this.p2pManager);
        transport.send(rpc);
        transport.sendRpcResponse(response);
        return {
            serializedRpc: transport.serializedFrames[0],
            serializedResponse: transport.serializedFrames[1]
        };
    }

    public probeClose(
        peerAddress: string,
        isExpected: boolean,
        closeTwice: boolean
    ): ATransportCloseProbe {
        const transport = new RecordingTransport(this.p2pManager);
        transport.peerAddress = peerAddress;
        this.p2pManager.addConnection(transport);
        let disconnectCalls = 0;
        let disconnectionEvents = 0;
        const originalDisconnect = this.p2pManager.disconnectConnection.bind(
            this.p2pManager
        );
        const unsubscribe = this.p2pManager.stateManager.events.on(
            "p2pEventHooks",
            "onDisconnection",
            () => {
                disconnectionEvents += 1;
            }
        );

        this.p2pManager.disconnectConnection = (candidate): void => {
            disconnectCalls += 1;
            originalDisconnect(candidate);
        };
        try {
            transport.close(isExpected);
            if (closeTwice) transport.close(isExpected);
        } finally {
            this.p2pManager.disconnectConnection = originalDisconnect;
            unsubscribe();
        }

        return {
            isClosed: transport.isClosed,
            connectionPresentAfterClose:
                this.p2pManager.openConnections.includes(transport),
            disconnectCalls,
            disconnectionEvents,
            concreteCloseCalls: transport.concreteCloseCalls
        };
    }

    public probeFailures(): ATransportFailureProbe {
        const serializationTransport = new RecordingTransport(this.p2pManager);
        let serializationErrorPropagated = false;
        try {
            serializationTransport.send({
                service: "transportProbe",
                method: "invalidBigInt",
                params: [1n]
            });
        } catch {
            serializationErrorPropagated = true;
        }

        const sendTransport = new RecordingTransport(this.p2pManager);
        sendTransport.sendError = new Error("recording transport send failed");
        let sendErrorMessage: string | undefined;
        try {
            sendTransport.send({
                service: "transportProbe",
                method: "sendFailure",
                params: []
            });
        } catch (error) {
            sendErrorMessage =
                error instanceof Error ? error.message : String(error);
        }

        return { serializationErrorPropagated, sendErrorMessage };
    }
}
