import axios from "axios";
import {
    compressToBase64,
    decompressFromBase64,
    encodeLogs
} from "./logEncoder";
import { LogStore } from "./logStore";
import { ExclusiveLoggerContext, SharedLoggerContext } from ".";

export type LogUploaderOptions = {
    logUploader?: LogUploader;
    logUploaderConfig?: LogUploaderConfig;
    attachErrorListener?: boolean;
};
export type LogUploaderConfig = {
    enabled: boolean;
    uploadEndpoint: string;
    apiToken?: string;
};

export abstract class LogUploader {
    protected uploadInProgress = false;
    protected endpointUrl: string;
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
        this.endpointUrl = config.uploadEndpoint;
    }

    protected abstract attachListeners(): void;

    protected isEnabled(): boolean {
        return Boolean(this.config.enabled && this.config.uploadEndpoint);
    }

    public async uploadLogs(
        unhandledError?: Error,
        isUserInitiated = false
    ): Promise<void> {
        // TODO - use the above arguments
        try {
            if (!this.isEnabled()) return;
            if (this.uploadInProgress) return;
            this.uploadInProgress = true;

            const storedLogs = this.logStore.getAllLogs();
            const channelId = this.sharedContext.channelId;
            const peerAddress = this.sharedContext.peerAddress;

            if (!channelId || !peerAddress) {
                throw new Error("Missing channelId or peerAddress");
            }

            // Generate plain log and compress before upload
            const serializedLogs = encodeLogs(storedLogs);
            // const serializedSize = serializedLogs.length * 2;
            const compressedLogs = compressToBase64(serializedLogs);
            // const compressedSize = compressedLogs.length * 2;

            // const decompressed = decompressFromBase64(compressedLogs);
            // console.log(
            //     "Decompressed logs match:",
            //     decompressed === serializedLogs,
            //     `(${serializedSize} bytes -> ${compressedSize} bytes)`
            // );

            const headers: Record<string, string> = {
                "Content-Type": "application/json"
            };
            if (this.config.apiToken) {
                headers["Authorization"] = `Bearer ${this.config.apiToken}`;
            }

            await axios.post(
                this.endpointUrl,
                {
                    channelId,
                    peerAddress,
                    compressedLogs
                },
                { headers }
            );

            // don't clear logs, since if multiple uploads are started, only the first will have the logs
        } catch (uploadError) {
            console.error("LogUploader upload failed:", uploadError);
        } finally {
            this.uploadInProgress = false;
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
            this.uploadLogs(error);
        });

        process.on("unhandledRejection", (reason) => {
            this.uploadLogs(
                reason instanceof Error ? reason : new Error(String(reason))
            );
        });
    }
}
