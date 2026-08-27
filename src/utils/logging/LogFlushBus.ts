import type { Logger, SharedLoggerContext } from "./Logger";
import { config } from "../config";
import {
    emptyFlushResult,
    sumFlushResults,
    type FlushId,
    type LogControlMessage,
    type LogControlPort,
    type LogContextUpdate,
    type LogFlushRequest,
    type LogFlushResult,
    type LogPortHandle,
    type LogRemoteRealm
} from "./logControl";

/**
 * one per realm: that realm's root loggers, and one port per adjacent realm.
 * ports across all realms must form a TREE - forwarding skips the sender and
 * there is no loop guard, so a cycle circulates a round forever.
 */
export class LogFlushBus {
    private readonly roots = new Set<Logger>();
    /** port -> the root logger whose context it carries */
    private readonly portOwners = new Map<LogControlPort, Logger>();
    /** root -> roots in this realm that follow its channel */
    private readonly contextFollowers = new Map<Logger, Set<Logger>>();
    /** flushId -> ports still owed an ack */
    private readonly pendingAcks = new Map<
        FlushId,
        Map<LogControlPort, (result: LogFlushResult) => void>
    >();
    private activeRound?: Promise<LogFlushResult>;
    /** the active round's own upload. a queued round waits on this instead of
     *  the whole round -> a folded ack never waits on the realm that asked,
     *  which would close a cycle when two realms originate at once. */
    private activeLocalFlush?: Promise<LogFlushResult>;
    private queuedRound?: Promise<LogFlushResult>;
    /** ports the queued round skips: only those every folded trigger came from */
    private queuedExcluded?: Set<LogControlPort>;
    private flushCounter = 0;

    /** read per round: config is reassigned during worker startup, so a value
     *  captured at construction would be the default */
    private get ackTimeoutMs(): number {
        return config.CRASH_LOG_FLUSH_TIMEOUT_MS;
    }

    /** labels a flush id. read off a root because a realm's thread name only
     *  exists once a logger does. */
    private get threadName(): string {
        for (const root of this.roots) {
            const name = root.getSharedContext().threadName;
            if (name) return name;
        }
        return "realm";
    }

    /** adds a root logger; returns the remover. children share the root's store. */
    public registerLogger(logger: Logger): () => void {
        this.roots.add(logger);
        const unregister = () => {
            this.roots.delete(logger);
        };
        logger.attachFlushBus(this, unregister);
        return unregister;
    }

    /** attach a port to an adjacent realm. `owner`'s context is what crosses it,
     *  and what arrives on it lands on `owner`. */
    public addPort(port: LogControlPort, owner: Logger): LogPortHandle {
        const root = owner.rootLogger;
        this.portOwners.set(port, root);
        this.postContextOn(port, root.getSharedContext());
        return {
            receive: (message) => this.receive(message, port),
            remove: () => {
                this.portOwners.delete(port);
                // a removed port can never ack -> settle its waiters now, not
                // at the timeout
                for (const waiting of this.pendingAcks.values()) {
                    waiting.get(port)?.(emptyFlushResult());
                }
            }
        };
    }

    /** inline-host case: two roots on one bus with no port between them. only
     *  the channel travels; peer identity stays in the realm that owns it. */
    public followContext(source: Logger, target: Logger): () => void {
        const sourceRoot = source.rootLogger;
        const targetRoot = target.rootLogger;
        const targets =
            this.contextFollowers.get(sourceRoot) ?? new Set<Logger>();
        targets.add(targetRoot);
        this.contextFollowers.set(sourceRoot, targets);
        this.applyFollowedContext(targetRoot, sourceRoot.getSharedContext());
        return () => {
            const current = this.contextFollowers.get(sourceRoot);
            current?.delete(targetRoot);
            if (current?.size === 0) this.contextFollowers.delete(sourceRoot);
        };
    }

    /** posts a context change to every port and follower of `owner`'s root */
    public postContext(owner: Logger, context: SharedLoggerContext): void {
        const root = owner.rootLogger;
        for (const [port, portOwner] of this.portOwners) {
            if (portOwner !== root) continue;
            this.postContextOn(port, context);
        }
        for (const target of this.contextFollowers.get(root) ?? []) {
            this.applyFollowedContext(target, context);
        }
    }

    private applyFollowedContext(
        target: Logger,
        context: SharedLoggerContext
    ): void {
        const update = this.inboundContext(context, "child");
        if (Object.keys(update).length === 0) return;
        target.updateSharedContext(update);
    }

    // only reached through a LogPortHandle -> the port always matches
    private receive(message: LogControlMessage, port: LogControlPort): void {
        switch (message.type) {
            case "flushRequest":
                this.receiveFlushRequest(message, port);
                return;
            case "flushAck":
                this.pendingAcks.get(message.flushId)?.get(port)?.(
                    message.result
                );
                return;
            case "contextUpdate":
                this.receiveContextUpdate(message, port);
                return;
        }
    }

    /** originate a round. returns at once when no root here uploads - "uploads
     *  off" is realm-wide, so there is nothing to collect. */
    public flushAll(reason: string): Promise<LogFlushResult> {
        if (!this.hasUploadTarget()) return Promise.resolve(emptyFlushResult());
        return this.scheduleRound(reason, undefined);
    }

    private hasUploadTarget(): boolean {
        for (const logger of this.roots) {
            if (logger.isUploadEnabled()) return true;
        }
        return false;
    }

