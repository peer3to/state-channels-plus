import { LoggerRpcMethods } from "./LoggerRpcMethods";
import type { SharedLoggerContext } from "../../../../utils/logging/Logger";
import type { AInternalRpcRoot } from "@/rpc/internal/AInternalRpcRoot";
import { AInternalRpcService } from "@/rpc/internal/AInternalRpcService";
import type InternalTransport from "@/transport/InternalTransport";
import { config } from "@/utils/config";
import { DetachedPromises } from "@/utils/DetachedPromises";
import type { LogStore } from "@/utils/logging/logStore";
import type { LogUploadOutcome } from "@/utils/logging/LogUploader";
import { randomHexId } from "@/utils/randomHexId";
import { settleBy } from "@/utils/settleBy";

/** Store uploads stay with their logger family; the service coordinates neighbours.
 * Adopting the generation index before forwarding prevents cycles from repeating uploads. */
export class LoggerService extends AInternalRpcService<LoggerRpcMethods> {
    private readonly stores = new Map<
        LogStore,
        {
            upload: () => Promise<LogUploadOutcome>;
            detach: () => void;
            updateContext: (context: SharedLoggerContext) => void;
        }
    >();
    private uploadIndex = 0;
    private windowEndsAt = 0;
    private pendingUpload?: ReturnType<typeof setTimeout>;
    private disposed = false;
    private contextSender?: InternalTransport;
    /** Flushes this realm took part in: a flush that reaches it again settles at once. */
    private readonly flushIds = new Set<string>();

    constructor(private readonly root: AInternalRpcRoot) {
        super(root.router);
        root.onClosed(() => this.dispose());
    }

    public createRPCMethods(sender: InternalTransport) {
        return new LoggerRpcMethods(this, sender);
    }

    public get attachedLogger() {
        return this.root.rootLogger;
    }

    public attachStore(
        store: LogStore,
        callbacks: {
            upload: () => Promise<LogUploadOutcome>;
            detach: () => void;
            updateContext: (context: SharedLoggerContext) => void;
        }
    ): void {
        if (this.disposed) throw new Error("Logger service has been disposed");
        if (!this.stores.has(store)) this.stores.set(store, callbacks);
    }

    public detachStore(store: LogStore): void {
        const callbacks = this.stores.get(store);
        this.stores.delete(store);
        callbacks?.detach();
    }

