// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import type P2PManager from "@/P2PManager";
import type {
    AInternalRpcRoot,
    RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
import type { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type { RemoteRoot } from "@/rpc/internal/RemoteRoot";
import type { ContractExecutorRoot } from "@/rpc/internal/roots/ContractExecutorRoot";
import type { P2pRuntimeHostRoot } from "@/rpc/internal/roots/P2pRuntimeHostRoot";
import ANetworkRpcMethods from "@/rpc/network/ANetworkRpcMethods";
import ANetworkRpcService from "@/rpc/network/ANetworkRpcService";
import MainRpcService from "@/rpc/network/MainRpcService";
import type { InternalRpcRouter } from "@/rpc/router/InternalRpcRouter";
import type { NetworkRpcRouter } from "@/rpc/router/NetworkRpcRouter";
import type ATransport from "@/transport/ATransport";
import InternalTransport from "@/transport/InternalTransport";
import LoopbackTransport from "@/transport/LoopbackTransport";
import type NetworkTransport from "@/transport/NetworkTransport";
import type { RuntimePort } from "@/transport/RuntimePort";
import type { RuntimeProbeRoot } from "@test/fixtures/runtimeRpc/probe/runtime/RuntimeProbeService";

export function assertBoundTypes(
    connection: RuntimeConnection<RuntimeProbeRoot>,
    host: RuntimeConnection<P2pRuntimeHostRoot>,
    executor: RuntimeConnection<ContractExecutorRoot>,
    remoteRoot: RemoteRoot<ContractExecutorRoot>
): void {
    const executorRemote: RuntimeConnection<ContractExecutorRoot> =
        remoteRoot.rpc;
    const common: RemoteRoot<AInternalRpcRoot> = remoteRoot;
    const disposal: Promise<void> = common.rpc.lifecycle.dispose().request();
    // @ts-expect-error - a common handle exposes only common root services.
    common.rpc.executor;
    // @ts-expect-error - the executor handle has no host signer service.
    remoteRoot.rpc.p2pSigner;
    void [executorRemote, disposal];
    const sum: Promise<number> = connection.runtimeProbe.sum(1, 2).request();
    const optional: Promise<number> = connection.runtimeProbe.sum(1).request();
    const acknowledged: Promise<void> = connection.runtimeProbe
        .notify("value")
        .request();
    const sent: void = connection.runtimeProbe.notify("value").send();
    void [sum, optional, acknowledged, sent];
    // @ts-expect-error - the method retains its argument types.
    connection.runtimeProbe.sum("wrong").request();
    // @ts-expect-error - the method retains its result type.
    const wrong: Promise<string> = connection.runtimeProbe.sum(1).request();
    // @ts-expect-error - helpers belong to the service, not its endpoint surface.
    connection.runtimeProbe.connection;
    // @ts-expect-error - root connection registries are not services.
    connection.connections;
    // @ts-expect-error - internal requests have a bound recipient.
    connection.runtimeProbe.echo(1).request({ recipient: "self" });
    // @ts-expect-error - roots have no then endpoint.
    connection.then;
    // @ts-expect-error - an SDK host has no executor operation service.
    host.executor;
    // @ts-expect-error - an executor has no P2P signer service.
    executor.p2pSigner;
    // @ts-expect-error - endpoint constructor is not part of the typed surface.
    connection.runtimeProbe.constructor.request();
    void wrong;
}

// These checks are compiled but never instantiate invalid combinations.
export function assertCategoryTypes(
    network: NetworkRpcRouter,
    internal: InternalRpcRouter,
    host: P2pRuntimeHostRoot,
    port: RuntimePort,
    acceptNetwork: (service: ANetworkRpcService<ANetworkRpcMethods>) => void,
    acceptInternal: (service: AInternalRpcService<object>) => void
): void {
    // @ts-expect-error - unrelated objects do not own an internal runtime root.
    type Unrelated = RuntimeConnection<{ other: string }>;
    // @ts-expect-error - connect requires an internal root, not an arbitrary object.
    host.connect<{ other: string }>(port, {
        sameRealm: true,
        remoteRelation: "child"
    });
    // @ts-expect-error - network routers cannot own internal transports.
    new InternalTransport(network, port);
    // @ts-expect-error - internal routers cannot own network transports.
    new LoopbackTransport(internal);
    // @ts-expect-error - internal services cannot be registered in a network service slot.
    acceptNetwork(host.logger);
    // @ts-expect-error - network services cannot be registered in an internal service slot.
    acceptInternal(network.p2pManager.localRpc.initHandshakeService);
    acceptNetwork(network.p2pManager.localRpc.initHandshakeService);
    acceptInternal(host.logger);
    void internal;
}

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

class PingService extends ANetworkRpcService<
    PingRpcMethods,
    P2PManager<PingRpc>
> {
    constructor(
        p2pManager: P2PManager<PingRpc>,
        readonly prefix: string
    ) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({ component: "PingService" })
        );
    }

    createRPCMethods(transport: NetworkTransport): PingRpcMethods {
        return new PingRpcMethods(transport, this);
    }
}

