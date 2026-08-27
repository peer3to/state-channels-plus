// @spec-test-coverage-ignore: typed WebSocket boundary for HolepunchRelay component tests
import sinon from "sinon";

import HolepunchRelay from "@/HolepunchRelay";
import { createLogger } from "@/utils";

type WebSocketListener = (event: unknown) => void;

export class RecordingWebSocket {
    public static instances: RecordingWebSocket[] = [];

    public readonly url: string;
    public readyState = 0;
    public binaryType = "arraybuffer";
    public onopen: (() => void) | null = null;
    public onclose: (() => void) | null = null;
    public onerror: ((error: Error) => void) | null = null;
    public onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;
    private readonly listeners = new Map<string, Set<WebSocketListener>>();

    constructor(url: string) {
        this.url = url;
        RecordingWebSocket.instances.push(this);
    }

    public addEventListener(type: string, listener: WebSocketListener): void {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    public removeEventListener(
        type: string,
        listener: WebSocketListener
    ): void {
        this.listeners.get(type)?.delete(listener);
    }

    public send(): void {}

    public close(): void {
        this.readyState = 3;
    }

    public emitOpen(): void {
        this.readyState = 1;
        this.emit("open", {});
        this.onopen?.();
    }

    public emitClose(): void {
        this.readyState = 3;
        this.emit("close", {});
        this.onclose?.();
    }

    public emitError(error = new Error("relay unavailable")): void {
        this.emit("error", error);
        this.onerror?.(error);
    }

    private emit(type: string, event: unknown): void {
        for (const listener of this.listeners.get(type) ?? []) listener(event);
    }
}

export class HolepunchRelayFixture {
    private readonly sandbox = sinon.createSandbox();
    private webSocketDescriptor?: PropertyDescriptor;
    private clock?: sinon.SinonFakeTimers;
    private updateCount = 0;

    public setup(randomValues: number[] = [0]): void {
        this.clock = this.sandbox.useFakeTimers();
        let randomIndex = 0;
        this.sandbox.stub(Math, "random").callsFake(() => {
            const value =
                randomValues[Math.min(randomIndex, randomValues.length - 1)];
            randomIndex += 1;
            return value;
        });
        RecordingWebSocket.instances = [];
        this.webSocketDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            "WebSocket"
        );
        Object.defineProperty(globalThis, "WebSocket", {
            configurable: true,
            value: RecordingWebSocket
        });
    }

    public init(urls: string[]): void {
        HolepunchRelay.init(
            urls,
            () => {
                this.updateCount += 1;
            },
            createLogger({}, {}, { level: "error", attachErrorListener: false })
        );
    }

    public reset(randomValues: number[]): void {
        this.cleanup();
        this.setup(randomValues);
    }

    public latestSocket(): RecordingWebSocket {
        const socket =
            RecordingWebSocket.instances[
                RecordingWebSocket.instances.length - 1
            ];
        if (!socket) throw new Error("HolepunchRelay did not open a WebSocket");
        return socket;
    }

    public sockets(): RecordingWebSocket[] {
        return [...RecordingWebSocket.instances];
    }

    public updates(): number {
        return this.updateCount;
    }

    public tick(milliseconds: number): void {
        this.clock?.tick(milliseconds);
    }

    public cleanup(): void {
        this.sandbox.restore();
        if (this.webSocketDescriptor) {
            Object.defineProperty(
                globalThis,
                "WebSocket",
                this.webSocketDescriptor
            );
        } else {
            Reflect.deleteProperty(globalThis, "WebSocket");
        }
        this.webSocketDescriptor = undefined;
        this.clock = undefined;
        this.updateCount = 0;
        RecordingWebSocket.instances = [];
    }
}
