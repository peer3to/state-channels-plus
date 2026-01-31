import type P2PManager from "../P2PManager";
import ATransport from "../transport/ATransport";
import { Address } from "../types/types";
import Rpc from "./Rpc";

class RpcHandler {
    rpc: Rpc;
    p2pManager: P2PManager;
    constructor(rpc: Rpc, p2pManager: P2PManager) {
        this.rpc = rpc;
        this.p2pManager = p2pManager;
    }

    public broadcast() {
        this.p2pManager.broadcastRpc(this.rpc);
    }

    public sendOne(transport: ATransport): void;
    public sendOne(address: Address): void;
    public sendOne(target: ATransport | Address) {
        if (target instanceof ATransport) {
            target.send(this.rpc);
            return;
        }

        const transport =
            this.p2pManager.profileManager.getTransportByEvmAddress(target);
        if (!transport) return;
        transport.send(this.rpc);
    }

    public sendMultiple(transports: ATransport[]): void;
    public sendMultiple(addresses: Address[]): void;
    public sendMultiple(targets: ATransport[] | Address[]) {
        if (targets.length === 0) return;

        if (targets[0] instanceof ATransport) {
            (targets as ATransport[]).forEach((transport) => {
                transport.send(this.rpc);
            });
            return;
        }

        (targets as Address[]).forEach((address) => {
            const transport =
                this.p2pManager.profileManager.getTransportByEvmAddress(
                    address
                );
            if (!transport) return;
            transport.send(this.rpc);
        });
    }
}

export default RpcHandler;
