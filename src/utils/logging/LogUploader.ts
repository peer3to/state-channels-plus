import {
    getAxiosFailureSummary,
    getAxiosRetrySummary,
    sanitizeAxiosErrorForLogging
} from "./axiosErrorUtils";
import { compressToBase64, encodeLogs } from "./logEncoder";
import {
    type ExclusiveLoggerContext,
    type LogThreadName,
    type SharedLoggerContext,
    Logger
} from "./Logger";
import { LogStore } from "./logStore";
import { config as globalConfig } from "../config";
import { abortableSleep, retry } from "../retry";
import { settleBy } from "../settleBy";
import axios from "axios";
import { ethers } from "ethers";

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

const BUSY_UPLOADERS_KEY: unique symbol = Symbol.for("peer3.busyLogUploaders");

export abstract class LogUploader {
    /** This realm's uploaders with an upload running or queued; one set for every copy of this module. */
    private static readonly busyUploaders: Set<LogUploader> = ((
        globalThis as { [BUSY_UPLOADERS_KEY]?: Set<LogUploader> }
    )[BUSY_UPLOADERS_KEY] ??= new Set());

    /** Aborted once its thread ended: every upload of this uploader, a queued one too, ends at once. */
    private readonly cancel = new AbortController();
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
    /**
     * How long an ending thread waits for the running and the queued upload: the latest deadline
     * of the flushes (abort or dispose) that asked for it or that it overlaps, endless (up to the
     * thread's own bound) for a request outside any flush; a later bounded flush also bounds an
     * endless queued upload.
     */
    private activeDeadlineMs = Infinity;
    private queuedDeadlineMs = Infinity;

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

    /**
     * Cancels every upload of this realm still running or queued; those uploaders start no
     * further upload. A worker thread calls it as it ends: an open upload, its retry
     * delay or its jitter wait keeps the loop alive after disposal, past an abort's flush
     * bound. A realm whose thread lives on keeps its uploads running after disposal.
     */
    public static cancelRealmUploads(): void {
        for (const uploader of LogUploader.busyUploaders) {
            uploader.cancel.abort();
        }
    }

    /**
     * Waits for every upload of this realm still running or queued, at most `timeoutMs`, and
     * never past the deadline of the flush (abort or dispose) an upload is part of (that flush already
     * waited for it). A thread that ends right after an error (a dispose) would otherwise
     * cancel the upload that error started, during its jitter wait.
     */
    public static async settleRealmUploads(timeoutMs: number): Promise<void> {
        await Promise.all(
            [...LogUploader.busyUploaders].map((uploader) =>
                uploader.settle(timeoutMs)
            )
        );
    }

    setLogger(logger: Logger) {
        this.logger = logger;
    }
    public isEnabled(): boolean {
        return Boolean(this.config.uploadEndpoint);
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
    }

    /**
     * One active upload and at most one follow-up; callers await only local work.
     * `flushDeadlineMs`: the flush (abort or dispose) this upload is part of, if any.
     */
    public uploadLogs(flushDeadlineMs?: number): Promise<LogUploadOutcome> {
        // A request while a flush's upload is pending is bounded by that flush: the
        // abort's disposal ends the threads at its deadline.
        const pendingDeadlineMs = this.queuedUpload
            ? this.queuedDeadlineMs
            : this.activeUpload
              ? this.activeDeadlineMs
              : Infinity;
        const deadlineMs =
            flushDeadlineMs ??
            (pendingDeadlineMs > Date.now() ? pendingDeadlineMs : Infinity);
        if (this.queuedUpload) {
            // a bounded flush also bounds a follow-up queued without one
            this.queuedDeadlineMs =
                this.queuedDeadlineMs === Infinity
                    ? deadlineMs
                    : Math.max(this.queuedDeadlineMs, deadlineMs);
            return this.queuedUpload;
        }
        LogUploader.busyUploaders.add(this);
        if (!this.activeUpload) {
            this.activeDeadlineMs = deadlineMs;
            return this.startUpload();
        }

        this.queuedDeadlineMs = deadlineMs;
        const queued = this.activeUpload
            .catch(() => undefined)
            .then(() => {
                this.queuedUpload = undefined;
                this.activeDeadlineMs = this.queuedDeadlineMs;
                return this.startUpload();
            });
        this.queuedUpload = queued;
        return queued;
    }

    public destroy(): void {
        if (this.destroyed) {
            return;
        }

        // console.trace("Destroying LogUploader");

        this.destroyed = true;
        this.detachListeners();
        this.logger = undefined;
    }

    protected abstract attachListeners(): void;
    protected abstract detachListeners(): void;

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

    // spreads the upload bursts of many realms apart
    protected getJitterMs(): number {
        const maxMs =
            this.config.jitterMaxMs ??
            globalConfig.CRASH_LOG_UPLOAD_JITTER_MAX_MS;
        return Math.floor(Math.random() * maxMs);
    }

    private async settle(timeoutMs: number): Promise<void> {
        const [upload, deadlineMs] = this.queuedUpload
            ? [this.queuedUpload, this.queuedDeadlineMs]
            : [this.activeUpload, this.activeDeadlineMs];
        if (!upload) return;
        await settleBy(
            upload.catch(() => undefined),
            Math.min(Date.now() + timeoutMs, deadlineMs)
        );
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

    private startUpload(): Promise<LogUploadOutcome> {
        const running = this.postDelta().finally(() => {
            if (this.activeUpload === running) this.activeUpload = undefined;
            if (!this.activeUpload && !this.queuedUpload)
                LogUploader.busyUploaders.delete(this);
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
            this.sharedContext.threadName ?? globalThis.threadName;
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
        const { signal } = this.cancel;
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

            // a flush's upload sleeps at most half the time left to its deadline
            await abortableSleep(
                Math.min(
                    this.getJitterMs(),
                    Math.max(0, (this.activeDeadlineMs - Date.now()) / 2)
                ),
                signal
            );
            if (signal.aborted) return { ok: false, entries: 0 };

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
                () =>
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
                            signal,
                            ...this.getAxiosOptions()
                        }
                    ),
                {
                    maxRetries: 1,
                    delayMs: 1000,
                    // A canceled upload is not retried.
                    signal,
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
            // Canceled as its thread ends: no diagnostics, which would start new network work.
            if (signal.aborted) return { ok: false, entries: 0 };
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
}
