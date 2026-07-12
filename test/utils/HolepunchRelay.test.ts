import { expect } from "chai";
import sinon from "sinon";

// hyperswarm / @hyperswarm/dht-relay / @hyperswarm/dht-relay/ws all set up
// real DHT/network machinery (including their own internal timers) on
// construction. Stub them out via the require cache, before HolepunchRelay
// is loaded, so tests exercise only the relayer-pool/backoff logic in
// HolepunchRelay.ts against a controlled fake WebSocket - not real DHT
// wiring or unrelated timers that would fight sinon's fake clock.
class FakeHyperswarm {
    constructor(_opts?: any) {}
}
class FakeDhtNode {
    constructor(_stream?: any) {}
}
class FakeDhtStream {
    constructor(_isInitiator?: boolean, _socket?: any) {}
}

function stubModule(specifier: string, fakeExports: any) {
    const resolved = require.resolve(specifier);
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: fakeExports
    } as any;
}

stubModule("hyperswarm", FakeHyperswarm);
stubModule("@hyperswarm/dht-relay", FakeDhtNode);
stubModule("@hyperswarm/dht-relay/ws", FakeDhtStream);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const HolepunchRelay = require("@/HolepunchRelay").default;

// Mirrors HolepunchRelay.ts's FAILOVER_JITTER_MAX_MS (not exported).
const FAILOVER_JITTER_MAX_MS = 250;

// Minimal fake WebSocket the test drives manually via emitOpen/emitClose/emitError.
class FakeWebSocket {
    static instances: FakeWebSocket[] = [];

    url: string;
    readyState = 0; // CONNECTING
    binaryType = "arraybuffer";

    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onerror: ((error: any) => void) | null = null;
    onmessage: ((event: any) => void) | null = null;

    constructor(url: string) {
        this.url = url;
        FakeWebSocket.instances.push(this);
    }

    addEventListener() {}
    removeEventListener() {}
    send(_data: any) {}
    close() {
        this.readyState = 3; // CLOSED
    }

    emitOpen() {
        this.readyState = 1; // OPEN
        this.onopen?.();
    }

    emitClose() {
        this.onclose?.();
    }

    emitError(error: any = new Error("fake ws error")) {
        this.onerror?.(error);
    }
}

function createLogger() {
    const logger: any = {
        child: () => logger,
        debug: () => undefined,
        verbose: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        info: () => undefined
    };
    return logger;
}

// Reaches into the singleton to reset it between tests, since
// HolepunchRelay.init() always assigns HolepunchRelay.instance.
function resetSingleton() {
    (HolepunchRelay as any).instance = undefined;
}

