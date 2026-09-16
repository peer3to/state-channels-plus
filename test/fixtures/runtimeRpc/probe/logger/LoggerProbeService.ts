// @spec-test-coverage-ignore: fixture support; executable evidence belongs to its calling test declarations.
import { LoggerProbeRpcMethods } from "./LoggerProbeRpcMethods";
import { RuntimeRpcControl } from "../../RuntimeRpcControl";
import type {
    AInternalRpcRoot,
    RuntimeConnection
} from "@/rpc/internal/AInternalRpcRoot";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type InternalTransport from "@/transport/InternalTransport";
import type { Logger, SharedLoggerContext } from "@/utils/logging/Logger";
import type { LogUploader } from "@/utils/logging/LogUploader";
import { RootCreationControl } from "@test/fixtures/runtimeRpc/RootCreationControl";

export class LoggerProbeService extends AInternalRpcService<LoggerProbeRpcMethods> {
    private uploadCalls = 0;
    private readonly controls = new Map<
        InternalTransport,
        { control: RuntimeRpcControl; relation: "parent" | "child" }
    >();
    constructor(public readonly root: AInternalRpcRoot) {
        super(root.router);
        const uploadStores = root.logger["uploadStores"].bind(root.logger);
        root.logger["uploadStores"] = (...args) => {
            this.uploadCalls += 1;
            uploadStores(...args);
        };
        RootCreationControl.connections(root, (connection) => {
            this.controls.set(connection["transport"], {
                control: RuntimeRpcControl.attachTo(connection),
                relation: connection.remoteRelation
            });
            connection["transport"].onClosed(() =>
                this.controls.delete(connection["transport"])
            );
        });
    }
    public uploadState() {
        const service = this.root.logger;
        return {
            calls: this.uploadCalls,
            index: service["uploadIndex"],
            pending: service["pendingUpload"] !== undefined,
            remainingWindowMs: Math.max(0, service["windowEndsAt"] - Date.now())
        };
    }

    public frames() {
        return [...this.controls.values()].flatMap(({ control, relation }) =>
            control.sent.map((frame) => ({ ...frame, relation }))
        );
    }
    public createRPCMethods(sender: InternalTransport) {
        return new LoggerProbeRpcMethods(this, sender);
    }
    public get logger(): Logger {
        return this.root.rootLogger;
    }
    public clearRealm(): void {
        this.logger.clearLogs();
        for (const { control } of this.controls.values())
            control.sent.length = 0;
    }

    public updateContext(context: SharedLoggerContext): void {
        this.logger.updateSharedContext(context);
    }
    public async visitChild<T>(
        operation: (remote: RuntimeConnection<LoggerProbeRoot>) => Promise<T>
    ): Promise<T> {
        const child = [...this.root.connections.values()].find(
            (entry) => entry.remoteRelation === "child"
        );
        if (!child) throw new Error("Endpoint has no child connection");
        return operation(child.rpc as RuntimeConnection<LoggerProbeRoot>);
    }
    public captureUnhandled(message: string): void {
        const uploader = Reflect.get(this.logger, "logUploader") as LogUploader;
        uploader.captureUnhandled(new Error(message), "unhandledRejection");
    }
}

export type LoggerProbeRoot = AInternalRpcRoot & {
    loggerProbe: LoggerProbeService;
};

export function installLoggerProbe(root: AInternalRpcRoot): void {
    Object.assign(root, { loggerProbe: new LoggerProbeService(root) });
}