    public dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        clearTimeout(this.pendingUpload);
        this.pendingUpload = undefined;
        for (const store of this.stores.keys()) this.detachStore(store);
    }

    /** A local logger already schedules its own upload. */
    public uploadStarted(store: LogStore, reason: string): void {
        if (this.disposed || Date.now() < this.windowEndsAt) return;
        if (this.uploadIndex === Number.MAX_SAFE_INTEGER)
            throw new Error("Logger upload index exhausted");
        this.uploadIndex += 1;
        this.windowEndsAt = Date.now() + config.CRASH_LOG_UPLOAD_COALESCE_MS;
        this.forward(reason);
        this.uploadStores(store);
    }

    /**
     * A flush of every reachable realm that settles within the configured bound.
     * With no upload endpoint there is nothing to flush: every realm runs with
     * its creator's configuration, so none of them can upload either.
     */
    public startFlush(): Promise<void> {
        if (!config.CRASH_LOG_UPLOAD_ENDPOINT) return Promise.resolve();
        return this.flush(
            randomHexId(),
            Date.now() + config.CRASH_LOG_FLUSH_MS
        );
    }

    /**
     * Uploads every store of this realm now, without the coalescing window, and
     * asks each other open neighbour to do the same; settles once all of them
     * have, or at the deadline. Every realm stops waiting at the same deadline,
     * leaving out what has not uploaded by then (a worker cancels it as its
     * thread ends, see cancelRealmUploads). It never fails: a neighbour's
     * failure is reported through this realm's root at once, since a reply
     * after the deadline would reach no one, and the other uploads run on.
     */
    public async flush(
        flushId: string,
        deadlineMs: number,
        sender?: InternalTransport
    ): Promise<void> {
        if (this.disposed || this.flushIds.has(flushId)) return;
        this.flushIds.add(flushId);
        const report = (error: unknown) => this.root.reportError(error);
        const neighbours = [...this.root.connections]
            .filter(
                ([transport, remoteRoot]) =>
                    transport !== sender && !remoteRoot.isClosed
            )
            .map(([, remoteRoot]) =>
                remoteRoot.rpc.logger
                    .flush(flushId, deadlineMs)
                    // settleBy bounds the wait; closure rejects the request.
                    .request({ timeoutMs: null })
                    .catch((error: unknown) => {
                        // A neighbour that closed took its logs with it; that is not a failure.
                        if (!remoteRoot.isClosed) report(error);
                    })
            );
        await settleBy(
            Promise.all([
                // An upload's own failure is a network outcome it reports itself.
                ...[...this.stores.values()].map((callbacks) =>
                    callbacks.upload()
                ),
                ...neighbours
            ]),
            deadlineMs
        );
    }

    public upload(
        index: number,
        reason: string,
        sender?: InternalTransport
    ): void {
        this.validateIndex(index);
        if (this.disposed || index <= this.uploadIndex) return;
        // Adopt before forwarding, including synchronous inline connections.
        this.uploadIndex = index;
        this.forward(reason, sender);
        const delay = this.windowEndsAt - Date.now();
        if (delay <= 0) {
            this.windowEndsAt =
                Date.now() + config.CRASH_LOG_UPLOAD_COALESCE_MS;
            this.uploadStores();
        } else if (!this.pendingUpload) {
            this.pendingUpload = setTimeout(() => {
                this.pendingUpload = undefined;
                this.windowEndsAt =
                    Date.now() + config.CRASH_LOG_UPLOAD_COALESCE_MS;
                this.uploadStores();
            }, delay);
        }
    }

    private validateIndex(index: number): void {
        if (!Number.isSafeInteger(index) || index < 0)
            throw new Error(
                "Logger upload index must be a non-negative safe integer"
            );
    }

    private uploadStores(excluded?: LogStore): void {
        for (const [store, callbacks] of this.stores) {
            if (store !== excluded)
                DetachedPromises.collect(callbacks.upload());
        }
    }

    private forward(reason: string, sender?: InternalTransport): void {
        for (const [transport, remoteRoot] of this.root.connections) {
            if (transport === sender || remoteRoot.isClosed) continue;
            try {
                remoteRoot.rpc.logger.upload(this.uploadIndex, reason).send();
            } catch {
                // A closed neighbour must not prevent other stores from uploading.
            }
        }
    }

    /** Connection exchange synchronizes the counter without scheduling an upload. */
    public sendContext(transport: InternalTransport): void {
        this.postContextOn(
            transport,
            this.attachedLogger.getSharedContext() ?? {}
        );
    }

    public postContext(context: SharedLoggerContext): void {
        if (this.disposed) return;
        for (const store of this.stores.values()) store.updateContext(context);
        for (const transport of this.root.connections.keys())
            if (transport !== this.contextSender)
                this.postContextOn(transport, context);
    }

    /** Identity comes from a parent; each physical thread keeps its own name. */
    public contextUpdate(
        context: SharedLoggerContext,
        index: number,
        sender: InternalTransport
    ): void {
        this.validateIndex(index);
        if (this.disposed) return;
        this.uploadIndex = Math.max(this.uploadIndex, index);
        const remoteRoot = this.root.connections.get(sender);
        if (!remoteRoot || !this.attachedLogger) return;
        const update: SharedLoggerContext = {};
        if (context.channelId !== undefined)
            update.channelId = context.channelId;
        // identity comes from a parent only: a parent realm may host several
        // peers, so a child must not stamp its own onto it
        if (!remoteRoot.sameRealm && remoteRoot.remoteRelation === "parent") {
            if (context.peerId !== undefined) update.peerId = context.peerId;
            if (context.peerAddress !== undefined)
                update.peerAddress = context.peerAddress;
        }
        if (Object.keys(update).length) {
            // Never echo a received update: queued old values would bounce back.
            const previousSender = this.contextSender;
            this.contextSender = sender;
            try {
                this.attachedLogger.updateSharedContext(update);
            } finally {
                this.contextSender = previousSender;
            }
        }
    }

    private postContextOn(
        transport: InternalTransport,
        context: SharedLoggerContext
    ): void {
        const remoteRoot = this.root.connections.get(transport);
        if (!remoteRoot || this.disposed) return;
        remoteRoot.postContext(context, this.uploadIndex);
    }
}
