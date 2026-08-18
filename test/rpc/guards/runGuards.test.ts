import { expect } from "chai";

import { RunGuardsFixture } from "@test/fixtures/RunGuardsFixture";
import { runGuards } from "@/rpc/guards/runGuards";

describe("runGuards", function () {
    it("returns false and stops when the first guard fails", function () {
        const fixture = new RunGuardsFixture();

        expect(
            runGuards(
                fixture.guards(false, true),
                fixture.rpc,
                fixture.transport
            )
        ).to.equal(false);
        expect(fixture.events).to.deep.equal(["check:1", "failure:1"]);
    });

    it("returns true after every guard passes in declaration order", function () {
        const fixture = new RunGuardsFixture();

        expect(
            runGuards(
                fixture.guards(true, true),
                fixture.rpc,
                fixture.transport
            )
        ).to.equal(true);
        expect(fixture.events).to.deep.equal(["check:1", "check:2"]);
    });

    it("returns true for an empty guard list", function () {
        const fixture = new RunGuardsFixture();

        expect(runGuards([], fixture.rpc, fixture.transport)).to.equal(true);
        expect(fixture.events).to.deep.equal([]);
    });

    it("calls one failure handler and skips later guards after a middle failure", function () {
        const fixture = new RunGuardsFixture();

        expect(
            runGuards(
                fixture.guards(true, false, true),
                fixture.rpc,
                fixture.transport
            )
        ).to.equal(false);
        expect(fixture.events).to.deep.equal([
            "check:1",
            "check:2",
            "failure:2"
        ]);
    });

    it("calls the last guard failure handler after earlier guards pass", function () {
        const fixture = new RunGuardsFixture();

        expect(
            runGuards(
                fixture.guards(true, true, false),
                fixture.rpc,
                fixture.transport
            )
        ).to.equal(false);
        expect(fixture.events).to.deep.equal([
            "check:1",
            "check:2",
            "check:3",
            "failure:3"
        ]);
    });
});