describe("HolepunchRelay", function () {
    let originalWebSocket: any;
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        originalWebSocket = (global as any).WebSocket;
        (global as any).WebSocket = FakeWebSocket;
        FakeWebSocket.instances = [];
        clock = sinon.useFakeTimers();
        resetSingleton();
    });

    afterEach(() => {
        (global as any).WebSocket = originalWebSocket;
        clock.restore();
        resetSingleton();
    });

    it("does not permanently exhaust the relayer pool after more failures than configured relayers", () => {
        const relayerUrls = ["wss://relay-a.example", "wss://relay-b.example"];
        let updateCallbackCount = 0;

        HolepunchRelay.init(
            relayerUrls,
            () => {
                updateCallbackCount++;
            },
            createLogger()
        );

        // Simulate more consecutive failures than there are configured relayers.
        for (let i = 0; i < 5; i++) {
            const ws =
                FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
            ws.emitClose();
            // A full-round exhaustion schedules a backoff retry; advance
            // through the pending timer so the pool keeps retrying.
            clock.tick(30000);
        }

        // Pre-fix, after relayerUrls.length (2) failures the pool would be
        // permanently empty and connectToRelayer() would silently no-op -
        // updateCallback would stop firing forever. Assert it keeps firing.
        expect(updateCallbackCount).to.be.greaterThan(relayerUrls.length);
        expect(FakeWebSocket.instances.length).to.be.greaterThan(
            relayerUrls.length
        );
    });

    it("keeps retrying a single configured relayer without locking out", () => {
        const relayerUrls = ["wss://only-relay.example"];
        let updateCallbackCount = 0;

        HolepunchRelay.init(
            relayerUrls,
            () => {
                updateCallbackCount++;
            },
            createLogger()
        );

        for (let i = 0; i < 4; i++) {
            const ws =
                FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
            ws.emitError();
            clock.tick(30000);
        }

        // Every attempt should target the only configured relayer, and the
        // pool should never go permanently dark - 1 initial connect + 4 retries.
        expect(updateCallbackCount).to.equal(5);
        for (const ws of FakeWebSocket.instances) {
            expect(ws.url).to.equal(relayerUrls[0]);
        }
    });

    it("resets exclusion/backoff state on a successful connection", () => {
        const relayerUrls = ["wss://relay-a.example", "wss://relay-b.example"];
        let updateCallbackCount = 0;

        HolepunchRelay.init(
            relayerUrls,
            () => {
                updateCallbackCount++;
            },
            createLogger()
        );

        // Fail both relayers once (exhausts the round, schedules backoff).
        // The first failure only schedules the (jittered) failover retry -
        // advance past it so the second relayer actually connects before
        // failing it too.
        FakeWebSocket.instances[0].emitClose();
        clock.tick(FAILOVER_JITTER_MAX_MS);
        FakeWebSocket.instances[FakeWebSocket.instances.length - 1].emitClose();

        // The first exhaustion backoff is at most base * 2^0 = 1s; advance
        // past it so the pool retries and produces a fresh connection to
        // succeed on.
        clock.tick(1000);
        const successWs =
            FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
        successWs.emitOpen();

        // After success, a subsequent single failure must not be treated as
        // a full-round exhaustion (no backoff delay) - the retry only needs
        // the small failover jitter (well under the 1s exhaustion backoff
        // floor) to elapse, not a full backoff tick.
        const countBeforeFailure = updateCallbackCount;
        successWs.emitClose();
        clock.tick(FAILOVER_JITTER_MAX_MS);

        expect(updateCallbackCount).to.equal(countBeforeFailure + 1);
    });

    it("adds a randomized, non-synchronized delay before retrying a single relayer failure", () => {
        const relayerUrls = [
            "wss://relay-a.example",
            "wss://relay-b.example",
            "wss://relay-c.example"
        ];
        const setTimeoutSpy = sinon.spy(global, "setTimeout");
        const delays: number[] = [];

        // Simulate several independent clients failing over off one relayer
        // at essentially the same instant (a reconnect storm), and capture
        // the randomized retry delay each one schedules.
        for (let i = 0; i < 8; i++) {
            HolepunchRelay.init(relayerUrls, () => undefined, createLogger());
            const ws =
                FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
            setTimeoutSpy.resetHistory();
            ws.emitClose();

            expect(setTimeoutSpy.calledOnce).to.equal(true);
            const delayMs = setTimeoutSpy.firstCall.args[1] as number;
            expect(delayMs).to.be.at.least(0);
            expect(delayMs).to.be.lessThan(FAILOVER_JITTER_MAX_MS);
            delays.push(delayMs);
        }

        // Not a thundering herd: delays aren't all identical, and not all
        // zero (the pre-fix, always-synchronous-retry behavior).
        expect(new Set(delays).size).to.be.greaterThan(1);
        expect(delays.some((delayMs) => delayMs > 0)).to.equal(true);
    });

    it("applies full jitter (not a deterministic mark) to the exhaustion backoff", () => {
        const relayerUrls = ["wss://relay-a.example", "wss://relay-b.example"];
        const setTimeoutSpy = sinon.spy(global, "setTimeout");
        const delays: number[] = [];

        // Simulate several independent clients that all exhaust the full
        // relayer pool at the same moment (e.g. a shared relayer outage).
        for (let i = 0; i < 8; i++) {
            HolepunchRelay.init(relayerUrls, () => undefined, createLogger());
            // Fail the first relayer, then advance past its (jittered)
            // failover retry so the client actually reconnects to the
            // second relayer before failing that one too.
            FakeWebSocket.instances[
                FakeWebSocket.instances.length - 1
            ].emitClose();
            clock.tick(FAILOVER_JITTER_MAX_MS);
            setTimeoutSpy.resetHistory();
            FakeWebSocket.instances[
                FakeWebSocket.instances.length - 1
            ].emitClose();

            // The second failure exhausts the 2-relayer pool and schedules
            // the backoff retry - capture that delay.
            expect(setTimeoutSpy.calledOnce).to.equal(true);
            const delayMs = setTimeoutSpy.firstCall.args[1] as number;
            // First exhaustion: cappedBackoffMs = BACKOFF_BASE_MS * 2^0 = 1000.
            expect(delayMs).to.be.at.least(0);
            expect(delayMs).to.be.lessThan(1000);
            delays.push(delayMs);
        }

        // Full jitter, not the deterministic 1000ms mark every client would
        // hit pre-fix - delays are spread across the range, not lockstepped.
        expect(new Set(delays).size).to.be.greaterThan(1);
        expect(delays.some((delayMs) => delayMs > 0)).to.equal(true);
        expect(delays.every((delayMs) => delayMs !== 1000)).to.equal(true);
    });
});
