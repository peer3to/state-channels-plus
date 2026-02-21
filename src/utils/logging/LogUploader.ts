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

            await axios.post(
                this.config.uploadEndpoint,
                {
                    channelId,
                    peerAddress,
                    compressedLogs
                },
                { headers }
            );
            console.trace(
                `Logs uploaded successfully. Raw size: ${rawLogsSize / 1e6}MB, Compressed size: ${compressedLogsSize / 1e6}MB.`
            );
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
}

export class BrowserLogUploader extends LogUploader {
    protected attachListeners(): void {
        if (typeof window === "undefined") return;

        window.addEventListener("error", (e) => {
            if (e.error) {
                this.uploadLogs(e.error);
            }
        });

        window.addEventListener("unhandledrejection", (e) => {
            this.uploadLogs(
                e.reason instanceof Error
                    ? e.reason
                    : new Error(String(e.reason))
            );
        });
    }
}

export class NodeLogUploader extends LogUploader {
    protected attachListeners(): void {
        if (typeof process === "undefined" || !process.on) return;

        process.on("uncaughtException", (error) => {
            this.logger?.error(
                " ######### Uncaught exception captured, uploading logs",
                {
                    error
                }
            );
        });

        process.on("unhandledRejection", (reason) => {
            this.logger?.error(
                " ######### Unhandled rejection captured, uploading logs",
                {
                    reason
                }
            );

            throw reason;
        });
    }
}
