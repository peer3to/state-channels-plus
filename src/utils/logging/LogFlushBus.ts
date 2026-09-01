import type { Logger, SharedLoggerContext } from "./Logger";
import type ATransport from "@/transport/ATransport";
import { WorkerLinks, realmWorkerLinks } from "@/rpc/WorkerLinks";
import { logControlPortOver } from "./rpc/logControl/logControlPort";
import {
    emptyFlushResult,
    sumFlushResults,
    type LogControlPort,
    type LogFlushResult,
    type LogPortHandle,
    type LogRemoteRealm
} from "./logControl";

/**
 * one per realm: that realm's root loggers, and one port per neighbouring
 * realm. the links across all realms must form a TREE - a round is forwarded
 * everywhere but where it came from and there is no loop guard, so a cycle
 * circulates a round forever.
 */
export class LogFlushBus {
    /** the links this realm holds; every one is a port here for as long as it
     *  is held. the bus never learns what service runs across a link. */
    readonly links: WorkerLinks;
    private readonly roots = new Set<Logger>();
    /** port -> the root logger whose context it carries */
    private readonly portOwners = new Map<LogControlPort, Logger>();
    /** the link a port stands on -> the port; how an inbound call finds its port */
    private readonly portsByTransport = new Map<
        ATransport,
        { port: LogControlPort; handle: LogPortHandle }
    >();
    /** root -> roots in this realm that follow its channel */
    private readonly contextFollowers = new Map<Logger, Set<Logger>>();

    constructor(links: WorkerLinks = new WorkerLinks()) {
        this.links = links;
        links.onChange((link, change) => {
            if (change === "added") {
                const port = logControlPortOver(link);
                const handle = this.addPort(port, link.ownerLogger);
                this.portsByTransport.set(link.transport, { port, handle });
                return;
            }
            const held = this.portsByTransport.get(link.transport);
            if (!held) return;
            this.portsByTransport.delete(link.transport);
            held.handle.remove();
        });
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
            remove: () => {
                this.portOwners.delete(port);
            }
        };
    }

    /** the port standing on the link a call came in on */
    public portFor(transport: ATransport): LogControlPort | undefined {
        return this.portsByTransport.get(transport)?.port;
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

    /** originate a round. returns at once when no root here uploads - "uploads
     *  off" is realm-wide, so there is nothing to collect. */
    public flushAll(reason: string): Promise<LogFlushResult> {
        if (!this.hasUploadTarget()) return Promise.resolve(emptyFlushResult());
        return this.round(reason, undefined);
    }

    /** upload this realm's own stores and nothing else. a thread about to end
     *  waits on this rather than on a round - the realms across its ports are
     *  still running and upload on their own. */
    public flushOwnRealm(): Promise<LogFlushResult> {
        return this.localFlush();
    }

    /** note on every root here what a round reached, and upload that note.
     *  `failed` and `timedOut` name realms whose logs are missing from the
     *  report - the uploaded files cannot show that on their own. */
    public recordRoundResult(
        reason: string,
        result: LogFlushResult
    ): Promise<LogFlushResult> {
        for (const root of this.roots) {
            root.warn("Log flush round reached", { reason, ...result });
        }
        return this.flushOwnRealm();
    }

    /** a neighbour asked: run a round that skips the port it came in on and
     *  answer with what it reached. the reply is the ack. */
    public receiveFlush(
        reason: string,
        fromPort: LogControlPort | undefined
    ): Promise<LogFlushResult> {
        return this.round(reason, fromPort);
    }

    /** a neighbour's context changed: apply what its side of the tree may set */
    public applyInboundContext(
        port: LogControlPort,
        context: SharedLoggerContext
    ): void {
        const owner = this.portOwners.get(port);
        if (!owner) return;
        const update = this.inboundContext(context, port.remoteRealm);
        if (Object.keys(update).length === 0) return;
        owner.updateSharedContext(update);
    }

    private hasUploadTarget(): boolean {
        for (const logger of this.roots) {
            if (logger.isUploadEnabled()) return true;
        }
        return false;
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
            port.postContext({ ...context });
        } catch {
            // realm across the port is gone -> its context is moot
        }
    }

    /** every request is its own round: forward on every port but the one it
     *  came in on, upload here, add up. nothing is shared between askers and
     *  no handler waits on another realm's answer, so two realms originating
     *  at once cannot deadlock. the only coalescing is the uploader's
     *  depth-one queue -> a request arriving during an upload is answered by
     *  one that starts after it, never by the one already running. */
    private async round(
        reason: string,
        excluded: LogControlPort | undefined
    ): Promise<LogFlushResult> {
        const forwarded = [...this.portOwners.keys()]
            .filter((port) => port !== excluded)
            .map((port) => this.forward(port, reason));
        return sumFlushResults(
            await Promise.all([this.localFlush(), ...forwarded])
        );
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

    /** ask the far realm and take its totals. the call's own bound and the
     *  link closing both reject -> that realm never answered. */
    private async forward(
        port: LogControlPort,
        reason: string
    ): Promise<LogFlushResult> {
        try {
            return await port.flush(reason);
        } catch {
            return { ok: 0, failed: 0, timedOut: 1, entries: 0 };
        }
    }
}

/** this realm's bus. each thread loads its own copy of this module -> its own
 *  bus, which is the scope ports and root loggers live at. */
export const realmLogFlushBus = new LogFlushBus(realmWorkerLinks);

export default LogFlushBus;
