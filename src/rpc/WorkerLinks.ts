import type ATransport from "@/transport/ATransport";
import type { Logger } from "@/utils/logging/Logger";
import type PortRpcRouter from "./PortRpcRouter";

/** which side of the realm tree the far end of a link sits on */
export type WorkerLinkSide = "parent" | "child";

/** a child's role, plus an instance when a realm can host several:
 *  `sdk:<peerAddress>`, `vm` */
export type LinkId = string;

/** one worker port this realm holds, with the router that serves it and the
 *  logger whose context crosses it */
export type WorkerLink = {
    id: LinkId;
    transport: ATransport;
    router: PortRpcRouter<any>;
    remoteRealm: WorkerLinkSide;
    ownerLogger: Logger;
};

type LinkListener = (link: WorkerLink, change: "added" | "removed") => void;

/**
 * the realm's neighbours in the worker tree: at most one parent, children by
 * id. service-neutral - a tree-wide operation (log collection, a drain) reads
 * it and brings its own service; the registry never knows what runs over a
 * link.
 */
export class WorkerLinks {
    parent?: WorkerLink;
    readonly children = new Map<LinkId, WorkerLink>();
    private readonly listeners = new Set<LinkListener>();

    /** registers the link; returns its remover */
    add(link: WorkerLink): () => void {
        if (link.remoteRealm === "parent") this.parent = link;
        else this.children.set(link.id, link);
        for (const listener of this.listeners) listener(link, "added");
        return () => this.remove(link);
    }

    remove(link: WorkerLink): void {
        if (this.parent === link) this.parent = undefined;
        else if (this.children.get(link.id) !== link) return;
        else this.children.delete(link.id);
        for (const listener of this.listeners) listener(link, "removed");
    }

    /** every link but the one a request came in on */
    neighbours(except?: ATransport): WorkerLink[] {
        const all = this.parent
            ? [this.parent, ...this.children.values()]
            : [...this.children.values()];
        return all.filter((link) => link.transport !== except);
    }

    byTransport(transport: ATransport): WorkerLink | undefined {
        return this.neighbours().find((link) => link.transport === transport);
    }

    /** replays the links already held, then follows every change */
    onChange(listener: LinkListener): () => void {
        this.listeners.add(listener);
        for (const link of this.neighbours()) listener(link, "added");
        return () => {
            this.listeners.delete(listener);
        };
    }
}

/** this realm's links. each thread loads its own copy of this module -> its
 *  own registry, the scope a worker tree is walked at. */
export const realmWorkerLinks = new WorkerLinks();

export default WorkerLinks;
