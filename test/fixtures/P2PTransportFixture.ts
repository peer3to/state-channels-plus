// @spec-test-coverage-ignore: typed SDK-edge recorders for transport component tests
import type { BannablePeerInfo } from "@/PeerProfile";
import type {
    WebRTCConnectionStateName,
    WebRTCDataChannelLike,
    WebRTCIceStateName,
    WebRTCPeerConnectionLike,
    WebRTCStatsReport
} from "@/rpc/network/services/WebRTCSetup/connection/WebRTCConnectionTypes";

type HolepunchSocketEvent = "data" | "close" | "error";

export class RecordingBannablePeerInfo implements BannablePeerInfo {
    public readonly banCalls: boolean[] = [];

    constructor(public readonly publicKey?: string) {}

    public ban(value = true): void {
        this.banCalls.push(value);
    }
}

export class RecordingHolepunchSocket {
    public destroyed = false;
    public readonly writes: string[] = [];
    private readonly listeners = new Map<
        HolepunchSocketEvent,
        ((value?: any) => void)[]
    >();

    public on(
        event: HolepunchSocketEvent,
        listener: (value?: any) => void
    ): void {
        const listeners = this.listeners.get(event) ?? [];
        listeners.push(listener);
        this.listeners.set(event, listeners);
    }

    public write(value: string): void {
        this.writes.push(value);
    }

    public destroy(): void {
        this.destroyed = true;
    }

    public emit(event: HolepunchSocketEvent, value?: any): void {
        for (const listener of this.listeners.get(event) ?? []) listener(value);
    }
}

export class RecordingWebRTCDataChannel implements WebRTCDataChannelLike {
    public readyState = "connecting";
    public onmessage: ((event: { data: any }) => void) | null = null;
    public onopen: ((event?: any) => void) | null = null;
    public onclose: ((event?: any) => void) | null = null;
    public onerror: ((event: any) => void) | null = null;
    public readonly sent: any[] = [];
    public closed = false;

    public send(data: any): void {
        this.sent.push(data);
    }

    public close(): void {
        this.closed = true;
        this.readyState = "closed";
    }
}

/**
 * RTCPeerConnection stand-in. `changeState` sets the states and fires both
 * change events, ICE first, as a browser does; `changeIceState` fires only
 * the ICE one. `getStats` answers with `statsReport`,
 * or rejects with `statsError`; each call first waits for the next entry of
 * `statsHolds`, if any. Without `withStats` the instance has no `getStats`,
 * like the Node implementation.
 */
export class RecordingRTCPeerConnection implements WebRTCPeerConnectionLike {
    public connectionState: WebRTCConnectionStateName = "new";
    public iceConnectionState: WebRTCIceStateName = "new";
    private readonly listeners = {
        connectionstatechange: [] as (() => void)[],
        iceconnectionstatechange: [] as (() => void)[]
    };
    public onicecandidate: ((event: { candidate?: any }) => void) | null = null;
    public statsReport = new Map<string, Record<string, any>>();
    public readonly statsHolds: Promise<void>[] = [];
    public statsError?: Error;
    public getStats?: () => Promise<WebRTCStatsReport>;

    constructor(withStats = true) {
        if (withStats)
            this.getStats = async () => {
                const report = new Map(this.statsReport);
                await this.statsHolds.shift();
                if (this.statsError) throw this.statsError;
                return report;
            };
    }

    public addEventListener(
        type: "connectionstatechange" | "iceconnectionstatechange",
        listener: () => void
    ): void {
        this.listeners[type].push(listener);
    }

    public changeState(
        connectionState: WebRTCConnectionStateName,
        iceState: WebRTCIceStateName
    ): void {
        this.changeIceState(iceState);
        this.connectionState = connectionState;
        for (const listener of this.listeners.connectionstatechange) listener();
    }

    /** Only the ICE state changes, as werift reports an ICE recovery. */
    public changeIceState(iceState: WebRTCIceStateName): void {
        this.iceConnectionState = iceState;
        for (const listener of this.listeners.iceconnectionstatechange)
            listener();
    }

