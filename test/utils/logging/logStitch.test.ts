import { expect } from "chai";
// CommonJS module under scripts/ — require it directly (no express dependency).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
    buildAppendLines,
    parseLastSeq
} = require("../../../scripts/logging/logStitch.js");

const e = (m: string) => ({
    time: "t",
    level: "warn",
    context: {},
    sharedContext: {},
    message: m,
    meta: [],
    stack: ""
});

describe("logStitch.buildAppendLines", () => {
    it("appends new entries with seq prefixes from a fresh file", () => {
        const { lines, newLastSeq, gap } = buildAppendLines(
            [e("a"), e("b")],
            0, // fromSeq
            -1 // lastWrittenSeq (empty file)
        );
        expect(gap).to.equal(null);
        expect(newLastSeq).to.equal(1);
        expect(lines.map((l: string) => JSON.parse(l).seq)).to.deep.equal([
            0, 1
        ]);
        expect(JSON.parse(lines[0]).message).to.equal("a");
    });

    it("dedups entries already written on a retry", () => {
        const { lines, newLastSeq } = buildAppendLines(
            [e("a"), e("b"), e("c")],
            0,
            1 // already wrote seq 0,1
        );
        expect(newLastSeq).to.equal(2);
        expect(lines.map((l: string) => JSON.parse(l).seq)).to.deep.equal([2]);
    });

    it("writes a gap marker when fromSeq jumps past lastWrittenSeq+1", () => {
        const { lines, newLastSeq, gap } = buildAppendLines(
            [e("x")],
            16, // fromSeq
            7 // lastWrittenSeq → 8..15 missing
        );
        expect(gap).to.deep.equal([8, 15]);
        expect(JSON.parse(lines[0]).gap).to.deep.equal([8, 15]);
        expect(JSON.parse(lines[1]).seq).to.equal(16);
        expect(newLastSeq).to.equal(16);
    });

    it("parseLastSeq reads the seq of the last seq-bearing NDJSON line", () => {
        const ndjson =
            '{"seq":0,"message":"a"}\n{"gap":[1,2]}\n{"seq":3,"message":"b"}\n';
        expect(parseLastSeq(ndjson)).to.equal(3);
        expect(parseLastSeq("")).to.equal(-1);
    });
});
