import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";
import { Buffer } from "buffer";
import { expect } from "chai";

describe("Holepunch topic lifecycle", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("reannounces duplicate topics in their insertion order", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchRejoinAfterLeave(true)
            .request();
        expect(result.joinCalls.map((call) => call.topicHex)).to.deep.equal(
            ["topic-b", "topic-b", "topic-c"].map((topic) =>
                Buffer.from(topic).toString("hex")
            )
        );
    });

    it("records a joined Buffer topic with server and client discovery enabled", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAbsentLeave()
            .request();

        expect(result.joinedTopics).to.deep.equal([
            Buffer.from("topic-a").toString("hex")
        ]);
        expect(result.joinCalls).to.deep.equal([
            {
                topicHex: Buffer.from("topic-a").toString("hex"),
                options: { server: true, client: true }
            }
        ]);
    });

    it("removes the first byte-equal topic and calls swarm leave", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchJoinAndEqualLeave()
            .request();

        expect(result.joinedTopics).to.deep.equal([]);
        expect(result.leaveCalls).to.deep.equal([
            Buffer.from("topic-a").toString("hex")
        ]);
    });

    it("keeps the second duplicate join after leaving once", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchDuplicateLeave()
            .request();

        expect(result.joinedTopics).to.deep.equal([
            Buffer.from("topic-a").toString("hex")
        ]);
        expect(result.leaveCalls).to.have.length(1);
    });

    it("does nothing when leaving a topic that was never joined", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAbsentLeave()
            .request();

        expect(result.leaveCalls).to.deep.equal([]);
        expect(result.joinedTopics).to.have.length(1);
    });

    it("does nothing when leave runs before lazy swarm creation", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchLeaveBeforeSwarm()
            .request();

        expect(result).to.deep.equal({
            joinedTopics: [],
            joinCalls: [],
            leaveCalls: []
        });
    });

    it("does not reannounce a topic removed before a rejoin cycle", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchRejoinAfterLeave()
            .request();

        expect(result.joinCalls).to.deep.equal([
            {
                topicHex: Buffer.from("topic-b").toString("hex"),
                options: { server: true, client: true }
            },
            {
                topicHex: Buffer.from("topic-c").toString("hex"),
                options: { server: true, client: true }
            }
        ]);
    });
});

describe("Holepunch topic lookup", function () {
    let fixture: P2PManagerFixture;
    const topicA = Buffer.from("topic-a").toString("hex");
    const topicB = Buffer.from("topic-b").toString("hex");

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("looks a joined topic up once after its announce completes", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAnnounceLookup("flushed")
            .request();

        expect(result.lookupsBeforeFlush).to.deep.equal([]);
        expect(result.lookupsAfterFlush).to.deep.equal([topicA]);
        expect(
            result.debugTimings.map((timing) => timing.message)
        ).to.deep.equal([
            "Holepunch topic announced",
            "Holepunch topic lookup finished"
        ]);
        for (const timing of result.debugTimings)
            expect(timing.sinceJoinMs).to.be.a("number");
    });

    it("keeps the announce timing of a duplicate join after leaving once", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAnnounceLookup("duplicate-left-once")
            .request();

        expect(result.lookupsAfterFlush).to.deep.equal([topicA]);
        expect(
            result.debugTimings.map((timing) => timing.message)
        ).to.deep.equal([
            "Holepunch topic announced",
            "Holepunch topic lookup finished"
        ]);
        for (const timing of result.debugTimings)
            expect(timing.sinceJoinMs).to.be.a("number");
    });

    it("does not look up a topic left before its announce completes", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAnnounceLookup("left-before-flush")
            .request();

        expect(result.lookupsAfterFlush).to.deep.equal([]);
    });

    it("does not look up a topic after the swarm is destroyed", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAnnounceLookup(
                "destroyed-before-flush"
            )
            .request();

        expect(result.lookupsAfterFlush).to.deep.equal([]);
    });

    it("looks each joined topic up once when a peer's ban is released", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchBanReleaseLookup(false)
            .request();

        expect(result.banCalls).to.deep.equal([false]);
        expect(result.lookups).to.deep.equal([topicA, topicB]);
    });

    it("looks no topic up when a peer is banned", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchBanReleaseLookup(true)
            .request();

        expect(result.banCalls).to.deep.equal([true]);
        expect(result.lookups).to.deep.equal([]);
    });

    it("logs a failed announce at debug level and does not look the topic up", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAnnounceLookup("flush-failed")
            .request();

        expect(result.debugs).to.include("Holepunch announce failed");
        expect(result.warningsAndErrors).to.deep.equal([]);
        expect(result.lookupsAfterFlush).to.deep.equal([]);
    });

    it("logs a failed topic lookup at debug level", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchAnnounceLookup("lookup-failed")
            .request();

        expect(result.lookupsAfterFlush).to.deep.equal([topicA]);
        expect(result.debugs).to.include("Holepunch topic lookup failed");
        expect(result.warningsAndErrors).to.deep.equal([]);
    });
});

describe("Holepunch connection attempts", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("logs one attempt per dial and keeps other update listeners on a shared swarm", async function () {
        const result = await fixture
            .control()
            .p2pManagerProbe.probeHolepunchConnectionAttempts()
            .request();

        expect(result.attemptLogsAfterUpdateWithoutDial).to.equal(0);
        expect(result.attemptLogsAfterOneDial).to.equal(1);
        expect(result.attemptLogsAfterUpdateWithoutDialAgain).to.equal(1);
        expect(result.attemptLogsAfterTwoDials).to.equal(3);
        expect(result.foreignUpdateCalls).to.equal(5);
        expect(result.updateListenersWhileJoined).to.equal(2);
        expect(result.updateListenersAfterDispose).to.equal(1);
    });
});
