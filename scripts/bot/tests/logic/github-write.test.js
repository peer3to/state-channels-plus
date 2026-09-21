const assert = require("node:assert/strict");
const { GitHubWriter, actionsBotId } = require("../../github-write");
const { request } = require("../fixtures/records");
const { RecordedGitHub } = require("../fixtures/github");
const input = request();
const thread = {
    id: "thread1",
    isResolved: false,
    comments: { nodes: [{ databaseId: 30 }] }
};
const observed = {
    threads: [thread],
    inline: [{ id: 30, user: { id: 9, type: "Bot" } }]
};
function fixture(records) {
    const wire = new RecordedGitHub(records);
    return {
        wire,
        writer: new GitHubWriter(input, {
            token: "recorded-boundary-token",
            botId: 9,
            exchange: wire.exchange.bind(wire)
        })
    };
}
describe("review CI mutation ownership", function () {
    it("replies only to the root of an existing bot-owned thread", async function () {
        const { writer, wire } = fixture([
            {
                path: `/repos/${input.repository.name}/pulls/6/comments/30/replies`,
                method: "POST",
                inspect: (body) => assert.equal(body.body, "New evidence."),
                response: { id: 31 }
            }
        ]);
        assert.equal(
            (await writer.reply(thread, "New evidence.", observed)).id,
            31
        );
        wire.done();
    });
    it("rejects a reply or resolution on another author's thread", async function () {
        const { writer, wire } = fixture([]);
        const foreign = {
            ...observed,
            inline: [{ id: 30, user: { id: 7, type: "User" } }]
        };
        await assert.rejects(writer.reply(thread, "New evidence.", foreign), {
            code: "UNAUTHORIZED"
        });
        await assert.rejects(writer.setResolved(thread, true, foreign), {
            code: "UNAUTHORIZED"
        });
        wire.done();
    });
    it("resolves an observed bot thread through the fixed mutation", async function () {
        const { writer, wire } = fixture([
            {
                path: "/graphql",
                method: "POST",
                inspect: (body) => {
                    assert.ok(body.query.includes("resolveReviewThread"));
                    assert.deepEqual(body.variables, { id: "thread1" });
                },
                response: {
                    data: {
                        resolveReviewThread: {
                            thread: { id: "thread1", isResolved: true }
                        }
                    }
                }
            }
        ]);
        await writer.setResolved(thread, true, observed);
        wire.done();
    });
    it("leaves an already matching resolution state unchanged", async function () {
        const { writer, wire } = fixture([]);
        assert.equal(
            (await writer.setResolved(thread, false, observed)).unchanged,
            true
        );
        wire.done();
    });
    it("dismisses only the bot's own stale approval", async function () {
        const { writer, wire } = fixture([
            {
                path: `/repos/${input.repository.name}/pulls/6/reviews/40/dismissals`,
                method: "PUT",
                response: { id: 40 }
            }
        ]);
        const review = {
            id: 40,
            user: { id: 9, type: "Bot" },
            state: "APPROVED",
            commit_id: "b".repeat(40)
        };
        await writer.dismissOwnStale(review);
        await assert.rejects(
            writer.dismissOwnStale({ ...review, user: { id: 7, type: "User" } })
        );
        await assert.rejects(
            writer.dismissOwnStale({ ...review, commit_id: input.head })
        );
        wire.done();
    });
    it("does not take ownership of a human thread merely because the bot replied", async function () {
        const { writer, wire } = fixture([]);
        const humanThread = {
            ...thread,
            comments: { nodes: [{ databaseId: 29 }, { databaseId: 30 }] }
        };
        await assert.rejects(
            writer.setResolved(humanThread, true, {
                ...observed,
                threads: [humanThread]
            }),
            { code: "UNAUTHORIZED" }
        );
        wire.done();
    });

    it("loads every page of conversation comments and prior reviews", async function () {
        const first = Array.from({ length: 100 }, (_, id) => ({ id: id + 1 }));
        const prefix = `/repos/${input.repository.name}`;
        const { writer, wire } = fixture([
            {
                path: `${prefix}/issues/6/comments?per_page=100&page=1`,
                response: first
            },
            {
                path: `${prefix}/issues/6/comments?per_page=100&page=2`,
                response: [{ id: 101 }]
            },
            {
                path: `${prefix}/pulls/6/reviews?per_page=100&page=1`,
                response: first
            },
            {
                path: `${prefix}/pulls/6/reviews?per_page=100&page=2`,
                response: [{ id: 102 }]
            }
        ]);
        assert.equal((await writer.pages("/issues/6/comments")).at(-1).id, 101);
        assert.equal((await writer.pages("/pulls/6/reviews")).at(-1).id, 102);
        wire.done();
    });
    it("loads paginated review threads and all replies before returning observations", async function () {
        const lastPage = { hasNextPage: false, endCursor: null };
        const firstThread = {
            id: "thread1",
            isResolved: false,
            comments: {
                nodes: [{ databaseId: 30 }],
                pageInfo: { hasNextPage: true, endCursor: "reply-next" }
            }
        };
        const { writer, wire } = fixture([
            {
                path: "/graphql",
                method: "POST",
                response: {
                    data: {
                        repository: {
                            databaseId: 1,
                            pullRequest: {
                                number: 6,
                                reviewThreads: {
                                    nodes: [firstThread],
                                    pageInfo: {
                                        hasNextPage: true,
                                        endCursor: "thread-next"
                                    }
                                }
                            }
                        }
                    }
                }
            },
            {
                path: "/graphql",
                method: "POST",
                inspect: (body) =>
                    assert.deepEqual(body.variables, {
                        id: "thread1",
                        cursor: "reply-next"
                    }),
                response: {
                    data: {
                        node: {
                            id: "thread1",
                            comments: {
                                nodes: [{ databaseId: 31 }],
                                pageInfo: lastPage
                            }
                        }
                    }
                }
            },
            {
                path: "/graphql",
                method: "POST",
                inspect: (body) =>
                    assert.equal(body.variables.cursor, "thread-next"),
                response: {
                    data: {
                        repository: {
                            databaseId: 1,
                            pullRequest: {
                                number: 6,
                                reviewThreads: {
                                    nodes: [
                                        {
                                            id: "thread2",
                                            isResolved: true,
                                            comments: {
                                                nodes: [{ databaseId: 32 }],
                                                pageInfo: lastPage
                                            }
                                        }
                                    ],
                                    pageInfo: lastPage
                                }
                            }
                        }
                    }
                }
            }
        ]);
        const threads = await writer.threads();
        assert.deepEqual(
            threads.map((thread) => thread.id),
            ["thread1", "thread2"]
        );
        assert.deepEqual(
            threads[0].comments.nodes.map((comment) => comment.databaseId),
            [30, 31]
        );
        wire.done();
    });
});

