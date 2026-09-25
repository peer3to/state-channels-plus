import { ARpcRouter } from "./ARpcRouter";
import { DisconnectPolicy } from "@/DisconnectPolicy";
import type P2PManager from "@/P2PManager";
import Rpc, { MAX_RPC_FRAME_BYTES, deserializeRpcFrame } from "@/rpc/Rpc";
import NetworkTransport from "@/transport/NetworkTransport";
import { TransportType } from "@/transport/TransportType";
import { errorMessage } from "@/utils/errorMessage";
import { LoggerUtils } from "@/utils/LoggerUtils";
import { Buffer } from "buffer";

export class NetworkRpcRouter<
    TManager extends P2PManager = P2PManager
> extends ARpcRouter<NetworkTransport> {
    constructor(public readonly p2pManager: TManager) {
        super();
    }

    public broadcastRpc(rpc: Rpc) {
        const debugConnections = this.p2pManager.openConnections.map(
            (transport) => {
                return {
                    transportType: transport.transportType,
                    peerAddress: transport.peerAddress
                };
            }
        );
        this.p2pManager.logger.debug("broadcastRpc", {
            rpc: LoggerUtils.getRpcLogMetadata(rpc),
            debugConnections
        });
        for (const transport of this.p2pManager.openConnections) {
            transport.send(rpc);
        }
    }

    protected get rpcRoot(): object {
        return this.p2pManager.localRpc;
    }

    protected get defaultRequestTimeoutMs(): number {
        // `agreementTime` is in seconds; the RPC timeout is in milliseconds.
        return this.p2pManager.stateManager.timeConfig.agreementTime * 1000;
    }

    // Overrides ARpcRouter.scheduleRpcTimeout: schedule through the state manager instead of setTimeout.
    protected override scheduleRpcTimeout(
        callback: () => void,
        timeoutMs: number,
        rpc: Rpc
    ) {
        return this.p2pManager.stateManager.timeoutManager.scheduleTask(
            callback,
            timeoutMs,
            `rpcRequest:${rpc.service}.${rpc.method}`
        );
    }

    // Overrides ARpcRouter.cancelRpcTimeout: cancel through the same timeout manager used for scheduling.
    protected override cancelRpcTimeout(
        timeout: ReturnType<typeof setTimeout>
    ): void {
        this.p2pManager.stateManager.timeoutManager.cancelTask(timeout);
    }

    protected admitRpcResponse(
        transport: NetworkTransport,
        expected: NetworkTransport
    ): boolean {
        if (NetworkTransport.isSamePeer(transport, expected)) return true;
        this.p2pManager.disconnectConnection(
            transport,
            DisconnectPolicy.BLACKLIST,
            "response from a different peer"
        );
        return false;
    }

    public async onRpc(serializedRpc: string, transport: NetworkTransport) {
        try {
            // Reject oversized frames before parsing so a peer can't force
            // unbounded JSON.parse/dispatch work.
            const frameBytes = Buffer.byteLength(serializedRpc, "utf8");
            if (frameBytes > MAX_RPC_FRAME_BYTES) {
                this.p2pManager.logger.warn(
                    "Oversized RPC frame; rejecting peer",
                    {
                        bytes: frameBytes,
                        transportType: TransportType[transport.transportType],
                        peerAddress: transport.peerAddress
                    }
                );
                this.p2pManager.disconnectConnection(
                    transport,
                    DisconnectPolicy.BLACKLIST,
                    "oversized RPC frame"
                );
                return;
            }
            const frame = deserializeRpcFrame(serializedRpc);
            if (frame?.kind === "response") {
                this.handleRpcResponse(frame.response, transport);
                return;
            }
            const rpc = frame?.rpc;
            this.p2pManager.logger.verbose("onRpc", {
                rpc: rpc ? LoggerUtils.getRpcLogMetadata(rpc) : undefined,
                transportType: TransportType[transport.transportType],
                peerAddress: transport.peerAddress
            });
            if (!rpc) {
                this.p2pManager.disconnectConnection(
                    transport,
                    DisconnectPolicy.BLACKLIST,
                    "malformed RPC frame"
                );
                return;
            }
            const success = await this.dispatchRpc(rpc, transport);
            if (!success) {
                this.p2pManager.disconnectConnection(
                    transport,
                    DisconnectPolicy.BLACKLIST,
                    "RPC dispatch refused"
                );
                return;
            }
        } catch (e) {
            this.p2pManager.disconnectConnection(
                transport,
                DisconnectPolicy.ALLOW
            );
            this.p2pManager.logger.error("onRpc - error handling RPC frame", {
                error: errorMessage(e),
                stack: e instanceof Error ? e.stack : undefined,
                transportType: TransportType[transport.transportType],
                peerAddress: transport.peerAddress
            });
        }
    }
}
