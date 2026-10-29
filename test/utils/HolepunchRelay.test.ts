import HolepunchRelay from "@/HolepunchRelay";
import { HolepunchRelayFixture } from "@test/fixtures/HolepunchRelayFixture";
import { expect } from "chai";

describe("HolepunchRelay", function () {
    let fixture: HolepunchRelayFixture;

    beforeEach(async function () {
        fixture = new HolepunchRelayFixture();
        await fixture.setup();
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

        fixture.latestSocket().emitClose(1006, "gone");
        fixture.tick(250);

        expect(
            fixture
                .relayerFailures()
                .map((failure) => (failure as Error).message)
        ).to.deep.equal([
            "Holepunch relayer wss://relay-a.example close event (code 1006, reason gone)"
        ]);
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

    it("a relay socket closing after disposal neither logs nor reconnects", function () {
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);
        const socket = fixture.latestSocket();
        socket.emitError();

        fixture.disposeRuntime();
        // A log through the disposed logger would throw out of this close.
        socket.emitClose();
        fixture.tick(30_000);

        expect(fixture.sockets()).to.deep.equal([socket]);
        expect(socket.readyState).to.equal(3);
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

    it("fails over once, with no unhandled rejection, when a socket fails before it opens", async function () {
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);

        fixture.latestSocket().failBeforeOpen();

        expect(await fixture.unhandledRejections()).to.deep.equal([]);
        const failures = fixture.relayerFailures();
        expect(failures).to.have.length(1);
        expect(failures[0]).to.be.instanceOf(Error);
        expect((failures[0] as Error).message).to.equal(
            "Holepunch relayer wss://relay-a.example error event"
        );
        fixture.tick(250);
        expect(fixture.sockets().map((socket) => socket.url)).to.deep.equal([
            "wss://relay-a.example",
            "wss://relay-b.example"
        ]);
    });

    it("fails over once, naming the relayer, when the relay's opening rejects with its own Error", async function () {
        fixture.createSocketsClosed();
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);

        expect(await fixture.unhandledRejections()).to.deep.equal([]);
        const failures = fixture.relayerFailures() as Error[];
        expect(failures.map((failure) => failure.message)).to.deep.equal([
            "Holepunch relayer wss://relay-a.example failed to open: Socket is closed"
        ]);
        expect((Reflect.get(failures[0], "cause") as Error).message).to.equal(
            "Socket is closed"
        );
        expect(fixture.sockets()).to.have.length(1);
    });

    it("counts one failure when a socket closes before it opens with no error event", async function () {
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);

        fixture.latestSocket().emitClose(1006, "");

        expect(await fixture.unhandledRejections()).to.deep.equal([]);
        expect(
            fixture
                .relayerFailures()
                .map((failure) => (failure as Error).message)
        ).to.deep.equal([
            "Holepunch relayer wss://relay-a.example close event (code 1006)"
        ]);
        fixture.tick(250);
        expect(fixture.sockets()).to.have.length(2);
    });

    it("a relay opening that fails after disposal neither counts a failure nor reconnects", async function () {
        fixture.init(["wss://relay-a.example", "wss://relay-b.example"]);
        const socket = fixture.latestSocket();

        fixture.disposeRuntime();
        socket.failBeforeOpen();

        expect(await fixture.unhandledRejections()).to.deep.equal([]);
        fixture.tick(30_000);
        expect(fixture.relayerFailures()).to.deep.equal([]);
        expect(fixture.sockets()).to.deep.equal([socket]);
    });

    it("throws at initialization for an invalid relayer URL among valid ones, a configuration error, and opens no socket, counts no relay failure and retries nothing", function () {
        expect(() =>
            fixture.init(["wss://relay-a.example", "not a url"])
        ).to.throw(
            Error,
            'Invalid holepunch relayer URL "not a url": expected a ws: or wss: URL'
        );
        expect(() =>
            fixture.init(["wss://relay-a.example", "https://relay-b.example"])
        ).to.throw(
            Error,
            'Invalid holepunch relayer URL "https://relay-b.example": expected a ws: or wss: URL'
        );

        fixture.tick(30_000);
        expect(fixture.relayerFailures()).to.deep.equal([]);
        expect(fixture.sockets()).to.deep.equal([]);
        expect(fixture.updates()).to.equal(0);
    });
});
