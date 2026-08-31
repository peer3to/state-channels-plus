import { expect } from "chai";
import { AxiosError } from "axios";
import { decodeLogEntry, encodeLogEntry } from "@/utils/logging/logEncoder";
import { LogEntry } from "@/utils/logging/Logger";
import { createUploaderFixture } from "@test/fixtures/logging/LogUploader.fixture";

const SECRETS = ["Bearer top-secret", "session=cookie-secret", "body-secret"];

// A genuine AxiosError - its toJSON() (invoked by JSON.stringify before any
// replacer) exposes `config` with the auth header, cookie, and request body.
function secretAxiosError(): AxiosError {
    const error = new AxiosError(
        "Request failed with status code 401",
        "ERR_BAD_REQUEST"
    );
    Object.assign(error, {
        config: {
            headers: {
                Authorization: "Bearer top-secret",
                Cookie: "session=cookie-secret"
            },
            data: JSON.stringify({ password: "body-secret" })
        }
    });
    return error;
}

function encodeMeta(meta: unknown): string {
    const entry: LogEntry = {
        time: "1",
        wallTimeMs: 1000,
        level: "error",
        context: {},
        sharedContext: {},
        message: "m",
        meta: [meta],
        stack: "s"
    };
    return encodeLogEntry(entry);
}

function expectNoSecrets(encoded: string) {
    for (const secret of SECRETS) {
        expect(encoded, `leaked "${secret}"`).to.not.include(secret);
    }
}

describe("encodeLogEntry", function () {
    it("redacts a direct AxiosError but keeps name/message/code", function () {
        const encoded = encodeMeta({ error: secretAxiosError() });
        expect(encoded).to.include("AxiosError");
        expect(encoded).to.include("ERR_BAD_REQUEST");
        expect(encoded).to.include("Request failed with status code 401");
        expectNoSecrets(encoded);
    });

    it("redacts an AxiosError nested in a class instance", function () {
        class Wrapper {
            constructor(public error: AxiosError) {}
        }
        expectNoSecrets(encodeMeta({ wrap: new Wrapper(secretAxiosError()) }));
    });

    it("redacts an AxiosError on an enumerable property of a Map", function () {
        const map = new Map<string, number>([["a", 1]]);
        Object.assign(map, { leak: secretAxiosError() });
        expectNoSecrets(encodeMeta({ map }));
    });

    it("does not slip a raw error out through a non-string Error field getter", function () {
        const outer = new Error("outer");
        Object.defineProperty(outer, "message", {
            configurable: true,
            get() {
                return secretAxiosError();
            }
        });
        expectNoSecrets(encodeMeta({ error: outer }));
    });

    it("neither copies nor invokes an untrusted toJSON that would expose secrets", function () {
        const secretConfig = secretAxiosError().config;
        const leaky = { safe: "ok", toJSON: () => secretConfig };
        const encoded = encodeMeta({ leaky });
        expect(encoded).to.include("ok");
        expectNoSecrets(encoded);
    });

    it("does not invoke an accessor that materializes an error's config", function () {
        const error = secretAxiosError();
        const meta = {
            safe: "ok",
            get exposed() {
                return error.config;
            }
        };
        const encoded = encodeMeta(meta);
        expect(encoded).to.include("[accessor]");
        expectNoSecrets(encoded);
    });

    it("drops a function whose toJSON would expose an error", function () {
        const error = secretAxiosError();
        const functionValue = Object.assign(() => undefined, {
            toJSON: () => error.toJSON()
        });
        expectNoSecrets(encodeMeta({ functionValue }));
    });

    it("encodes a circular class instance as [Circular] without throwing", function () {
        class Cyclic {
            label = "cyclic";
            self: unknown;
            constructor() {
                this.self = this;
            }
        }
        let encoded = "";
        expect(() => {
            encoded = encodeMeta({ c: new Cyclic() });
        }).to.not.throw();
        expect(encoded).to.include("[Circular]");
    });

    it("survives throwing Error accessors without throwing", function () {
        const hostile = new Error("boom");
        for (const field of ["name", "message", "stack", "code"] as const) {
            Object.defineProperty(hostile, field, {
                configurable: true,
                get() {
                    throw new Error(`${field} accessor exploded`);
                }
            });
        }
        let encoded = "";
        expect(() => {
            encoded = encodeMeta({ error: hostile });
        }).to.not.throw();
        expect(encoded).to.include("[unreadable]");
    });

    it("preserves Date as ISO and bigint as a string", function () {
        const encoded = encodeMeta({ when: new Date(0), big: 10n });
        expect(encoded).to.include("1970-01-01T00:00:00.000Z");
        expect(encoded).to.include('"10"');
    });

    it("round-trips the wall-clock timestamp", function () {
        const entry: LogEntry = {
            time: "1",
            wallTimeMs: 1_700_000_000_123,
            level: "info",
            context: {},
            sharedContext: { threadName: "vm" },
            message: "m",
            meta: [],
            stack: "s"
        };

        const decoded = decodeLogEntry(encodeLogEntry(entry));

        expect(decoded.wallTimeMs).to.equal(1_700_000_000_123);
        expect(decoded.sharedContext.threadName).to.equal("vm");
    });

    it("encodes a non-string message as a string", function () {
        // call sites pass anything - SpectateService does `logger.warn(e)`. an
        // object message decodes to nothing the server will keep, and the merge
        // now drops it silently instead of rejecting the chunk.
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: "http://127.0.0.1:1/logs/upload"
        });
        try {
            logger.warn(new Error("boom"));
            const [entry] = logStore.getAllLogs();

            const decoded = decodeLogEntry(encodeLogEntry(entry));

            expect(decoded.message).to.equal("boom");
        } finally {
            logger.dispose();
        }
    });

    it("coerces a hostile message without running its code", function () {
        // a getter, toJSON and Symbol.toPrimitive that all throw: the old
        // coercion ran every one of them inside the logger
        const hostile = {
            get message(): string {
                throw new Error("message accessor exploded");
            },
            toJSON(): never {
                throw new Error("toJSON exploded");
            },
            [Symbol.toPrimitive](): never {
                throw new Error("toPrimitive exploded");
            }
        };
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: "http://127.0.0.1:1/logs/upload"
        });
        try {
            expect(() => logger.warn(hostile)).to.not.throw();
            const [entry] = logStore.getAllLogs();

            const decoded = decodeLogEntry(encodeLogEntry(entry));

            expect(decoded.message).to.equal("[accessor]");
        } finally {
            logger.dispose();
        }
    });

    it("coerces an Error whose message getter throws", function () {
        const hostile = new Error("boom");
        Object.defineProperty(hostile, "message", {
            configurable: true,
            get() {
                throw new Error("message accessor exploded");
            }
        });
        const { logger, logStore } = createUploaderFixture({
            uploadEndpoint: "http://127.0.0.1:1/logs/upload"
        });
        try {
            expect(() => logger.warn(hostile)).to.not.throw();
            const [entry] = logStore.getAllLogs();

            const decoded = decodeLogEntry(encodeLogEntry(entry));

            expect(decoded.message).to.equal("[unreadable]");
        } finally {
            logger.dispose();
        }
    });

    it("rejects an entry with no wall-clock timestamp", function () {
        const noWallClock = JSON.stringify({
            time: "1",
            level: "info",
            context: {},
            sharedContext: {},
            message: "m",
            meta: [],
            stack: "s"
        });

        expect(() => decodeLogEntry(noWallClock)).to.throw("invalid fields");
    });
});
