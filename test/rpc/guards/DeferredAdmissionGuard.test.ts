import { expect } from "chai";

import { HandshakeCompletedGuardFixture } from "@test/fixtures/HandshakeCompletedGuardFixture";

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
            timeoutMs: [6000, 6000],
            expectedTimeoutMs: 6000
        });
    });
});
