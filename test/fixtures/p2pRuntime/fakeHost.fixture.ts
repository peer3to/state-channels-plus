// @spec-test-coverage-ignore: fake runtime host staging shared by the client suites; the suites own the declarations
import type { P2pRuntimeClientRoot } from "@/evm/p2pRuntime/rpc/P2pRuntimeClientRoot";
import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import type Rpc from "@/rpc/Rpc";
import { RpcRouter } from "@/rpc/RpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
import type ATransport from "@/transport/ATransport";
import MessagePortTransport from "@/transport/MessagePortTransport";
import type { RuntimePort } from "@/transport/RuntimePort";

type FakeHostRouter = RpcRouter<FakeHostRoot, P2pRuntimeClientRoot>;

/** a call the script parked: the test learns it arrived, then answers it */
type ParkedCall = {
    arrived: () => void;
    answer: Promise<unknown>;
    settle: (result: unknown) => void;
};

/** what the host's endpoints do. an operation the script does not name answers
 *  `undefined` at once; `park` makes it wait for `settle`. */
export class FakeHostScript {
    /** `service.method` -> the value it answers with, or the error it throws */
    readonly answers = new Map<string, unknown>();
    /** `service.method` -> the call parked until the test answers it */
    private readonly parked = new Map<string, ParkedCall>();

    /** every scripted endpoint runs through here */
    run(operation: string): Promise<any> {
        const parked = this.parked.get(operation);
        if (parked) {
            parked.arrived();
            return parked.answer;
        }
        const answer = this.answers.get(operation);
        if (answer instanceof Error) return Promise.reject(answer);
        return Promise.resolve(answer);
    }

    /** park `operation`; the returned promise settles once the host entered it */
    park(operation: string): Promise<void> {
        let arrived!: () => void;
        const entered = new Promise<void>((resolve) => (arrived = resolve));
        let settle!: (result: unknown) => void;
        const answer = new Promise<unknown>((resolve) => (settle = resolve));
        this.parked.set(operation, { arrived, answer, settle });
        return entered;
    }

    /** answer a parked call */
    settle(operation: string, result: unknown): void {
        this.parked.get(operation)?.settle(result);
    }
}

export class FakeLifecycleRpcMethods extends ARpcMethods<FakeHostRouter> {
    constructor(
        transport: ATransport,
        private readonly service: FakeLifecycleService
    ) {
        super(transport, service.router);
    }

    deployComplete(): Promise<{ webRTCBridge: boolean }> {
        return this.service.script.run("lifecycle.deployComplete");
    }

    quiesce(): Promise<SerializedError[]> {
        return this.service.script.run("lifecycle.quiesce");
    }

    async dispose(): Promise<void> {
        await this.service.script.run("lifecycle.dispose");
    }
}

export class FakeLifecycleService extends ARpcService<
    FakeLifecycleRpcMethods,
    FakeHostRouter
> {
    constructor(
        router: FakeHostRouter,
        readonly script: FakeHostScript
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): FakeLifecycleRpcMethods {
        return new FakeLifecycleRpcMethods(transport, this);
    }
}

export class FakeP2pSignerRpcMethods extends ARpcMethods<FakeHostRouter> {
    constructor(
        transport: ATransport,
        private readonly service: FakeP2pSignerService
    ) {
        super(transport, service.router);
    }

    sendTransaction(): Promise<unknown> {
        return this.service.script.run("p2pSigner.sendTransaction");
    }
}

export class FakeP2pSignerService extends ARpcService<
    FakeP2pSignerRpcMethods,
    FakeHostRouter
> {
    constructor(
        router: FakeHostRouter,
        readonly script: FakeHostScript
    ) {
        super(router, router.logger);
    }

    createRPCMethods(transport: ATransport): FakeP2pSignerRpcMethods {
        return new FakeP2pSignerRpcMethods(transport, this);
    }
}

/** the far end of a runtime port, under the names the client calls */
export class FakeHostRoot {
    readonly lifecycle: FakeLifecycleService;
    readonly p2pSigner: FakeP2pSignerService;

    constructor(router: FakeHostRouter, script: FakeHostScript) {
        this.lifecycle = new FakeLifecycleService(router, script);
        this.p2pSigner = new FakeP2pSignerService(router, script);
    }
}

/**
 * a host on the far port: a real router over a stand-in host root whose
 * endpoints answer what the script says. `client` pushes at the client the way
 * the real host does, and `seen` is every request that reached this end.
 */
export function fakeHost(port: RuntimePort): {
    script: FakeHostScript;
    seen: Rpc[];
    client: RemoteRpcServices<P2pRuntimeClientRoot>;
} {
    const script = new FakeHostScript();
    const seen: Rpc[] = [];
    const router = new RpcRouter<FakeHostRoot, P2pRuntimeClientRoot>(
        (self) => new FakeHostRoot(self, script),
        undefined
    );
    router.onFrameDispatched = (rpc) => seen.push(rpc);
    new MessagePortTransport(port, router, "parent");
    return { script, seen, client: router.remoteRpc };
}