    public createDataChannel(): WebRTCDataChannelLike {
        return new RecordingWebRTCDataChannel();
    }

    public async createOffer(): Promise<any> {
        return {};
    }

    public async createAnswer(): Promise<any> {
        return {};
    }

    public async setLocalDescription(): Promise<void> {}

    public async setRemoteDescription(): Promise<void> {}

    public async addIceCandidate(): Promise<void> {}

    public close(): void {
        this.connectionState = "closed";
    }
}

type HolepunchConnectionListener = (
    socket: RecordingHolepunchSocket,
    info: RecordingBannablePeerInfo
) => void;

/**
 * Hyperswarm stand-in. Each join's announce stays pending until the test
 * settles it with `resolveFlush` or `rejectFlush`; topic lookups
 * (`status(topic).refresh()`) are recorded in `refreshCalls`.
 */
export class RecordingSwarm {
    public readonly joinCalls: {
        topicHex: string;
        options: { server: boolean; client: boolean };
    }[] = [];
    public readonly leaveCalls: string[] = [];
    public readonly refreshCalls: string[] = [];
    public destroyed = false;
    /** When set, every topic lookup rejects with it. */
    public refreshError?: Error;
    private readonly flushes: {
        resolve: () => void;
        reject: (error: Error) => void;
    }[] = [];
    /** Hyperswarm's dial counter, which `startDial` advances. */
    public readonly stats = { connects: { client: { attempted: 0 } } };
    private connectionListener?: HolepunchConnectionListener;
    private readonly updateListeners: (() => void)[] = [];

    public on(
        event: string,
        listener: HolepunchConnectionListener | (() => void)
    ): void {
        if (event === "connection")
            this.connectionListener = listener as HolepunchConnectionListener;
        if (event === "update")
            this.updateListeners.push(listener as () => void);
    }

    public off(event: string, listener: () => void): void {
        if (event !== "update") return;
        const index = this.updateListeners.indexOf(listener);
        if (index !== -1) this.updateListeners.splice(index, 1);
    }

    /** Like EventEmitter: clears the listeners of `event`, or of every event. */
    public removeAllListeners(event?: string | string[]): void {
        const name = event === undefined ? undefined : String(event);
        if (name === undefined || name === "connection")
            this.connectionListener = undefined;
        if (name === undefined || name === "update")
            this.updateListeners.length = 0;
    }

    public get updateListenerCount(): number {
        return this.updateListeners.length;
    }

    /** Emit `update`, as Hyperswarm does after any swarm change. */
    public emitUpdate(): void {
        for (const listener of [...this.updateListeners]) listener();
    }

    /** Start one outbound dial, as Hyperswarm does: count it, then emit `update`. */
    public startDial(): void {
        this.stats.connects.client.attempted += 1;
        this.emitUpdate();
    }

    public join(
        topic: Buffer,
        options: { server: boolean; client: boolean }
    ): { flushed(): Promise<void> } {
        this.joinCalls.push({ topicHex: topic.toString("hex"), options });
        const flushed = new Promise<void>((resolve, reject) =>
            this.flushes.push({ resolve, reject })
        );
        return { flushed: () => flushed };
    }

    /** Complete the announce of the join at `index`. */
    public resolveFlush(index: number): void {
        this.flushes[index].resolve();
    }

    /** Fail the announce of the join at `index`. */
    public rejectFlush(index: number, error: Error): void {
        this.flushes[index].reject(error);
    }

    public status(topic: Buffer): { refresh(): Promise<void> } {
        return {
            refresh: async () => {
                this.refreshCalls.push(topic.toString("hex"));
                if (this.refreshError) throw this.refreshError;
            }
        };
    }

    /** Deliver a new peer connection to the registered listener. */
    public emitConnection(
        socket: RecordingHolepunchSocket,
        info: RecordingBannablePeerInfo
    ): void {
        this.connectionListener?.(socket, info);
    }

    public leave(topic: Buffer): void {
        this.leaveCalls.push(topic.toString("hex"));
    }
}
