import { expectedThreadLabelLine } from "@test/fixtures/logging/ThreadLabelExpectation";
import { renderNodeThreadLabelLines } from "@test/fixtures/node/NodeLogRenderCapture";
import { expect } from "chai";

describe("NodeLogger thread label", function () {
    it("renders main for a log line whose context names no thread", function () {
        const lines = renderNodeThreadLabelLines(undefined);
        expect(lines).to.have.length(1);
        expect(lines[0]).to.match(expectedThreadLabelLine("main"));
    });

    it("renders main for a main-thread log line", function () {
        const lines = renderNodeThreadLabelLines("main");
        expect(lines).to.have.length(1);
        expect(lines[0]).to.match(expectedThreadLabelLine("main"));
    });

    it("renders sdk for an SDK-thread log line", function () {
        const lines = renderNodeThreadLabelLines("sdk");
        expect(lines).to.have.length(1);
        expect(lines[0]).to.match(expectedThreadLabelLine("sdk"));
    });

    it("renders vm for a VM-thread log line", function () {
        const lines = renderNodeThreadLabelLines("vm");
        expect(lines).to.have.length(1);
        expect(lines[0]).to.match(expectedThreadLabelLine("vm"));
    });

    it("renders prover for a consumer prover-thread log line", function () {
        const lines = renderNodeThreadLabelLines("prover");
        expect(lines).to.have.length(1);
        expect(lines[0]).to.match(expectedThreadLabelLine("prover"));
    });
});
