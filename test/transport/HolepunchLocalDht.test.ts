import { HolepunchLocalDhtFixture } from "@test/fixtures/HolepunchLocalDhtFixture";
import { expect } from "chai";

describe("Holepunch discovery on a local Hyperswarm DHT", function () {
    let fixture: HolepunchLocalDhtFixture;

    beforeEach(async function () {
        fixture = new HolepunchLocalDhtFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("connects two Node runtimes that join one topic at the same moment", async function () {
        await fixture.joinTogether();
        await fixture.waitForConnections(1);

        for (const index of [0, 1]) {
            expect((await fixture.state(index)).authenticatedToPeer).to.equal(
                1
            );
            expect(await fixture.requestSum(index)).to.equal(3);
        }
    });

    it("does not find, dial or connect a direct peer once its leave of the topic completed", async function () {
        await fixture.joinInOrder();
        await fixture.waitForConnections(1);
        const leaver = await fixture.state(1);
        expect(await fixture.announcedPeerKeys(0)).to.include(leaver.publicKey);

        expect(await fixture.leave(1)).to.equal(true);
        expect(await fixture.closeConnections(1)).to.equal(true);
        expect(await fixture.waitForOpenSwarmConnections(0, 0)).to.equal(true);
        const left = await fixture.state(0);

        expect(await fixture.announcedPeerKeys(0)).to.not.include(
            leaver.publicKey
        );
        await fixture.lookUp(0);
        const after = await fixture.stateAfterRedialWindow(0);
        expect(after.dialAttempts).to.equal(left.dialAttempts);
        expect(after.swarmConnections).to.equal(left.swarmConnections);
        expect(after.openSwarmConnections).to.equal(0);
        expect(after.authenticatedToPeer).to.equal(0);
    });

    it("neither dials nor accepts a blacklisted peer while it stays announced, and connects it once after the release", async function () {
        await fixture.joinTogether();
        await fixture.waitForConnections(1);
        expect(await fixture.blacklistOther(0)).to.equal(true);
        const banned = await fixture.state(0);

        // The banning runtime finds the announced peer and does not dial it.
        await fixture.lookUp(0);
        expect((await fixture.state(0)).dialAttempts).to.equal(
            banned.dialAttempts
        );

        // The banned peer finds the banning runtime and dials it; Hyperswarm
        // refuses that connection.
        await fixture.lookUp(1);
        const verdicts = await fixture.waitForFirewallVerdicts(
            0,
            banned.firewallVerdicts.length + 1
        );
        expect(verdicts.slice(banned.firewallVerdicts.length)).to.not.include(
            false
        );
        const refused = await fixture.state(0);
        expect(refused.swarmConnections).to.equal(banned.swarmConnections);
        expect(refused.authenticatedToPeer).to.equal(0);

        expect(await fixture.unblacklistOther(0)).to.equal(true);
        await fixture.waitForConnections(2);
        expect(await fixture.requestSum(0)).to.equal(3);
        expect((await fixture.state(0)).authenticatedToPeer).to.equal(1);
        expect((await fixture.state(1)).authenticatedToPeer).to.equal(1);
    });

    it("leaves one working connection that carries requests when both runtimes release their bans and dial each other at the same moment", async function () {
        await fixture.joinTogether();
        await fixture.waitForConnections(1);
        expect(await fixture.blacklistOther(0)).to.equal(true);
        expect(await fixture.blacklistOther(1)).to.equal(true);
        // Neither runtime accepts the other's dial before it dialed too.
        await fixture.holdIncomingUntilOwnDial(0);
        await fixture.holdIncomingUntilOwnDial(1);
        const banned = [await fixture.state(0), await fixture.state(1)];

        await Promise.all([
            fixture.unblacklistOther(0),
            fixture.unblacklistOther(1)
        ]);
        await fixture.waitForConnections(2);

        for (const index of [0, 1]) {
            expect(await fixture.requestSum(index)).to.equal(3);
            const state = await fixture.state(index);
            expect(state.dialAttempts).to.be.above(banned[index].dialAttempts);
            expect(state.authenticatedToPeer).to.equal(1);
            expect(state.openSwarmConnections).to.equal(1);
        }
    });
});
