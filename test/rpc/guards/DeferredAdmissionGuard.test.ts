import { deriveTimeConfig } from "@/types";
import { HandshakeCompletedGuardFixture } from "@test/fixtures/HandshakeCompletedGuardFixture";
import { expect } from "chai";

// the guard holds deferred work for two agreement windows
const ADMISSION_TIMEOUT_MS = 2 * deriveTimeConfig().agreementTime * 1000;

describe("DeferredAdmissionGuard", function () {
    let fixture: HandshakeCompletedGuardFixture;

    beforeEach(async function () {
        fixture = new HandshakeCompletedGuardFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("passes ready work, replays one FIFO queue, and separates rejection from expiry", async function () {
        const result = await fixture
            .control()
            .handshakeCompletedGuardProbe.probeDeferredAdmission()
            .request();

        expect(result).to.deep.equal({
            immediateInvocations: ["immediate"],
            beforeReplay: ["immediate"],
            afterReplay: ["immediate", "first", "second"],
            waitCalls: 2,
            rejected: 1,
            expired: 1,
            transportCloseExpired: 1,
            timeoutMs: [ADMISSION_TIMEOUT_MS, ADMISSION_TIMEOUT_MS],
            expectedTimeoutMs: ADMISSION_TIMEOUT_MS
        });
    });
});
