const assert = require("node:assert/strict");
const {
    allocate,
    readStates,
    encodeState,
    actionMarker,
    findAction
} = require("../../state");
const { request } = require("../fixtures/records");
const input = request();
function comment(state, user = { id: 9, type: "Bot" }) {
    return { id: state.round, user, body: encodeState(state) };
}
describe("review publication state", function () {
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
