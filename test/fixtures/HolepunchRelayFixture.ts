// @spec-test-coverage-ignore: typed WebSocket boundary for HolepunchRelay component tests

import Holepunch from "@/Holepunch";
import HolepunchRelay, { loadRelayModules } from "@/HolepunchRelay";
import type P2PManager from "@/P2PManager";
import { RelayerPool } from "@/transport/relay/RelayerPool";
import { type Logger, createLogger } from "@/utils";
import { config } from "@/utils/config";
import {
    type UnhandledRejectionRecorder,
    recordUnhandledRejections
} from "@test/fixtures/UnhandledRejectionRecorder";
import sinon from "sinon";

/**
 * A WebSocket whose events the test fires; listeners get real `Event`s whose
 * target is the socket.
 */
export class RecordingWebSocket extends EventTarget {
    public static instances: RecordingWebSocket[] = [];
    /** Each new socket is already CLOSED, as one whose connection failed at once. */
    public static isCreatedClosed = false;

    public readonly url: string;
    public readyState = 0;
    public binaryType = "arraybuffer";
    public onopen: (() => void) | null = null;
    public onclose: ((event: Event) => void) | null = null;
    public onerror: ((event: Event) => void) | null = null;
    public onmessage: ((event: { data: ArrayBuffer }) => void) | null = null;

    constructor(url: string) {
        super();
        this.url = url;
        if (RecordingWebSocket.isCreatedClosed) this.readyState = 3;
        RecordingWebSocket.instances.push(this);
    }

    public send(): void {}

    public close(): void {
        this.readyState = 3;
    }

    public emitOpen(): void {
        this.readyState = 1;
        this.dispatchEvent(new Event("open"));
        this.onopen?.();
    }

    /** A close event with the browser CloseEvent's code and reason. */
    public emitClose(code = 1006, reason = ""): void {
        this.readyState = 3;
        const event = Object.assign(new Event("close"), { code, reason });
        this.dispatchEvent(event);
        this.onclose?.(event);
    }

    public emitError(): void {
        const event = new Event("error");
        this.dispatchEvent(event);
        this.onerror?.(event);
    }

    /**
     * A browser socket that fails before it opens: it is already CLOSED when
     * its error event fires, and its close event follows.
     */
    public failBeforeOpen(): void {
        this.readyState = 3;
        this.emitError();
        this.emitClose();
    }
}

export class HolepunchRelayFixture {
    private readonly sandbox = sinon.createSandbox();
    private webSocketDescriptor?: PropertyDescriptor;
    private clock?: sinon.SinonFakeTimers;
    private updateCount = 0;
    private relay?: HolepunchRelay;
    private logger?: Logger;
    private failureSpy?: sinon.SinonSpy;
    private unhandled?: UnhandledRejectionRecorder;

    /**
     * Loads the relay modules first, as a runtime does on its first
     * connection: every relay of the test then connects synchronously.
     */
    public async setup(randomValues: number[] = [0]): Promise<void> {
        await loadRelayModules();
        this.install(randomValues);
    }

    private install(randomValues: number[]): void {
        this.clock = this.sandbox.useFakeTimers();
        let randomIndex = 0;
        this.sandbox.stub(Math, "random").callsFake(() => {
            const value =
                randomValues[Math.min(randomIndex, randomValues.length - 1)];
            randomIndex += 1;
            return value;
        });
        this.failureSpy = this.sandbox.spy(RelayerPool.prototype, "onFailure");
        this.unhandled = recordUnhandledRejections();
        RecordingWebSocket.instances = [];
        RecordingWebSocket.isCreatedClosed = false;
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
        this.logger = this.createLogger();
        this.relay = HolepunchRelay.init(
            urls,
            () => {
                this.updateCount += 1;
            },
            this.logger
        );
    }

    /**
     * A browser-runtime Holepunch whose relay is a {@link RecordingWebSocket}:
     * the real Hyperswarm and dht-relay client run on it, and no relayer ever
     * answers what they send.
     */
    public createBrowserHolepunch(urls: string[]): Holepunch {
        this.logger = this.createLogger();
        this.sandbox.replace(config, "HOLEPUNCH_RELAYER_URLS", urls);
        const windowDescriptor = Object.getOwnPropertyDescriptor(
            globalThis,
            "window"
        );
        Object.defineProperty(globalThis, "window", {
            configurable: true,
            value: globalThis
        });
        try {
            return new Holepunch({
                logger: this.logger,
                rpcRouter: undefined
            } as unknown as P2PManager);
        } finally {
            if (windowDescriptor)
                Object.defineProperty(globalThis, "window", windowDescriptor);
            else Reflect.deleteProperty(globalThis, "window");
        }
    }

    private createLogger(): Logger {
        return createLogger(
            {},
            {},
            { level: "error", attachErrorListener: false }
        );
    }

    /** Disposes the relay, then its logger, as a runtime's disposal does. */
    public disposeRuntime(): void {
        this.relay?.dispose();
        this.logger?.dispose();
    }

    public reset(randomValues: number[]): void {
        this.cleanup();
        this.install(randomValues);
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

    /** Every socket the relay opens from now on is already CLOSED. */
    public createSocketsClosed(): void {
        RecordingWebSocket.isCreatedClosed = true;
    }

    public updates(): number {
        return this.updateCount;
    }

    /** The reason of each failure the relay handed to its pool. */
    public relayerFailures(): unknown[] {
        return (this.failureSpy?.getCalls() ?? []).map((call) => call.args[1]);
    }

    /** Waits one real macrotask, after which Node has reported every rejection left unhandled. */
    public unhandledRejections(): Promise<readonly unknown[]> {
        return this.unhandled!.settled();
    }

    public tick(milliseconds: number): void {
        this.clock?.tick(milliseconds);
    }

    public cleanup(): void {
        this.sandbox.restore();
        this.unhandled?.stop();
        this.unhandled = undefined;
        this.failureSpy = undefined;
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
        this.relay = undefined;
        if (this.logger && !this.logger.isDisposed) this.logger.dispose();
        this.logger = undefined;
        RecordingWebSocket.instances = [];
        RecordingWebSocket.isCreatedClosed = false;
    }
}
