import { expect } from "chai";
import sinon from "sinon";
import { createLogger } from "@/utils";
import { createConfig } from "@/utils/config";
import { LogUploader } from "@/utils/logging/LogUploader";
import { LogStore } from "@/utils/logging/logStore";

class FakeUploader extends LogUploader {
    public uploadCount = 0;
    protected attachListeners(): void {}
    protected detachListeners(): void {}
    public async uploadLogs(): Promise<void> {
        this.uploadCount++;
    }
}

function makeLogger() {
    const shared = { threadName: "sdk" } as Record<string, unknown>;
    const fake = new FakeUploader(
        new LogStore(1024 * 1024, true),
        { uploadEndpoint: "http://example.test", apiToken: "" },
        { component: "T" },
        shared as any
    );
    const logger = createLogger(
        shared as any,
        { component: "T" },
        { logUploader: fake, level: "info" }
    );
    return { logger, fake };
}

describe("Logger.error fan-out throttle", () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
        createConfig({ CRASH_LOG_FLUSH_MIN_INTERVAL_MS: 1000 });
    });
    afterEach(() => {
        clock.restore();
        createConfig({}); // reset to defaults
    });

    it("flushes at most once per interval despite rapid error() calls", async () => {
        const { logger, fake } = makeLogger();

        logger.error("boom 1");
        logger.error("boom 2");
        logger.error("boom 3");
        await clock.tickAsync(0); // let detached flush promises settle
        expect(fake.uploadCount).to.equal(1);

        await clock.tickAsync(1000);
        logger.error("boom 4");
        await clock.tickAsync(0);
        expect(fake.uploadCount).to.equal(2);
    });
});
