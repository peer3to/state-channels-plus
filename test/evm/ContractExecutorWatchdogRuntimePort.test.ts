import {
    startRuntimeTransportModesFixture,
    stopRuntimeTransportModesFixture
} from "@test/fixtures/RuntimeTransportModesFixture";
import { assertReportedAndStillServing } from "@test/fixtures/WatchdogRuntimePortAssertions";

describe("Contract executor watchdog through the runtime port", function () {
    before(async function () {
        await startRuntimeTransportModesFixture();
    });

    after(function () {
        stopRuntimeTransportModesFixture();
    });

    it("inline host: a watchdog trip is one host error with delay data and the worker keeps serving", async function () {
        await assertReportedAndStillServing({
            runSdkInThread: false,
            mode: "watchdog"
        });
    });

    it("sdk worker: a watchdog trip is one host error with delay data and the worker keeps serving", async function () {
        await assertReportedAndStillServing({
            runSdkInThread: true,
            mode: "watchdog"
        });
    });

    it("inline host: an autonomous throw is one host error and the worker keeps serving", async function () {
        await assertReportedAndStillServing({
            runSdkInThread: false,
            mode: "throw"
        });
    });

    it("sdk worker: an autonomous throw is one host error and the worker keeps serving", async function () {
        await assertReportedAndStillServing({
            runSdkInThread: true,
            mode: "throw"
        });
    });

    it("inline host: an unhandled rejection is one host error and the worker keeps serving", async function () {
        await assertReportedAndStillServing({
            runSdkInThread: false,
            mode: "rejection"
        });
    });

    it("sdk worker: an unhandled rejection is one host error and the worker keeps serving", async function () {
        await assertReportedAndStillServing({
            runSdkInThread: true,
            mode: "rejection"
        });
    });
});
