import { expect } from "chai";
import sinon from "sinon";
import axios from "axios";

import { NodeLogUploader } from "@/utils/logging/node/NodeLogUploader";
import { LogStore } from "@/utils/logging/logStore";

describe("LogUploader envelope", () => {
    let postStub: sinon.SinonStub;
    let randomStub: sinon.SinonStub;

    beforeEach(() => {
        // No jitter delay, deterministic.
        randomStub = sinon.stub(Math, "random").returns(0);
        postStub = sinon
            .stub(axios, "post")
            .resolves({ headers: {}, data: {} } as any);
    });

    afterEach(() => {
        randomStub.restore();
        postStub.restore();
    });

    it("includes threadName in the uploaded envelope", async () => {
        const store = new LogStore(1024 * 1024, true);
        store.store({
            time: "t",
            level: "warn",
            context: {},
            sharedContext: {},
            message: "hello",
            meta: [],
            stack: ""
        });

        const uploader = new NodeLogUploader(
            store,
            { uploadEndpoint: "http://localhost:9/logs/upload", apiToken: "" },
            {},
            {
                peerAddress:
                    "0x1111111111111111111111111111111111111111" as any,
                channelId:
                    "0x2222222222222222222222222222222222222222222222222222222222222222",
                threadName: "evm"
            },
            false
        );

        await uploader.uploadLogs();

        expect(postStub.calledOnce).to.equal(true);
        const body = postStub.firstCall.args[1] as Record<string, unknown>;
        expect(body.threadName).to.equal("evm");
        expect(body.channelId).to.equal(
            "0x2222222222222222222222222222222222222222222222222222222222222222"
        );
    });
});
