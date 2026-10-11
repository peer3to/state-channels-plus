import NetworkTransport from "./NetworkTransport";
import { TransportType } from "./TransportType";
import type { BannablePeerInfo } from "@/PeerProfile";
import type { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import { Buffer } from "buffer";

class HolepunchTransport extends NetworkTransport {
    transportType = TransportType.HOLEPUNCH;
    holepunchSocket: any;
    constructor(
        holepunchSocket: any,
        holepunchPeerInfo: BannablePeerInfo,
        router: NetworkRpcRouter
    ) {
        super(router);
        this.holepunchSocket = holepunchSocket;
        this.p2pManager.profileManager.setBannablePeerInfo(
            this,
            holepunchPeerInfo
        );
        // A suspended key is refused at registration; nothing else to wire.
        if (this.isClosed) return;
        this.holepunchSocket.on("data", async (data: any) => {
            this.onMessage(data);
        });
        this.p2pManager.localRpc.initHandshakeService.initHandshake(this);
        this.holepunchSocket.on("close", () => {
            this.close();
        });
        this.holepunchSocket.on("error", (error: Error) => {
            const details = {
                socketState: this.holepunchSocket?.readyState,
                error
            };
            // A peer that resets its connection (it left or its runtime
            // ended) is ordinary churn, not a failure of this runtime.
            if ((error as NodeJS.ErrnoException).code === "ECONNRESET")
                this.p2pManager.logger.warn(
                    "Holepunch peer reset the connection",
                    details
                );
            else
                this.p2pManager.logger.error("Holepunch socket error", details);
            this.close();
        });
    }
    // Overrides NetworkTransport.onMessage to decode Holepunch input.
    public override onMessage(data: unknown): void {
        if (data instanceof Uint8Array) data = Buffer.from(data);
        super.onMessage(data);
    }

    _send(serializedRPC: string): void {
        this.holepunchSocket.write(serializedRPC);
    }

    _close(): void {
        this.holepunchSocket.destroy();
    }
}
export default HolepunchTransport;
