import type { RpcResponse } from "@/rpc/Rpc";
import type Rpc from "@/rpc/Rpc";
import { TransportType } from "@/transport";

export class CrossModuleRpcService {
    p2pManager = {};
    router = this.p2pManager;

    createRPCMethods(): object {
        return {};
    }

    async runRPC(): Promise<boolean> {
        return true;
    }
}

export class CrossModuleTransport {
    transportType = TransportType.LOOPBACK;
    peerAddress: string | undefined = undefined;
    sent: Rpc[] = [];
    responses: RpcResponse[] = [];

    close(): void {}

    send(rpc: Rpc): void {
        this.sent.push(rpc);
    }

    sendRpcResponse(response: RpcResponse): void {
        this.responses.push(response);
    }
}

export class CrossModuleEthersResult extends Array<unknown> {
    private readonly namedValues: Record<string, unknown>;

    constructor(values: unknown[], namedValues: Record<string, unknown>) {
        super(...values);
        this.namedValues = namedValues;
    }

    getValue(name: string): unknown {
        return this.namedValues[name];
    }

    toArray(): unknown[] {
        return Array.from(this);
    }

    toObject(): Record<string, unknown> {
        return { ...this.namedValues };
    }
}
