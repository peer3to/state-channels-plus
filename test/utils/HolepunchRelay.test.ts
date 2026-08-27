import { expect } from "chai";

import HolepunchRelay from "@/HolepunchRelay";
import { HolepunchRelayFixture } from "@test/fixtures/HolepunchRelayFixture";

describe("HolepunchRelay", function () {
    let fixture: HolepunchRelayFixture;

    beforeEach(function () {
        fixture = new HolepunchRelayFixture();
        fixture.setup();
    });

    afterEach(function () {
        fixture.cleanup();
    });

    it("stays idle when no relayer URL is configured", function () {
        fixture.init([]);

        expect(HolepunchRelay.getInstance().getSwarm()).to.equal(undefined);
        expect(fixture.sockets()).to.deep.equal([]);
        expect(fixture.updates()).to.equal(0);
    });

    it("reconnects after a relay socket closes", function () {
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);

        fixture.latestSocket().emitClose();
        fixture.tick(250);

        expect(fixture.sockets().map((socket) => socket.url)).to.deep.equal([
            "wss://relay-a.example",
            "wss://relay-b.example"
        ]);
        expect(fixture.updates()).to.equal(2);
    });

    it("keeps reconnecting after the whole relay pool fails", function () {
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);

        fixture.latestSocket().emitClose();
        fixture.tick(250);
        fixture.latestSocket().emitClose();
        fixture.tick(1000);
        fixture.latestSocket().emitClose();
        fixture.tick(250);

        expect(fixture.sockets().map((socket) => socket.url)).to.deep.equal([
            "wss://relay-a.example",
            "wss://relay-b.example",
            "wss://relay-a.example",
            "wss://relay-b.example"
        ]);
        expect(fixture.updates()).to.equal(4);
    });

    it("keeps retrying one configured relay", function () {
        fixture.init(["wss://relay.example"]);

        fixture.latestSocket().emitError();
        fixture.tick(1000);
        fixture.latestSocket().emitError();
        fixture.tick(2000);

        expect(fixture.sockets().map((socket) => socket.url)).to.deep.equal([
            "wss://relay.example",
            "wss://relay.example",
            "wss://relay.example"
        ]);
        expect(fixture.updates()).to.equal(3);
    });

    it("resets failed-relay exclusions after a successful connection", function () {
        fixture.reset([0, 0.9, 0, 0.9, 0]);
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);

        fixture.latestSocket().emitClose();
        fixture.tick(250);
        fixture.latestSocket().emitOpen();
        fixture.latestSocket().emitClose();
        fixture.tick(250);

        expect(fixture.sockets().map((socket) => socket.url)).to.deep.equal([
            "wss://relay-a.example",
            "wss://relay-b.example",
            "wss://relay-a.example"
        ]);
    });

    it("deduplicates error and close events from one socket", function () {
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);
        const failedSocket = fixture.latestSocket();

        failedSocket.emitError();
        failedSocket.emitClose();
        fixture.tick(250);

        expect(fixture.sockets()).to.have.length(2);
        expect(fixture.updates()).to.equal(2);
    });
});
