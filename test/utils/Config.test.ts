import { expect } from "chai";
import sinon from "sinon";

import { createConfig } from "@/utils/config";

const ENV_KEYS = [
    "HOLEPUNCH_RELAYER_URLS",
    "DEBUG_LOCAL_TRANSPORT",
    "LOG_LEVEL",
    "LOBBY_INTENT_HOLD_MS",
    "LOBBY_MAX_ADS"
] as const;

describe("config env parsing", () => {
    let originalEnv: Partial<
        Record<(typeof ENV_KEYS)[number], string | undefined>
    >;
    let consoleLogStub: sinon.SinonStub;

    beforeEach(() => {
        originalEnv = Object.fromEntries(
            ENV_KEYS.map((k) => [k, process.env[k]])
        ) as any;
        consoleLogStub = sinon.stub(console, "log");
    });

    afterEach(() => {
        consoleLogStub.restore();

        // Restore env
        for (const key of ENV_KEYS) {
            const value = originalEnv[key];
            if (value === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = value;
            }
        }

        // Reset process-lifespan config back to baseline for other tests.
        createConfig({});
    });

    it("applies peer3.config.ts as baseConfig", () => {
        // peer3.config.ts sets DEBUG_LOCAL_TRANSPORT=true (default is false)
        const cfg = createConfig({});
        expect(cfg.DEBUG_LOCAL_TRANSPORT).to.equal(true);
    });

    it("parses HOLEPUNCH_RELAYER_URLS from env JSON array", () => {
        process.env.HOLEPUNCH_RELAYER_URLS =
            '["wss://a.example/dht","wss://b.example/dht"]';

        const cfg = createConfig({});
        expect(cfg.HOLEPUNCH_RELAYER_URLS).to.deep.equal([
            "wss://a.example/dht",
            "wss://b.example/dht"
        ]);
    });

    it("parses HOLEPUNCH_RELAYER_URLS from env comma-separated list", () => {
        process.env.HOLEPUNCH_RELAYER_URLS =
            "wss://a.example/dht, wss://b.example/dht";

        const cfg = createConfig({});
        expect(cfg.HOLEPUNCH_RELAYER_URLS).to.deep.equal([
            "wss://a.example/dht",
            "wss://b.example/dht"
        ]);
    });

    it("manual overrides win over env for HOLEPUNCH_RELAYER_URLS", () => {
        process.env.HOLEPUNCH_RELAYER_URLS =
            '["wss://a.example/dht","wss://b.example/dht"]';

        const cfg = createConfig({
            HOLEPUNCH_RELAYER_URLS: ["wss://override.example/dht"]
        });

        expect(cfg.HOLEPUNCH_RELAYER_URLS).to.deep.equal([
            "wss://override.example/dht"
        ]);
    });

    it("defaults LOBBY_MAX_PARALLELISM to 1", () => {
        const cfg = createConfig({});
        expect(cfg.LOBBY_MAX_PARALLELISM).to.equal(1);
    });

    it("parses LOBBY_INTENT_HOLD_MS from env (number)", () => {
        process.env.LOBBY_INTENT_HOLD_MS = "1234";

        const cfg = createConfig({});
        expect(cfg.LOBBY_INTENT_HOLD_MS).to.equal(1234);
    });

    it("leaves LOBBY_MAX_ADS at its default when the env value is unparseable", () => {
        process.env.LOBBY_MAX_ADS = "abc";

        const cfg = createConfig({});
        expect(cfg.LOBBY_MAX_ADS).to.equal(512);
    });
});