class PingRpcMethods extends ANetworkRpcMethods<PingService> {
    constructor(transport: NetworkTransport, service: PingService) {
        super(transport, service);
    }

    ping(nonce: string): void {
        this.remoteRpc.pingService.pong(this.service.prefix + nonce);
        this.remoteRpc.relayService.recordPing(nonce);
    }

    pong(_nonce: string): void {}

    sum(a: number, b: number): number {
        return a + b;
    }
}

class RelayService extends ANetworkRpcService<
    RelayRpcMethods,
    P2PManager<PingRpc>
> {
    constructor(p2pManager: P2PManager<PingRpc>) {
        super(
            p2pManager.rpcRouter,
            p2pManager.stateManager.logger.child({ component: "RelayService" })
        );
    }

    createRPCMethods(transport: NetworkTransport): RelayRpcMethods {
        return new RelayRpcMethods(transport, this);
    }
}

class RelayRpcMethods extends ANetworkRpcMethods<RelayService> {
    constructor(transport: NetworkTransport, service: RelayService) {
        super(transport, service);
    }

    recordPing(nonce: string): void {
        this.remoteRpc.pingService.pong(nonce);
    }
}

export function assertCustomRpcTypes(
    p2pManager: P2PManager<PingRpc>,
    network: NetworkTransport,
    internal: InternalTransport,
    neutral: ATransport
): void {
    p2pManager.remoteRpc.pingService.sum(1, 2).request(network);
    // @ts-expect-error - internal connections cannot be network recipients.
    p2pManager.remoteRpc.pingService.sum(1, 2).request(internal);
    // @ts-expect-error - neutral transports cannot be network recipients.
    p2pManager.remoteRpc.pingService.sum(1, 2).request(neutral);
    // @ts-expect-error - internal connections cannot be network send targets.
    p2pManager.remoteRpc.pingService.ping("ok").sendOne(internal);
    p2pManager.localRpc.pingService.prefix;
    p2pManager.remoteRpc.pingService.ping("ok");
    p2pManager.remoteRpc.relayService.recordPing("ok");

    const fireAndForget = p2pManager.remoteRpc.pingService.ping("ok");
    fireAndForget.broadcast();
    fireAndForget.sendOne();
    fireAndForget.sendMultiple([]);

    const request = p2pManager.remoteRpc.pingService.sum(1, 2);
    request.request();

    // @ts-expect-error - void methods do not expose request delivery.
    fireAndForget.request();

    // @ts-expect-error - value methods do not expose fire-and-forget delivery.
    request.sendOne();

    // @ts-expect-error - ping expects a string nonce.
    p2pManager.remoteRpc.pingService.ping(123);

    // @ts-expect-error - missing services are not exposed.
    p2pManager.remoteRpc.missingService;
}
