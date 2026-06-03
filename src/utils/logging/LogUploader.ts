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
import { sleep } from "..";
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
    private uploadInitiated = false;

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
        unhandledError?: Error,
        isUserInitiated = false
    ): Promise<void> {
        // TODO - use the above arguments
        let rawLogsSize;
        let compressedLogsSize;
        const uploadStartedAt = Date.now();
        try {
            if (!this.isEnabled()) return;

            // Random jitter (0-3s) to spread upload bursts
            const jitterMs = Math.floor(Math.random() * 3000);
            if (this.uploadInitiated) return;
            this.uploadInitiated = true;
            await sleep(jitterMs);
            this.uploadInitiated = false;

            const storedLogs = this.logStore.getAllLogs();
            const channelId = this.sharedContext.channelId || ethers.ZeroHash;
            const peerAddress =
                this.sharedContext.peerAddress || ethers.ZeroAddress;
            const threadName = this.sharedContext.threadName;

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
            const uploadId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
            headers["x-upload-id"] = uploadId;
            console.trace(
                `Log uploading started. uploadId=${uploadId} channelId=${channelId} peerAddress=${peerAddress} Raw size: ${rawLogsSize / 1e6}MB, Compressed size: ${compressedLogsSize / 1e6}MB.`
            );
            const response = await retry(
                async () =>
                    axios.post(
                        this.config.uploadEndpoint,
                        {
                            channelId,
                            peerAddress,
                            threadName,
                            compressedLogs
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
                        const networkSnapshot = this.getSyncNetworkSnapshot(
                            this.config.uploadEndpoint,
                            error
                        );
                        console.warn(
                            `Log upload retrying. uploadId=${uploadId} attempt=${attempt + 1} code=${code || "N/A"} status=${status || "N/A"}`
                        );
                        console.warn(
                            `Log upload retry diagnostics. uploadId=${uploadId}`,
                            networkSnapshot
                        );
                    }
                }
            );
            console.trace(
                `Logs uploaded successfully. uploadId=${uploadId} responseUploadId=${response.headers?.["x-upload-id"] || "N/A"} channelId=${channelId} peerAddress=${peerAddress} Raw size: ${rawLogsSize / 1e6}MB, Compressed size: ${compressedLogsSize / 1e6}MB.`
            );
            // don't clear logs, since if multiple uploads are started, only the first will have the logs
        } catch (uploadError) {
            sanitizeAxiosErrorForLogging(uploadError);

            const {
                code,
                status,
                statusText,
                timeout,
                requestUploadId,
                responseUploadId
            } = getAxiosFailureSummary(uploadError);
            const elapsedMs = Date.now() - uploadStartedAt;
            const networkSnapshot = this.getSyncNetworkSnapshot(
                this.config.uploadEndpoint,
                uploadError
            );
            const dnsSnapshot = await this.getDnsLookupSnapshot(
                this.config.uploadEndpoint
            );

            console.error(
                `Log upload failed: requestUploadId=${requestUploadId || "N/A"} responseUploadId=${responseUploadId || "N/A"} channelId=${this.sharedContext.channelId || ethers.ZeroHash} peerAddress=${this.sharedContext.peerAddress || ethers.ZeroAddress} Raw size: ${rawLogsSize ? rawLogsSize / 1e6 : "N/A"}MB, Compressed size: ${compressedLogsSize ? compressedLogsSize / 1e6 : "N/A"}MB - endpoint: ${this.config.uploadEndpoint}\n Error: ${String(uploadError)}\n`,
                {
                    code,
                    status,
                    statusText,
                    timeout,
                    elapsedMs,
                    networkSnapshot,
                    dnsSnapshot
                }
            );
            // Swallow the error — uploads are best-effort and must not block test teardown
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
