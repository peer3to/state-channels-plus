const assert = require("node:assert/strict");
const {
    allocate,
    readStates,
    encodeState,
    attachState,
    actionMarker,
    findAction
} = require("../../state");
const { request } = require("../fixtures/records");
const input = request();
function comment(state, user = { id: 9, type: "Bot" }) {
    return { id: state.round, user, body: encodeState(state) };
}
describe("review publication state", function () {
    it("reads review-body state and orders updates before later stale comment copies", function () {
        const state = allocate(input, { comments: [] }, 9);
        const review = {
            id: 2,
            user: { id: 9, type: "Bot" },
            body: attachState("Finding body", {
                ...state,
                sequence: 2,
                status: "complete"
            })
        };
        const stale = { ...comment(state), id: 100 };
        const latest = readStates(
            { comments: [stale], reviews: [review] },
            input,
            9
        ).at(-1);
        assert.equal(latest.status, "complete");
        assert.equal(latest.commentKind, "review");
        assert.equal(latest.commentId, 2);
    });
    it("replaces only the current head metadata while preserving finding prose and older rounds", function () {
        const old = {
            ...allocate(input, { comments: [] }, 9),
            head: "f".repeat(40)
        };
        const current = { ...old, head: input.head, round: 2 };
        const body = attachState(attachState("Actual finding", old), current);
        const updated = attachState(body, {
            ...current,
            status: "complete",
            sequence: 1
        });
        assert.ok(updated.startsWith("Actual finding"));
        const states = readStates(
            [{ id: 1, user: { id: 9, type: "Bot" }, body: updated }],
            input,
            9
        );
        assert.equal(states.length, 2);
        assert.equal(states[0].head, old.head);
        assert.equal(states[1].status, "complete");
    });
    it("allocates numeric rounds after the highest confirmed or uncertain intent", function () {
        const old = {
            ...allocate(input, { comments: [] }, 9),
            round: 10,
            head: "b".repeat(40)
        };
        assert.equal(
            allocate(input, { comments: [comment(old)] }, 9).round,
            11
        );
    });
    it("reuses a head intent and its stable finding mappings after a retry", function () {
        const state = {
            ...allocate(input, { comments: [] }, 9),
            mappings: { TO1: "R1TO1" }
        };
        assert.deepEqual(
            allocate(input, { comments: [comment(state)] }, 9).mappings,
            state.mappings
        );
    });
    it("ignores copied state and action markers from another author", function () {
        const state = allocate(input, { comments: [] }, 9);
        assert.deepEqual(
            readStates([comment(state, { id: 7, type: "User" })], input, 9),
            []
        );
        const marker = actionMarker(input, "approve", 1);
        assert.equal(
            findAction(
                {
                    comments: [{ user: { id: 7, type: "User" }, body: marker }],
                    inline: [],
                    reviews: []
                },
                marker,
                9
            ),
            undefined
        );
    });
    it("rejects malformed bot state instead of silently allocating another round", function () {
        assert.throws(
            () =>
                readStates(
                    [
                        comment({
                            ...allocate(input, { comments: [] }, 9),
                            round: 0
                        })
                    ],
                    input,
                    9
                ),
            { code: "INVALID_RESULT" }
        );
    });
});
