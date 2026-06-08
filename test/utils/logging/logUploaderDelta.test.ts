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

function makeUploader(store: LogStore) {
    return new NodeLogUploader(
        store,
        {
            uploadEndpoint: "http://localhost:9/logs/upload",
            apiToken: "",
            flushMinIntervalMs: 0
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

describe("LogUploader delta + watermark", () => {
    let postStub: sinon.SinonStub;
    let randomStub: sinon.SinonStub;

    beforeEach(() => {
        randomStub = sinon.stub(Math, "random").returns(0);
        postStub = sinon
            .stub(axios, "post")
            .resolves({ headers: {}, data: {} } as any);
    });
    afterEach(() => {
        randomStub.restore();
        postStub.restore();
    });

    it("uploads only entries newer than the last successful upload", async () => {
        const store = new LogStore(10 * 1024 * 1024, true);
        store.store(entry("a"));
        store.store(entry("b"));
        const uploader = makeUploader(store);

        await uploader.uploadLogs();
        let body = postStub.lastCall.args[1] as Record<string, unknown>;
        expect(body.fromSeq).to.equal(0);
        expect(body.toSeq).to.equal(1);

        store.store(entry("c"));
        await uploader.uploadLogs();
        body = postStub.lastCall.args[1] as Record<string, unknown>;
        expect(body.fromSeq).to.equal(2);
        expect(body.toSeq).to.equal(2);
        expect(postStub.calledTwice).to.equal(true);
    });

    it("skips the POST when there is nothing new", async () => {
        const store = new LogStore(10 * 1024 * 1024, true);
        store.store(entry("a"));
        const uploader = makeUploader(store);

        await uploader.uploadLogs();
        await uploader.uploadLogs(); // no new entries
        expect(postStub.calledOnce).to.equal(true);
    });

    it("does not advance the watermark when the upload fails", async () => {
        const store = new LogStore(10 * 1024 * 1024, true);
        store.store(entry("a"));
        const uploader = makeUploader(store);

        postStub.rejects(new Error("network down"));
        await uploader.uploadLogs(); // swallowed
        postStub.resolves({ headers: {}, data: {} } as any);

        await uploader.uploadLogs(); // retries the same entry
        const body = postStub.lastCall.args[1] as Record<string, unknown>;
        expect(body.fromSeq).to.equal(0);
        expect(body.toSeq).to.equal(0);
    });
});