describe("GitHub Actions publisher identity", function () {
    it("resolves the fixed GitHub Actions bot through a read-only lookup", async function () {
        const wire = new RecordedGitHub([
            {
                path: "/users/github-actions%5Bbot%5D",
                response: {
                    id: 41898282,
                    login: "github-actions[bot]",
                    type: "Bot"
                }
            }
        ]);
        assert.equal(
            await actionsBotId("recorded-token", wire.exchange.bind(wire)),
            41898282
        );
        wire.done();
    });
    it("rejects a different actor returned by the identity lookup", async function () {
        const wire = new RecordedGitHub([
            {
                path: "/users/github-actions%5Bbot%5D",
                response: { id: 7, login: "maintainer", type: "User" }
            }
        ]);
        await assert.rejects(
            actionsBotId("recorded-token", wire.exchange.bind(wire)),
            { code: "UNAUTHORIZED" }
        );
        wire.done();
    });
    it("fails visibly when the publisher identity cannot be read", async function () {
        const wire = new RecordedGitHub([
            {
                path: "/users/github-actions%5Bbot%5D",
                status: 403,
                response: { message: "denied" }
            }
        ]);
        await assert.rejects(
            actionsBotId("recorded-token", wire.exchange.bind(wire)),
            { code: "CONTEXT_UNAVAILABLE" }
        );
        wire.done();
    });
});
