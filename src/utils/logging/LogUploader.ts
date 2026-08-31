import axios from "axios";
import { compressToBase64, encodeLogs } from "./logEncoder";
import { LogStore } from "./logStore";
import {
    type ExclusiveLoggerContext,
    type LogThreadName,
    type SharedLoggerContext,
    Logger
} from "./Logger";
import { ethers } from "ethers";
import { retry } from "../retry";
import { config as globalConfig } from "../config";
import { sleep } from "..";
import { DetachedPromises } from "../DetachedPromises";
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
/** what one realm's upload achieved */
export type LogUploadOutcome = {
    ok: boolean;
    entries: number;
};

export type LogUploaderConfig = {
    uploadEndpoint: string;
    apiToken?: string;
    /** upper bound of the random per-upload jitter; 0 disables it */
    jitterMaxMs?: number;
};

export abstract class LogUploader {
    protected logger?: Logger;
    private destroyed = false;
    /** highest seq a 2xx acknowledged; -1 = nothing yet */
    private lastUploadedSeq = -1;
    /** the channel/peer that watermark was acked under. a change means the
     *  earlier entries went to a different bucket -> re-send them there too */
    private lastUploadedKey?: string;
    /** the running POST, and at most one queued behind it */
    private activeUpload?: Promise<LogUploadOutcome>;
    private queuedUpload?: Promise<LogUploadOutcome>;

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

    public isEnabled(): boolean {
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

    // Single owner of unhandled-error capture for both platforms (browser window
    // events, node process events). Normalizes the reason safely, then logs it -
    // Logger.error() stores it and schedules the upload. Redaction of the error
    // graph happens once, in encodeLogEntry, so both crash paths stay in sync.
    public captureUnhandled(reason: unknown, source: string): void {
        const error =
            reason instanceof Error
                ? reason
                : new Error(LogUploader.safeStringify(reason));
        this.logger?.error(`Unhandled ${source} captured for log upload`, {
            error
        });
        // error() already scheduled this realm; the round adds the rest
        const round = this.logger?.flushAllRealms(`unhandled ${source}`);
        if (round) DetachedPromises.collect(round);
    }

    // A non-Error rejection reason can have a throwing toString; the global crash
    // handler must not itself throw and lose the rejection.
    private static safeStringify(reason: unknown): string {
        try {
            return String(reason);
        } catch {
            return "[unstringifiable rejection reason]";
        }
    }

    // spreads the upload bursts of many realms apart
    protected getJitterMs(): number {
        const maxMs =
            this.config.jitterMaxMs ??
            globalConfig.CRASH_LOG_UPLOAD_JITTER_MAX_MS;
        return Math.floor(Math.random() * maxMs);
    }

    /** depth-one queue. the bus acks on this promise, so a caller must resolve
     *  only after a POST that covers its entries. */
    public uploadLogs(): Promise<LogUploadOutcome> {
        if (this.queuedUpload) return this.queuedUpload;
        if (!this.activeUpload) return this.startUpload();

        const queued = this.activeUpload
            .catch(() => undefined)
            .then(() => {
                this.queuedUpload = undefined;
                return this.startUpload();
            });
        this.queuedUpload = queued;
        return queued;
    }

    private startUpload(): Promise<LogUploadOutcome> {
        const running = this.postDelta().finally(() => {
            if (this.activeUpload === running) this.activeUpload = undefined;
        });
        this.activeUpload = running;
        return running;
    }

    /** where this realm files a batch; read live, never cached across a sleep */
    private identity() {
        const channelId = this.sharedContext.channelId || ethers.ZeroHash;
        const peerAddress =
            this.sharedContext.peerAddress || ethers.ZeroAddress;
        const threadName: LogThreadName =
            this.sharedContext.threadName ?? "main";
        return {
            channelId,
            peerAddress,
            threadName,
            uploadKey: `${channelId}/${peerAddress}`
        };
    }

    /** the delta cursor for a key: from the top again once the key changed */
    private watermarkFor(uploadKey: string): number {
        return this.lastUploadedKey && this.lastUploadedKey !== uploadKey
            ? -1
            : this.lastUploadedSeq;
    }

    private async postDelta(): Promise<LogUploadOutcome> {
        let rawLogsSize;
        let compressedLogsSize;
        const uploadStartedAt = Date.now();
        try {
            if (!this.isEnabled()) return { ok: true, entries: 0 };

            // checked before the jitter sleep -> a fan-out onto an idle realm
            // costs neither HTTP nor wall time. the cursor is only read here;
            // a changed identity restarts it once the batch is really built
            if (
                this.logStore.getLogsSince(
                    this.watermarkFor(this.identity().uploadKey)
                ).entries.length === 0
            ) {
                return { ok: true, entries: 0 };
            }

            await sleep(this.getJitterMs());

            // identity and delta are read together, after the sleep: a channel
            // or peer set during it files this batch, instead of the batch
            // landing in the old bucket and being sent again under the new one
            const { channelId, peerAddress, threadName, uploadKey } =
                this.identity();
            this.lastUploadedSeq = this.watermarkFor(uploadKey);
            const { entries, fromSeq, toSeq } = this.logStore.getLogsSince(
                this.lastUploadedSeq
            );
            if (entries.length === 0) return { ok: true, entries: 0 };

            // Generate plain log and compress before upload
            const serializedLogs = encodeLogs(entries);
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
                            storeId: this.logStore.storeId,
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
            // advance only on 2xx -> a failed POST re-sends in the next delta
            this.lastUploadedSeq = toSeq;
            this.lastUploadedKey = uploadKey;
            return { ok: true, entries: entries.length };
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
            // swallowed: a failed upload must not break a round or a teardown.
            // console, not the logger -> logging an upload failure would recurse.
            return { ok: false, entries: 0 };
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
