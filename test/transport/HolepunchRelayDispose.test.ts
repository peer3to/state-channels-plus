import { HolepunchRelayFixture } from "@test/fixtures/HolepunchRelayFixture";
import { Buffer } from "buffer";

describe("Holepunch disposal on a browser relay", function () {
    let fixture: HolepunchRelayFixture;

    beforeEach(function () {
        fixture = new HolepunchRelayFixture();
        fixture.setup();
    });

    afterEach(function () {
        fixture.cleanup();
    });

    it("disposes while the first topic announce still waits on the relayer's listening reply", async function () {
        const holepunch = fixture.createBrowserHolepunch([
            "wss://relay.example"
        ]);
        fixture.latestSocket().emitOpen();
        // A just-joined topic: the swarm's first refresh waits on the
        // relayer's "listening" reply, which the relayer never sent yet.
        await holepunch.join(Buffer.alloc(32, 1));

        // A hang here fails the test at its timeout.
        await holepunch.dispose();
    });
});
