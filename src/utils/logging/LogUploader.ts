import axios from "axios";
import { compressToBase64, encodeLogs } from "./logEncoder";
import { LogStore } from "./logStore";
import {
    type ExclusiveLoggerContext,
    type SharedLoggerContext,
    Logger
} from "./Logger";
import { ethers } from "ethers";
import { retry } from "../retry";
import {
    getAxiosFailureSummary,
    getAxiosRetrySummary,
    sanitizeAxiosErrorForLogging
} from "./axiosErrorUtils";

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
    private lastUploadedSeq = -1;

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

    public getConfig(): LogUploaderConfig {
        return this.config;
    }
    protected abstract attachListeners(): void;
    protected abstract detachListeners(): void;

    protected isEnabled(): boolean {
        return Boolean(this.config.uploadEndpoint);
    }

    protected getAxiosOptions(): Record<string, unknown> {
        return {};
    }

    protected getSyncNetworkSnapshot(
        _endpoint: string,
        _uploadError?: unknown
    ): unknown {
        return undefined;
    }

    protected getDnsLookupSnapshot(_endpoint: string): Promise<unknown> {
        return Promise.resolve(undefined);
    }

    public async uploadLogs(
        _unhandledError?: Error,
        _isUserInitiated = false
    ): Promise<void> {
        if (!this.isEnabled()) return;

        const { entries, fromSeq, toSeq } = this.logStore.getLogsSince(
            this.lastUploadedSeq
        );
        if (entries.length === 0) return; // nothing new

        const channelId = this.sharedContext.channelId || ethers.ZeroHash;
        const peerAddress =
            this.sharedContext.peerAddress || ethers.ZeroAddress;
        const threadName = this.sharedContext.threadName;
        if (!channelId || !peerAddress) return;

        const uploadStartedAt = Date.now();
        const serializedLogs = encodeLogs(entries);
        const rawLogsSize = serializedLogs.length * 2;
        const compressedLogs = compressToBase64(serializedLogs);
        const compressedLogsSize = compressedLogs.length * 2;

        const headers: Record<string, string> = {
            "Content-Type": "application/json"
        };
        if (this.config.apiToken) {
            headers["Authorization"] = `Bearer ${this.config.apiToken}`;
        }
        const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
        headers["x-upload-id"] = uploadId;
        console.trace(
            `Log uploading started. uploadId=${uploadId} channelId=${channelId} peerAddress=${peerAddress} seq=[${fromSeq}..${toSeq}] Raw: ${rawLogsSize / 1e6}MB, Compressed: ${compressedLogsSize / 1e6}MB.`
        );

        try {
            const response = await retry(
                async () =>
                    axios.post(
                        this.config.uploadEndpoint,
                        {
                            channelId,
                            peerAddress,
                            threadName,
                            compressedLogs,
                            fromSeq,
                            toSeq
                        },
                        {
                            headers,
                            timeout: 10_000,
                            ...this.getAxiosOptions()
                        }
                    ),
                {
                    maxRetries: 1,
                    delayMs: 1000,
                    onRetry: (attempt, error) => {
                        const { code, status } = getAxiosRetrySummary(error);
                        console.warn(
                            `Log upload retrying. uploadId=${uploadId} attempt=${attempt + 1} code=${code || "N/A"} status=${status || "N/A"}`
                        );
                    }
                }
            );
            // Advance the watermark ONLY on success; failures merge into the
            // next delta.
            this.lastUploadedSeq = toSeq;
            console.trace(
                `Logs uploaded. uploadId=${uploadId} responseUploadId=${response.headers?.["x-upload-id"] || "N/A"} seq=[${fromSeq}..${toSeq}]`
            );
        } catch (uploadError) {
            sanitizeAxiosErrorForLogging(uploadError);
            const { code, status, statusText, timeout } =
                getAxiosFailureSummary(uploadError);
            const elapsedMs = Date.now() - uploadStartedAt;
            console.error(
                `Log upload failed: uploadId=${uploadId} channelId=${channelId} peerAddress=${peerAddress} seq=[${fromSeq}..${toSeq}] endpoint=${this.config.uploadEndpoint}\n Error: ${String(uploadError)}\n`,
                { code, status, statusText, timeout, elapsedMs }
            );
            // Swallow — uploads are best-effort and must not block teardown.
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
