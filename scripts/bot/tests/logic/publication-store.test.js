const assert = require("node:assert/strict");
const { publicationStore } = require("../fixtures/publication");
const { PublicationStore } = require("../../publication-store");
const { allocate, publicContext, encodeState } = require("../../state");
const { digest } = require("../../data");
const { request } = require("../fixtures/records");

describe("private publication journal", function () {
    it("persists a large report across restart without any GitHub carrier", async function () {
        const store = publicationStore(),
            input = request();
        const state = allocate(input, { comments: [] }, 9);
        state.findings = [
            { id: "R1FO1", body: "Long detailed review. ".repeat(10000) }
        ];
        const before = await store.load(input);
        await store.save(input, digest(before), [state]);
        const restarted = new PublicationStore(store.root);
        assert.deepEqual(await restarted.load(input), { states: [state] });
        assert.deepEqual(await restarted.load({ ...input, pr: 7 }), {
            states: []
        });
    });
    it("accepts a lost-acknowledgement retry and rejects a stale competing update", async function () {
        const store = publicationStore(),
            input = request();
        const before = digest(await store.load(input));
        const state = allocate(input, { comments: [] }, 9);
        await store.save(input, before, [state]);
        assert.deepEqual(await store.save(input, before, [state]), {
            states: [state]
        });
        await assert.rejects(
            store.save(input, before, [{ ...state, status: "complete" }]),
            { code: "INVALID_RESULT" }
        );
        assert.deepEqual(await store.load(input), { states: [state] });
    });
    it("refuses foreign PR state without changing its journal", async function () {
        const store = publicationStore(),
            input = request();
        const state = allocate(input, { comments: [] }, 9);
        await assert.rejects(
            store.save(input, digest({ states: [] }), [{ ...state, pr: 7 }]),
            { code: "INVALID_RESULT" }
        );
        assert.deepEqual(await store.load(input), { states: [] });
    });
    it("removes historical report payloads from model context while retaining finding revisions", function () {
        const input = request();
        const finding = {
            id: "R1FO1",
            body: "Duplicated prose".repeat(1000),
            status: "continued",
            threadId: null
        };
        const state = {
            ...allocate(input, { comments: [] }, 9),
            findings: [finding]
        };
        const original = {
            user: { id: 9, type: "Bot" },
            body: "Visible finding\n" + encodeState(state)
        };
        const output = publicContext([original])[0];
        assert.equal(output.body, "Visible finding");
        assert.equal(output.reviewFindings[0].sourceRevision, digest(finding));
        assert.ok(JSON.stringify(output).length < 500);
        assert.ok(original.body.includes("peer3-review-state"));
        const human = { ...original, user: { id: 7, type: "User" } };
        assert.deepEqual(publicContext(human), human);
    });
});
