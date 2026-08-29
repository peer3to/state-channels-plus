import { expect } from "chai";
import { MessageChannel } from "node:worker_threads";

import { TransportType } from "@/transport/TransportType";
import { adaptPort } from "@/evm/p2pRuntime/node/P2pRuntimeChannel";
import { linkedRouters } from "@test/fixtures/rpc/PortRpcProbe.fixture";

describe("MessagePortTransport", function () {
    let link: ReturnType<typeof linkedRouters> | undefined;

    afterEach(function () {
        link?.close();
        link = undefined;
    });

    it("is a trusted transport of its own type", function () {
        link = linkedRouters();

        expect(link.a.transport.isTrusted).to.equal(true);
        expect(link.a.transport.transportType).to.equal(
            TransportType.MESSAGE_PORT
        );
    });

    it("posts the envelope itself, not a serialized string", async function () {
        const channel = new MessageChannel();
        const frames: unknown[] = [];
        channel.port2.on("message", (frame) => frames.push(frame));
        link = linkedRouters();
        const spy = link.a.router.attach(adaptPort(channel.port1));

        spy.send({ service: "probe", method: "echo", params: [1n] });
        await new Promise((resolve) => setTimeout(resolve, 20));

        expect(frames).to.have.length(1);
        expect(frames[0]).to.deep.equal({
            service: "probe",
            method: "echo",
            params: [1n]
        });
        spy.close(true);
        channel.port2.close();
    });

    it("the far end closing its port closes this transport and rejects its requests", async function () {
        link = linkedRouters();

        const pending = link.a.far.probe.never().request();
        link.b.transport.close(true);

        let caught: Error | undefined;
        try {
            await pending;
        } catch (error) {
            caught = error as Error;
        }
        expect(caught).to.be.instanceOf(Error);
        expect(link.a.transport.isClosed).to.equal(true);
    });

    it("an expected close settles pending requests as disposed, not as a failure", async function () {
        link = linkedRouters();

        const pending = link.a.far.probe.never().request();
        link.a.transport.close(true);

        let caught: Error | undefined;
        try {
            await pending;
        } catch (error) {
            caught = error as Error;
        }
        expect(caught?.message).to.equal("Worker link disposed");
        expect(
            link.a.logStore
                .getAllLogs()
                .map((entry) => entry.message)
                .includes("Worker link closed with pending requests")
        ).to.equal(false);
    });
});
