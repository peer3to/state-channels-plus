import type P2PManager from "../P2PManager";
import ATransport from "../transport/ATransport";
import { Address } from "../types/types";
import Rpc, { serializeRpc } from "./Rpc";

class RpcHandler {
    rpc: Rpc;
    p2pManager: P2PManager;
    constructor(rpc: Rpc, p2pManager: P2PManager) {
        this.rpc = rpc;
        this.p2pManager = p2pManager;
    }

    public broadcast() {
        this.p2pManager.broadcastRpc(serializeRpc(this.rpc));
    }

    public sendOne(transport: ATransport): void;
    public sendOne(address: Address): void;
    public sendOne(target: ATransport | Address) {
        const payload = serializeRpc(this.rpc);

        if (target instanceof ATransport) {
            target.send(payload);
            return;
        }

        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(target);
        if (!transport) return;
        transport.send(payload);
    }

    public sendMultiple(transports: ATransport[]): void;
    public sendMultiple(addresses: Address[]): void;
    public sendMultiple(targets: ATransport[] | Address[]) {
        const payload = serializeRpc(this.rpc);
        if (targets.length === 0) return;

        if (targets[0] instanceof ATransport) {
            (targets as ATransport[]).forEach((transport) => {
                transport.send(payload);
            });
            return;
        }

        (targets as Address[]).forEach((address) => {
            const transport =
                this.p2pManager.profileManager.getTransportByEvmAddress(
                    address
                );
            if (!transport) return;
            transport.send(payload);
        });
    }
}

export default RpcHandler;
