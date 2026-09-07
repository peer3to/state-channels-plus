// @spec-test-coverage-ignore: typed SDK-edge recorders for transport component tests
import type { BannablePeerInfo } from "@/PeerProfile";
import type { WebRTCDataChannelLike } from "@/rpc/services/WebRTCSetup/connection/WebRTCConnectionTypes";

type HolepunchSocketEvent = "data" | "close" | "error";

export class RecordingBannablePeerInfo implements BannablePeerInfo {
    public readonly banCalls: boolean[] = [];

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

export class RecordingSwarm {
    public readonly joinCalls: {
        topicHex: string;
        options: { server: boolean; client: boolean };
    }[] = [];
    public readonly leaveCalls: string[] = [];

    public on(): void {}

    public removeAllListeners(): void {}

    public join(
        topic: Buffer,
        options: { server: boolean; client: boolean }
    ): void {
        this.joinCalls.push({ topicHex: topic.toString("hex"), options });
    }

    public leave(topic: Buffer): void {
        this.leaveCalls.push(topic.toString("hex"));
    }
}
