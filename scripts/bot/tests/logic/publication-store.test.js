const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { publicationStore } = require("../fixtures/publication");
const { PublicationStore } = require("../../publication-store");
const { allocate, publicContext, encodeState } = require("../../state");
const { digest, writeJson } = require("../../data");
const { request } = require("../fixtures/records");

describe("private publication journal", function () {
    it("preserves the durable revision after a filesystem failure and recovers its save queue", async function () {
        const store = publicationStore(),
            input = request();
        const initial = allocate(input, { comments: [] }, 9);
        const saved = await store.save(input, digest({ states: [] }), [
            initial
        ]);
        const write = fs.writeFile;
        try {
            fs.writeFile = async function (file, ...args) {
                if (String(file).startsWith(store.root))
                    throw Object.assign(new Error("full"), { code: "ENOSPC" });
                return write.call(this, file, ...args);
            };
            await assert.rejects(
                store.save(input, digest(saved), [
                    { ...initial, status: "complete" }
                ])
            );
        } finally {
            fs.writeFile = write;
        }
        assert.deepEqual(await store.load(input), saved);
        assert.equal(
            (
                await store.save(input, digest(saved), [
                    { ...initial, status: "complete" }
                ])
            ).states[0].status,
            "complete"
        );
    });
    it("rejects corrupt and unreadable journals instead of treating them as absent", async function () {
        const store = publicationStore(),
            input = request();
        const filename = path.join(
            store.root,
            `${input.repository.id}-${input.pr}-publication.json`
        );
        await fs.writeFile(filename, "not JSON");
        await assert.rejects(store.load(input), SyntaxError);
        assert.equal(await fs.readFile(filename, "utf8"), "not JSON");
        const read = fs.readFile;
        try {
            fs.readFile = async function (file, ...args) {
                if (file === filename)
                    throw Object.assign(new Error("denied"), {
                        code: "EACCES"
                    });
                return read.call(this, file, ...args);
            };
            await assert.rejects(store.load(input), { code: "EACCES" });
        } finally {
            fs.readFile = read;
        }
        await fs.writeFile(filename, JSON.stringify({ states: [] }));
        assert.deepEqual(await store.load(input), { states: [] });
    });
    it("serializes competing saves so exactly one expected-revision writer wins", async function () {
        const store = publicationStore(),
            input = request();
        const before = digest(await store.load(input));
        const a = allocate(input, { comments: [] }, 9),
            b = { ...a, status: "complete" };
        const results = await Promise.allSettled([
            store.save(input, before, [a]),
            store.save(input, before, [b])
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.deepEqual(
            await store.load(input),
            results.find((r) => r.status === "fulfilled").value
        );
    });
    it("preserves distinct legacy snapshots for one head when saving the next review", async function () {
        const store = publicationStore(),
            input = request();
        const original = allocate(input, { comments: [] }, 9);
        const states = [
            {
                ...original,
                status: "intent",
                findings: [{ id: "R1FO1", body: "original" }]
            },
            {
                ...original,
                status: "partial",
                findings: [{ id: "R1FO1", body: "updated" }]
            },
            {
                ...original,
                status: "partial",
                sequence: 2,
                findings: [
                    { id: "R1FO1", body: "different accepted analysis" }
                ],
                actions: [{ kind: "review-comment", id: 23 }]
            },
            {
                ...original,
                status: "complete",
                findings: [{ id: "R1FO1", body: "confirmed" }]
            }
        ];
        await writeJson(
            store.root,
            `${input.repository.id}-${input.pr}-publication.json`,
            { states }
        );
        const before = await store.load(input);
        const next = { ...original, head: "f".repeat(40), round: 2 };
        const saved = await store.save(input, digest(before), [
            ...before.states,
            next
        ]);
        assert.deepEqual((await store.read(input)).states.slice(0, 4), states);
        assert.deepEqual(await store.load(input), saved);
        assert.deepEqual(
            await store.save(input, digest(before), [...before.states, next]),
            saved
        );
        const changed = structuredClone(saved.states);
        changed[0].status = "complete";
        changed[0].findings = [{ id: "FOREIGN" }];
        await assert.rejects(store.save(input, digest(saved), changed), {
            code: "INVALID_RESULT"
        });
    });
    it("transfers only current prose while retaining full historical reports on the worker", async function () {
        const store = publicationStore(),
            input = request();
        let journal = await store.load(input);
        for (let round = 1; round <= 24; round++) {
            const state = {
                ...allocate(input, { comments: [] }, 9),
                head: round.toString(16).padStart(40, "0"),
                round,
                findings: [
                    {
                        id: `R${round}FO1`,
                        body: "Historical analysis. ".repeat(12000)
                    }
                ]
            };
            journal = await store.save(input, digest(journal), [
                ...journal.states,
                state
            ]);
        }
        assert.ok(
            Buffer.byteLength(JSON.stringify(await store.read(input))) >
                4 * 1024 * 1024
        );
        assert.ok(Buffer.byteLength(JSON.stringify(journal)) < 300000);
        assert.deepEqual(journal.states[0].findings, [{ id: "R1FO1" }]);
        assert.match(
            (await store.read(input)).states[0].findings[0].body,
            /Historical analysis/
        );
        const restarted = new PublicationStore(store.root);
        assert.deepEqual(await restarted.load(input), journal);
        assert.deepEqual(
            await restarted.save(input, digest(journal), journal.states),
            journal
        );
    });
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
