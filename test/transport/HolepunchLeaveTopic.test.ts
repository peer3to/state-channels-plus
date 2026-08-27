import { expect } from "chai";
import { Buffer } from "buffer";

import { P2PManagerFixture } from "@test/fixtures/P2PManagerFixture";

describe("Holepunch topic lifecycle", function () {
    let fixture: P2PManagerFixture;

    beforeEach(async function () {
        fixture = new P2PManagerFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
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
