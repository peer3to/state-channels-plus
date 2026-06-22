import { expect } from "chai";

import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import MainRpcService from "@/rpc/MainRpcService";
import type P2PManager from "@/P2PManager";
import type ATransport from "@/transport/ATransport";

type PingRpcOptions = {
    prefix: string;
};

class PingRpc extends MainRpcService {
    pingService: PingService;
    relayService: RelayService;

    constructor(p2pManager: P2PManager<PingRpc>, options: PingRpcOptions) {
        super(p2pManager);
        this.pingService = new PingService(p2pManager, options.prefix);
        this.relayService = new RelayService(p2pManager);
    }
}

class PingService extends ARpcService<PingRpcMethods, P2PManager<PingRpc>> {
    readonly prefix: string;

    constructor(p2pManager: P2PManager<PingRpc>, prefix: string) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ component: "PingService" })
        );
        this.prefix = prefix;
    }

    createRPCMethods(transport: ATransport): PingRpcMethods {
        return new PingRpcMethods(transport, this);
    }
}

class PingRpcMethods extends ARpcMethods<P2PManager<PingRpc>> {
    private readonly service: PingService;

    constructor(transport: ATransport, service: PingService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    ping(nonce: string): void {
        this.remoteRpc.pingService.pong(this.service.prefix + nonce);
        this.remoteRpc.relayService.recordPing(nonce);
    }

    pong(_nonce: string): void {}
}

class RelayService extends ARpcService<RelayRpcMethods, P2PManager<PingRpc>> {
    constructor(p2pManager: P2PManager<PingRpc>) {
        super(
            p2pManager,
            p2pManager.stateManager.logger.child({ component: "RelayService" })
        );
    }

    createRPCMethods(transport: ATransport): RelayRpcMethods {
        return new RelayRpcMethods(transport, this);
    }
}

class RelayRpcMethods extends ARpcMethods<P2PManager<PingRpc>> {
    private readonly service: RelayService;

    constructor(transport: ATransport, service: RelayService) {
        super(transport, service.p2pManager);
        this.service = service;
    }

    recordPing(nonce: string): void {
        this.remoteRpc.pingService.pong(nonce);
    }
}

function assertCustomRpcTypes(p2pManager: P2PManager<PingRpc>): void {
    p2pManager.localRpc.pingService.prefix;
    p2pManager.remoteRpc.pingService.ping("ok");
    p2pManager.remoteRpc.relayService.recordPing("ok");

    // @ts-expect-error - ping expects a string nonce.
    p2pManager.remoteRpc.pingService.ping(123);

    // @ts-expect-error - missing services are not exposed.
    p2pManager.remoteRpc.missingService;
}

describe("CustomRpc typing", () => {
    it("allows custom RPC classes to extend MainRpcService", () => {
        void assertCustomRpcTypes;
        expect(true).to.equal(true);
    });
});