    private receiveFlushRequest(
        message: LogFlushRequest,
        port: LogControlPort
    ): void {
        void this.scheduleRound(message.reason, port).then((result) => {
            try {
                port.post({
                    type: "flushAck",
                    flushId: message.flushId,
                    result
                });
            } catch {
                // realm across the port is gone -> no ack for it
            }
        });
    }

    private receiveContextUpdate(
        message: LogContextUpdate,
        port: LogControlPort
    ): void {
        const owner = this.portOwners.get(port);
        if (!owner) return;
        const update = this.inboundContext(message.context, port.remoteRealm);
        if (Object.keys(update).length === 0) return;
        owner.updateSharedContext(update);
    }

    /** how much of an inbound context to apply. threadName is absent by
     *  construction - every realm owns its own. */
    private inboundContext(
        context: SharedLoggerContext,
        remoteRealm: LogRemoteRealm
    ): SharedLoggerContext {
        const update: SharedLoggerContext = {};
        if (context.channelId !== undefined) {
            update.channelId = context.channelId;
        }
        // identity comes from a parent only: a parent realm may host several
        // peers, so a child must not stamp its own onto it
        if (remoteRealm === "child") return update;
        if (context.peerId !== undefined) update.peerId = context.peerId;
        if (context.peerAddress !== undefined) {
            update.peerAddress = context.peerAddress;
        }
        return update;
    }

    private postContextOn(
        port: LogControlPort,
        context: SharedLoggerContext
    ): void {
        try {
            port.post({ type: "contextUpdate", context: { ...context } });
        } catch {
            // realm across the port is gone -> its context is moot
        }
    }

    /** run a round, or fold into the one already queued. a folded request acks
     *  when that round finishes -> an ack never outruns its POST. */
    private scheduleRound(
        reason: string,
        fromPort: LogControlPort | undefined
    ): Promise<LogFlushResult> {
        if (!this.activeRound) {
            return this.startRound(
                reason,
                fromPort ? new Set([fromPort]) : undefined
            );
        }

        this.foldExclusion(fromPort);
        if (this.queuedRound) return this.queuedRound;

        // waits on the active round's upload only: waiting on the whole round
        // would block behind an ack from the realm that is asking
        const queued = (this.activeLocalFlush ?? this.activeRound)
            .catch(() => undefined)
            .then(() => {
                const excluded = this.queuedExcluded;
                this.queuedRound = undefined;
                this.queuedExcluded = undefined;
                return this.startRound(reason, excluded);
            });
        this.queuedRound = queued;
        return queued;
    }

    private startRound(
        reason: string,
        excluded: Set<LogControlPort> | undefined
    ): Promise<LogFlushResult> {
        const active = this.runRound(
            this.nextFlushId(),
            reason,
            excluded
        ).finally(() => {
            if (this.activeRound === active) {
                this.activeRound = undefined;
                this.activeLocalFlush = undefined;
            }
        });
        this.activeRound = active;
        return active;
    }

    // a port is skipped only when every folded trigger came from it, so widen
    // by union - a reset would forward the round back to the realms that asked
    private foldExclusion(fromPort: LogControlPort | undefined): void {
        if (!fromPort) {
            // local trigger -> reach every port
            this.queuedExcluded = new Set();
            return;
        }
        if (!this.queuedRound || !this.queuedExcluded) {
            this.queuedExcluded = new Set([fromPort]);
            return;
        }
        this.queuedExcluded.add(fromPort);
    }

    private nextFlushId(): FlushId {
        return `${this.threadName}-${++this.flushCounter}`;
    }

    private async runRound(
        flushId: FlushId,
        reason: string,
        excluded: Set<LogControlPort> | undefined
    ): Promise<LogFlushResult> {
        const forwarded = [...this.portOwners.keys()]
            .filter((port) => !excluded?.has(port))
            .map((port) => this.forward(port, flushId, reason));
        const local = this.localFlush();
        this.activeLocalFlush = local;
        return sumFlushResults(await Promise.all([local, ...forwarded]));
    }

    private async localFlush(): Promise<LogFlushResult> {
        const outcomes = await Promise.all(
            [...this.roots].map((logger) => logger.uploadOwnLogs())
        );
        const result = emptyFlushResult();
        for (const outcome of outcomes) {
            if (outcome.ok) result.ok += 1;
            else result.failed += 1;
            result.entries += outcome.entries;
        }
        return result;
    }

    /** post, then wait for the matching flushAck. bounded by ackTimeoutMs so a
     *  wedged thread can't stall teardown. */
    private forward(
        port: LogControlPort,
        flushId: FlushId,
        reason: string
    ): Promise<LogFlushResult> {
        return new Promise<LogFlushResult>((resolve) => {
            let waiting = this.pendingAcks.get(flushId);
            if (!waiting) {
                waiting = new Map();
                this.pendingAcks.set(flushId, waiting);
            }

            let settled = false;
            const settle = (result: LogFlushResult) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                const stillWaiting = this.pendingAcks.get(flushId);
                stillWaiting?.delete(port);
                if (stillWaiting?.size === 0) this.pendingAcks.delete(flushId);
                resolve(result);
            };
            const timer = setTimeout(
                () => settle({ ok: 0, failed: 0, timedOut: 1, entries: 0 }),
                this.ackTimeoutMs
            );
            waiting.set(port, settle);

            try {
                port.post({ type: "flushRequest", flushId, reason });
            } catch {
                settle({ ok: 0, failed: 0, timedOut: 1, entries: 0 });
            }
        });
    }
}

/** this realm's bus. each thread loads its own copy of this module -> its own
 *  bus, which is the scope ports and root loggers live at. */
export const realmLogFlushBus = new LogFlushBus();

export default LogFlushBus;
