// @spec-test-coverage-ignore: port router staging shared by the port-link suites; the suites own the declarations

import { adaptPort } from "@/evm/p2pRuntime/node/P2pRuntimeChannel";
import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import { RpcRouter } from "@/rpc/RpcRouter";
import MessagePortTransport from "@/transport/MessagePortTransport";
import type { LogStore } from "@/utils/logging/logStore";
import type { NodeLogger } from "@/utils/logging/node/NodeLogger";
import { createUploaderFixture } from "@test/fixtures/logging/LogUploader.fixture";
import {
    MessageChannel,
    type MessagePort as NodeMessagePort
} from "node:worker_threads";

type ProbeRouter = RpcRouter<ProbeRoot, ProbeRoot>;

/** request/response endpoints: every return type but void */
export class ProbeRpcMethods extends ARpcMethods<ProbeRouter> {
    constructor(
        transport: MessagePortTransport,
        private readonly service: ProbeService
    ) {
        super(transport, service.router);
    }

    echo(value: unknown): unknown {
        this.service.calls.push("echo");
        return value;
    }

    /** the two values a peer wire could not carry, back as they came */
    echoBinary(value: { amount: bigint; bytes: Uint8Array }): {
        amount: bigint;
        bytes: Uint8Array;
    } {
        return value;
    }

    sum(a: number, b: number): number {
        return a + b;
    }

    throws(message: string): string {
        throw new Error(message);
    }

    /** a contract revert: the caller needs `.data` back to decode it */
    revert(data: string): string {
        const error = new Error("execution reverted") as Error & {
            data: string;
            code: string;
        };
        error.data = data;
        error.code = "CALL_EXCEPTION";
        throw error;
    }

    slow(ms: number): Promise<string> {
        return new Promise((resolve) => setTimeout(() => resolve("done"), ms));
    }

    never(): Promise<string> {
        return new Promise(() => {});
    }
}

export class ProbeService extends ARpcService<ProbeRpcMethods, ProbeRouter> {
    readonly calls: string[] = [];

    createRPCMethods(transport: MessagePortTransport): ProbeRpcMethods {
        return new ProbeRpcMethods(transport, this);
    }
}

/** one-way endpoints: void returns, nothing pending on the caller */
export class NoticeRpcMethods extends ARpcMethods<ProbeRouter> {
    constructor(
        transport: MessagePortTransport,
        private readonly service: NoticeService
    ) {
        super(transport, service.router);
    }

    notice(value: unknown): void {
        this.service.received.push(value);
    }

    noticeThrows(): void {
        throw new Error("one-way handler failed");
    }
}

export class NoticeService extends ARpcService<NoticeRpcMethods, ProbeRouter> {
    readonly received: unknown[] = [];

    createRPCMethods(transport: MessagePortTransport): NoticeRpcMethods {
        return new NoticeRpcMethods(transport, this);
    }
}

export class ProbeRoot {
    readonly probe: ProbeService;
    readonly notice: NoticeService;
    /** a root field that is not a service: `setLogger` must leave it alone */
    readonly notAService = { logger: "untouched" };

    constructor(router: ProbeRouter) {
        this.probe = new ProbeService(router, router.logger);
        this.notice = new NoticeService(router, router.logger);
    }
}

/** a router with no logger and no line: what a worker has until its config
 *  arrived */
export function loggerlessRouter(): {
    router: ProbeRouter;
    logger: NodeLogger;
    close: () => void;
} {
    const { logger } = createUploaderFixture({ uploadEndpoint: "" });
    const router = new RpcRouter<ProbeRoot, ProbeRoot>(
        (self) => new ProbeRoot(self),
        undefined
    );
    return { router, logger, close: () => logger.dispose() };
}

export type ProbeEnd = {
    router: ProbeRouter;
    transport: MessagePortTransport;
    far: RemoteRpcServices<ProbeRoot>;
    logger: NodeLogger;
    logStore: LogStore;
};

/** two routers on the two ends of a real MessageChannel, each serving a probe
 *  root and typed by the other's. `a`/`b` set that end's router policy before
 *  its line is up. */
export function linkedRouters(
    options: {
        a?: (router: ProbeRouter) => void;
        b?: (router: ProbeRouter) => void;
    } = {}
): { a: ProbeEnd; b: ProbeEnd; close: () => void } {
    const channel = new MessageChannel();
    const build = (
        port: NodeMessagePort,
        setPolicy: ((router: ProbeRouter) => void) | undefined
    ): ProbeEnd => {
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: ""
        });
        const router = new RpcRouter<ProbeRoot, ProbeRoot>(
            (self) => new ProbeRoot(self),
            logger
        );
        setPolicy?.(router);
        const transport = new MessagePortTransport(adaptPort(port), router);
        return {
            router,
            transport,
            far: router.remoteRpc,
            logger,
            logStore
        };
    };
    const a = build(channel.port1, options.a);
    const b = build(channel.port2, options.b);
    return {
        a,
        b,
        close: () => {
            a.transport.close(true);
            b.transport.close(true);
            a.logger.dispose();
            b.logger.dispose();
        }
    };
}
