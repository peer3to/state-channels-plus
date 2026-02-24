import axios from "axios";
import { compressToBase64, encodeLogs } from "./logEncoder";
import { LogStore } from "./logStore";
import { ExclusiveLoggerContext, Logger, SharedLoggerContext } from ".";
import { ethers } from "ethers";

export type LogUploaderOptions = {
    logUploader?: LogUploader;
    logUploaderConfig?: LogUploaderConfig;
    attachErrorListener?: boolean;
};
export type LogUploaderConfig = {
    uploadEndpoint: string;
    apiToken?: string;
};

export abstract class LogUploader {
    protected logger?: Logger;
    private destroyed = false;
    constructor(
        protected readonly logStore: LogStore,
        protected readonly config: LogUploaderConfig,
        protected readonly exclusiveContext: ExclusiveLoggerContext,
        protected readonly sharedContext: SharedLoggerContext,
        attachErrorListener: boolean = false
    ) {
        if (attachErrorListener && this.isEnabled()) {
            this.attachListeners();
        }
    }

    setLogger(logger: Logger) {
        this.logger = logger;
    }
    protected abstract attachListeners(): void;
    protected abstract detachListeners(): void;

    protected isEnabled(): boolean {
        return Boolean(this.config.uploadEndpoint);
    }

    public async uploadLogs(
        unhandledError?: Error,
        isUserInitiated = false
    ): Promise<void> {
        // TODO - use the above arguments
        let rawLogsSize;
        let compressedLogsSize;
        try {
            if (!this.isEnabled()) return;

            const storedLogs = this.logStore.getAllLogs();
            const channelId = this.sharedContext.channelId || ethers.ZeroHash;
            const peerAddress =
                this.sharedContext.peerAddress || ethers.ZeroAddress;

            if (!channelId || !peerAddress) {
                return; // ignore
            }

            // Generate plain log and compress before upload
            const serializedLogs = encodeLogs(storedLogs);
            rawLogsSize = serializedLogs.length * 2;
            const compressedLogs = compressToBase64(serializedLogs);
            compressedLogsSize = compressedLogs.length * 2;

            const headers: Record<string, string> = {
                "Content-Type": "application/json"
            };
            if (this.config.apiToken) {
                headers["Authorization"] = `Bearer ${this.config.apiToken}`;
            }
            // console.trace(
            //     `Log uploading started. Raw size: ${rawLogsSize / 1e6}MB, Compressed size: ${compressedLogsSize / 1e6}MB.`
            // );
            await axios.post(
                this.config.uploadEndpoint,
                {
                    channelId,
                    peerAddress,
                    compressedLogs
                },
                { headers }
            );
            // console.trace(
            //     `Logs uploaded successfully. Raw size: ${rawLogsSize / 1e6}MB, Compressed size: ${compressedLogsSize / 1e6}MB.`
            // );
            // don't clear logs, since if multiple uploads are started, only the first will have the logs
        } catch (uploadError) {
            delete (uploadError as any).config.data;
            console.error(
                `Log upload failed: Raw size: ${rawLogsSize ? rawLogsSize / 1e6 : "N/A"}MB, Compressed size: ${compressedLogsSize ? compressedLogsSize / 1e6 : "N/A"}MB`,
                (uploadError as any).status
            );
        } finally {
        }
    }

    public destroy(): void {
        if (this.destroyed) {
            return;
        }

        // console.trace("Destroying LogUploader");

        this.destroyed = true;
        this.detachListeners();
    }
}

export class BrowserLogUploader extends LogUploader {
    private onWindowError?: (e: ErrorEvent) => void;
    private onWindowUnhandledRejection?: (e: PromiseRejectionEvent) => void;

    protected attachListeners(): void {
        if (typeof window === "undefined") return;

        this.onWindowError = (e: ErrorEvent) => {
            if (e.error) {
                this.uploadLogs(e.error);
            }
        };
        window.addEventListener("error", this.onWindowError);

        this.onWindowUnhandledRejection = (e: PromiseRejectionEvent) => {
            this.uploadLogs(
                e.reason instanceof Error
                    ? e.reason
                    : new Error(String(e.reason))
            );
        };
        window.addEventListener(
            "unhandledrejection",
            this.onWindowUnhandledRejection
        );
    }

    protected detachListeners(): void {
        if (typeof window === "undefined") return;

        if (this.onWindowError) {
            window.removeEventListener("error", this.onWindowError);
            this.onWindowError = undefined;
        }

        if (this.onWindowUnhandledRejection) {
            window.removeEventListener(
                "unhandledrejection",
                this.onWindowUnhandledRejection
            );
            this.onWindowUnhandledRejection = undefined;
        }
    }
}

export class NodeLogUploader extends LogUploader {
    private onUncaughtException?: (error: unknown) => void;
    private onUnhandledRejection?: (reason: unknown) => void;

    protected attachListeners(): void {
        if (typeof process === "undefined" || !process.on) return;

        this.onUncaughtException = (error: unknown) => {
            this.logger?.error(
                " ######### Uncaught exception captured, uploading logs",
                {
                    error
                }
            );
        };
        process.on("uncaughtException", this.onUncaughtException);

        this.onUnhandledRejection = (reason: unknown) => {
            this.logger?.error(
                " ######### Unhandled rejection captured, uploading logs",
                {
                    reason
                }
            );
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
}
