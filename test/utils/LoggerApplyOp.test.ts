import { expect } from "chai";
import { createLogger } from "@/utils";
import { LogUploader } from "@/utils/logging/LogUploader";
import { LogStore } from "@/utils/logging/logStore";

// Records uploadLogs() calls without doing network I/O.
class FakeUploader extends LogUploader {
    public uploadCount = 0;
    protected attachListeners(): void {}
    protected detachListeners(): void {}
    public async uploadLogs(): Promise<void> {
        this.uploadCount++;
    }
}

const CHAN =
    "0x2222222222222222222222222222222222222222222222222222222222222222";

function makeLogger() {
    const shared = { threadName: "sdk" } as Record<string, unknown>;
    const fake = new FakeUploader(
        new LogStore(1024, true),
        { uploadEndpoint: "http://example.test", apiToken: "" },
        { component: "T" },
        shared as any
    );
    const logger = createLogger(
        shared as any,
        { component: "T" },
        {
            logUploader: fake,
            level: "info"
        }
    );
    return { logger, fake, shared };
}

describe("Logger.applyOp", function () {
    it("'flush' uploads this thread's own store and returns the promise", async function () {
        const { logger, fake } = makeLogger();
        const result = logger.applyOp({ type: "flush" });
        expect(result).to.be.an.instanceOf(Promise);
        await result;
        expect(fake.uploadCount).to.equal(1);
    });

    it("'updateContext' merges the delta and preserves this thread's own fields", function () {
        const { logger, shared } = makeLogger();
        logger.applyOp({
            type: "updateContext",
            context: { channelId: CHAN }
        });
        expect(shared.channelId).to.equal(CHAN);
        expect(shared.threadName).to.equal("sdk"); // own field preserved
    });
});
