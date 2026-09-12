// @spec-test-coverage-ignore: fake runtime host staging shared by the client suites; the suites own the declarations
import type { P2pRuntimeClientRoot } from "@/evm/p2pRuntime/rpc/P2pRuntimeClientRoot";
import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import type Rpc from "@/rpc/Rpc";
import { RpcRouter } from "@/rpc/RpcRouter";
import type { SerializedError } from "@/rpc/serializeError";
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
class FakeHostScript {
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

class FakeLifecycleRpcMethods extends ARpcMethods<FakeHostRouter> {
    deployComplete(): Promise<{ webRTCBridge: boolean }> {
        return this.localRpc.script.run("lifecycle.deployComplete");
    }

    quiesce(): Promise<SerializedError[]> {
        return this.localRpc.script.run("lifecycle.quiesce");
    }

    async dispose(): Promise<void> {
        await this.localRpc.script.run("lifecycle.dispose");
    }
}

class FakeP2pSignerRpcMethods extends ARpcMethods<FakeHostRouter> {
    sendTransaction(): Promise<unknown> {
        return this.localRpc.script.run("p2pSigner.sendTransaction");
    }
}

/** the far end of a runtime port, under the names the client calls */
class FakeHostRoot {
    readonly lifecycle: ARpcService<FakeLifecycleRpcMethods, FakeHostRouter>;
    readonly p2pSigner: ARpcService<FakeP2pSignerRpcMethods, FakeHostRouter>;

    constructor(
        router: FakeHostRouter,
        readonly script: FakeHostScript
    ) {
        this.lifecycle = new ARpcService(
            router,
            router.logger,
            FakeLifecycleRpcMethods
        );
        this.p2pSigner = new ARpcService(
            router,
            router.logger,
            FakeP2pSignerRpcMethods
        );
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
