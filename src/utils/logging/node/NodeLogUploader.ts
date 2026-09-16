import { LogUploader } from "../LogUploader";
import {
    getDnsLookupSnapshot,
    getSyncNetworkSnapshot
} from "./uploadDiagnostics";
import type { Agent } from "https";
import type * as Https from "https";

export class NodeLogUploader extends LogUploader {
    private static uploadAgent?: Agent;
    private onUncaughtException?: (error: unknown) => void;
    private onUnhandledRejection?: (reason: unknown) => void;

    // Overrides LogUploader.getAxiosOptions: use Node diagnostics and connection options.
    protected override getAxiosOptions(): Record<string, unknown> {
        return {
            httpsAgent: NodeLogUploader.getUploadAgent()
        };
    }

    // Overrides LogUploader.getSyncNetworkSnapshot: use Node diagnostics and connection options.
    protected override getSyncNetworkSnapshot(
        endpoint: string,
        uploadError?: unknown
    ): unknown {
        return getSyncNetworkSnapshot(endpoint, uploadError);
    }

    // Overrides LogUploader.getDnsLookupSnapshot: use Node diagnostics and connection options.
    protected override getDnsLookupSnapshot(
        endpoint: string
    ): Promise<unknown> {
        return getDnsLookupSnapshot(endpoint);
    }

    protected attachListeners(): void {
        if (typeof process === "undefined" || !process.on) return;

        this.onUncaughtException = (error: unknown) => {
            this.captureUnhandled(error, "uncaughtException");
        };
        process.on("uncaughtException", this.onUncaughtException);

        this.onUnhandledRejection = (reason: unknown) => {
            this.captureUnhandled(reason, "unhandledRejection");
        };
        process.on("unhandledRejection", this.onUnhandledRejection);
    }

    protected detachListeners(): void {
        if (typeof process === "undefined" || !process.off) return;

        if (this.onUncaughtException) {
            process.off("uncaughtException", this.onUncaughtException);
            this.onUncaughtException = undefined;
        }

        if (this.onUnhandledRejection) {
            process.off("unhandledRejection", this.onUnhandledRejection);
            this.onUnhandledRejection = undefined;
        }
    }

    private static getUploadAgent(): Agent {
        if (!NodeLogUploader.uploadAgent) {
            const { Agent } = require("https") as typeof Https;
            NodeLogUploader.uploadAgent = new Agent({
                keepAlive: true,
                maxSockets: 6,
                maxFreeSockets: 2,
                timeout: 60_000
            });
        }

        return NodeLogUploader.uploadAgent;
    }
}
