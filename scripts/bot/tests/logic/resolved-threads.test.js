const assert = require("node:assert/strict");
const { resolvedThreads } = require("../../resolved-threads");
const { GitHubWriter } = require("../../github-write");
const { RecordedGitHub, observation } = require("../fixtures/github");
const { request } = require("../fixtures/records");
const { accountingSet } = require("../../reconcile");

describe("resolved discussion handoff", function () {
    it("projects authenticated thread responses to resolved IDs without bodies", async function () {
        const input = request();
        const record = observation(input).at(-1);
        record.inspect = ({ query }) => assert.ok(!query.includes("body"));
        record.response.data.repository.pullRequest.reviewThreads.nodes = [
            {
                id: "closed",
                isResolved: true,
                comments: {
                    nodes: [
                        {
                            id: "node1",
                            databaseId: 1,
                            body: "private-to-handoff body"
                        }
                    ],
                    pageInfo: { hasNextPage: false }
                }
            },
            {
                id: "open",
                isResolved: false,
                comments: {
                    nodes: [{ id: "node2", databaseId: 2, body: "open body" }],
                    pageInfo: { hasNextPage: false }
                }
            }
        ];
        const wire = new RecordedGitHub([record]);
        const reader = new GitHubWriter(input, {
            token: "recorded",
            botId: 9,
            exchange: wire.exchange.bind(wire)
        });
        assert.deepEqual(await resolvedThreads(reader), [
            { id: "closed", comments: [1] }
        ]);
        wire.done();
    });
    it("requires discussion again when a previously resolved thread is reopened", function () {
        const observed = {
            findings: [],
            comments: [],
            reviews: [],
            inline: [{ id: 1, body: "Human reply", user: { id: 7 } }],
            threads: [
                {
                    id: "thread",
                    isResolved: true,
                    comments: { nodes: [{ databaseId: 1 }] }
                }
            ]
        };
        assert.deepEqual(accountingSet(observed, 9), []);
        observed.threads[0].isResolved = false;
        assert.deepEqual(
            accountingSet(observed, 9).map((item) => item.id),
            ["inline:1"]
        );
    });
});
