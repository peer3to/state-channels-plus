import { expect } from "chai";
import { AxiosError } from "axios";
import {
    createUploaderFixture,
    decodeUpload,
    startLogReceiver,
    LogReceiver
} from "@test/fixtures/logging/LogUploader.fixture";

describe("LogUploader", function () {
    let receiver: LogReceiver | undefined;

    beforeEach(async function () {
        // Clear first so a rejected startup never leaves a previous test's closed
        // receiver in the variable for afterEach to re-close.
        receiver = undefined;
        receiver = await startLogReceiver();
    });

    afterEach(async function () {
        const started = receiver;
        receiver = undefined;
        if (started) await started.close();
    });

    it("uploads a captured error without leaking secret fields of a real AxiosError", async function () {
        const { logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        // A genuine AxiosError: its toJSON() (invoked by JSON.stringify before any
        // replacer) exposes `config` with the auth header, cookie, and body.
        const secretError = new AxiosError(
            "Request failed with status code 401",
            "ERR_BAD_REQUEST"
        );
        Object.assign(secretError, {
            config: {
                headers: {
                    Authorization: "Bearer super-secret-token",
                    Cookie: "session=topsecret"
                },
                data: JSON.stringify({ password: "hunter2" })
            }
        });

        logUploader.captureUnhandled(secretError, "error");
        await receiver!.waitForRequests(1);

        const payload = JSON.stringify(decodeUpload(receiver!.requests[0]));
        expect(payload).to.include("AxiosError");
        expect(payload).to.include("ERR_BAD_REQUEST");
        expect(payload).to.include("Request failed with status code 401");
        for (const secret of ["super-secret-token", "topsecret", "hunter2"]) {
            expect(payload, `leaked "${secret}"`).to.not.include(secret);
        }
    });

    it("uploads logs when no error is captured", async function () {
        const { logger, logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        logger.info("routine entry");

        await logUploader.uploadLogs();
        await receiver!.waitForRequests(1);

        expect(
            decodeUpload(receiver!.requests[0]).map((entry) => entry.message)
        ).to.deep.equal(["routine entry"]);
    });

    // A window error burst: the second error lands while the first upload is still
    // in its jitter sleep. It must be delivered in the (single) POST - asserting
    // the store would pass even if the late error never reached the upload.
    it("delivers a captured error that arrives while an upload is in flight", async function () {
        const { logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url,
            jitterMaxMs: 50
        });

        const inFlight = logUploader.uploadLogs();
        logUploader.captureUnhandled(new Error("late failure"), "error");
        await inFlight;
        await receiver!.waitForRequests(1);

        expect(receiver!.requests).to.have.length(1);
        expect(JSON.stringify(decodeUpload(receiver!.requests[0]))).to.include(
            "late failure"
        );
    });

    // A rejection reason whose toString throws must not crash the crash handler;
    // it still uploads one safe record.
    it("captures a non-Error reason whose toString throws without itself throwing", async function () {
        const { logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        const throwingReason = {
            toString() {
                throw new Error("cannot stringify");
            }
        };

        logUploader.captureUnhandled(throwingReason, "unhandledrejection");
        await receiver!.waitForRequests(1);

        expect(JSON.stringify(decodeUpload(receiver!.requests[0]))).to.include(
            "[unstringifiable rejection reason]"
        );
    });

    // An Error whose own name/message/stack/code accessors throw must not escape
    // the crash handler while it is being encoded for upload.
    it("captures an Error with throwing accessors without itself throwing", async function () {
        const { logUploader } = createUploaderFixture({
            uploadEndpoint: receiver!.url
        });
        const hostileError = new Error("boom");
        for (const field of ["name", "message", "stack", "code"] as const) {
            Object.defineProperty(hostileError, field, {
                configurable: true,
                get() {
                    throw new Error(`${field} accessor exploded`);
                }
            });
        }

        logUploader.captureUnhandled(hostileError, "error");
        await receiver!.waitForRequests(1);

        expect(JSON.stringify(decodeUpload(receiver!.requests[0]))).to.include(
            "[unreadable]"
        );
    });
});
