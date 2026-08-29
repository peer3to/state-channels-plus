// @spec-test-coverage-ignore: port router staging shared by the port-link suites; the suites own the declarations
import { MessageChannel, type MessagePort } from "node:worker_threads";

import ARpcMethods from "@/rpc/ARpcMethods";
import ARpcService from "@/rpc/ARpcService";
import PortRpcRouter, { type PortRpcRouterOptions } from "@/rpc/PortRpcRouter";
import type MessagePortTransport from "@/transport/MessagePortTransport";
import type { RemoteRpcServices } from "@/rpc/RemoteRpcProxy";
import { adaptPort } from "@platform/p2pRuntimeChannel";
import { createUploaderFixture } from "@test/fixtures/logging/LogUploader.fixture";
import type { NodeLogger } from "@/utils/logging/node/NodeLogger";
import type { LogStore } from "@/utils/logging/logStore";

type ProbeRouter = PortRpcRouter<ProbeRoot>;

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

    constructor(router: ProbeRouter) {
        this.probe = new ProbeService(router, router.logger);
        this.notice = new NoticeService(router, router.logger);
    }
}

export const PROBE_MANIFEST = [
    "probe",
    "notice"
] as const satisfies readonly (keyof ProbeRoot)[];

export type ProbeEnd = {
    router: ProbeRouter;
    transport: MessagePortTransport;
    far: RemoteRpcServices<ProbeRoot>;
    logger: NodeLogger;
    logStore: LogStore;
};

/** two routers on the two ends of a real MessageChannel, each serving a probe
 *  root and holding a typed endpoint for the other */
export function linkedRouters(
    options: { a?: PortRpcRouterOptions; b?: PortRpcRouterOptions } = {}
): { a: ProbeEnd; b: ProbeEnd; close: () => void } {
    const channel = new MessageChannel();
    const build = (
        port: MessagePort,
        routerOptions: PortRpcRouterOptions | undefined
    ): ProbeEnd => {
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: ""
        });
        const router = new PortRpcRouter<ProbeRoot>(
            (self) => new ProbeRoot(self),
            logger,
            routerOptions
        );
        const transport = router.attach(adaptPort(port));
        return {
            router,
            transport,
            far: router.endpoint<ProbeRoot>(transport, PROBE_MANIFEST),
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
