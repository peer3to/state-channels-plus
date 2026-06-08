import { expect } from "chai";
import sinon from "sinon";
import axios from "axios";

import { NodeLogUploader } from "@/utils/logging/node/NodeLogUploader";
import { LogStore } from "@/utils/logging/logStore";
import { LogEntry } from "@/utils/logging/Logger";

function entry(message: string): LogEntry {
    return {
        time: "t",
        level: "warn",
        context: {},
        sharedContext: {},
        message,
        meta: [],
        stack: ""
    };
}

function makeUploader(store: LogStore, flushMinIntervalMs: number) {
    return new NodeLogUploader(
        store,
        {
            uploadEndpoint: "http://localhost:9/logs/upload",
            apiToken: "",
            flushMinIntervalMs
        },
        {},
        {
            peerAddress: "0x1111111111111111111111111111111111111111" as any,
            channelId:
                "0x2222222222222222222222222222222222222222222222222222222222222222",
            threadName: "evm"
        },
        false
    );
}

describe("LogUploader throttle", () => {
    let clock: sinon.SinonFakeTimers;
    let postStub: sinon.SinonStub;

    beforeEach(() => {
        clock = sinon.useFakeTimers();
        postStub = sinon
            .stub(axios, "post")
            .resolves({ headers: {}, data: {} } as any);
    });
    afterEach(() => {
        postStub.restore();
        clock.restore();
    });

    it("coalesces rapid triggers into one leading + one trailing upload", async () => {
        const store = new LogStore(10 * 1024 * 1024, true);
        const uploader = makeUploader(store, 1000);

        store.store(entry("a"));
        await uploader.uploadLogs(); // leading: uploads immediately
        expect(postStub.callCount).to.equal(1);

        store.store(entry("b"));
        await uploader.uploadLogs(); // within window: schedules trailing
        store.store(entry("c"));
        await uploader.uploadLogs(); // within window: collapses into the trailing
        expect(postStub.callCount).to.equal(1);

        await clock.tickAsync(1000); // fire the trailing timer
        expect(postStub.callCount).to.equal(2);
        const body = postStub.lastCall.args[1] as Record<string, unknown>;
        expect(body.fromSeq).to.equal(1);
        expect(body.toSeq).to.equal(2); // b and c, batched
    });

    it("user-initiated uploads bypass the throttle", async () => {
        const store = new LogStore(10 * 1024 * 1024, true);
        const uploader = makeUploader(store, 1000);

        store.store(entry("a"));
        await uploader.uploadLogs(); // leading
        store.store(entry("b"));
        await uploader.uploadLogs(undefined, true); // bypass → immediate
        expect(postStub.callCount).to.equal(2);
    });
});
