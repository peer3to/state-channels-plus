import { expect } from "chai";

import { Status } from "@/types";
import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";

describe("InitHandshake lifecycle routing", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup({ openChannel: true });
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("routes a completed handshake from NOT_OPENED without starting sync", async function () {
        const result = await fixture.runHandshakeRouting(Status.NOT_OPENED);

        expect(result.connected).to.equal(true);
        expect(result.hookCount).to.equal(1);
        expect(result.hookIsChannelOpened).to.equal(false);
        expect(result.syncCallCount).to.equal(0);
    });

    it("routes a completed handshake from OPENED and starts participant sync", async function () {
        const result = await fixture.runHandshakeRouting(Status.OPENED);

        expect(result.connected).to.equal(true);
        expect(result.hookCount).to.equal(1);
        expect(result.hookIsChannelOpened).to.equal(true);
        expect(result.syncTargets).to.deep.equal([fixture.address(1)]);
    });

    it("routes a completed handshake from SYNCED without starting sync", async function () {
        const result = await fixture.runHandshakeRouting(Status.SYNCED);

        expect(result.connected).to.equal(true);
        expect(result.hookCount).to.equal(1);
        expect(result.hookIsChannelOpened).to.equal(false);
        expect(result.syncCallCount).to.equal(0);
    });

    it("routes a completed handshake from PENDING_PARTICIPANT without starting sync", async function () {
        const result = await fixture.runHandshakeRouting(
            Status.PENDING_PARTICIPANT
        );

        expect(result.connected).to.equal(true);
        expect(result.hookCount).to.equal(1);
        expect(result.hookIsChannelOpened).to.equal(false);
        expect(result.syncCallCount).to.equal(0);
    });

    it("routes a completed handshake from PARTICIPATING without starting sync", async function () {
        const result = await fixture.runHandshakeRouting(Status.PARTICIPATING);

        expect(result.connected).to.equal(true);
        expect(result.hookCount).to.equal(1);
        expect(result.hookIsChannelOpened).to.equal(false);
        expect(result.syncCallCount).to.equal(0);
    });
});
