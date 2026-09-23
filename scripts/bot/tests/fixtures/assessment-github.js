const assert = require("node:assert/strict");
const { request } = require("./records");
const { encodeState, actionMarker } = require("../../state");

// Stateful recorded HTTP boundary: real publisher/reader operate on GitHub-shaped
// objects. No network, user token, model call or actual GitHub mutation occurs.
function wireFixture(input = request()) {
    const bot = { id: 9, type: "Bot", login: "github-actions[bot]" };
    const finding = {
        id: "R1FO1",
        body: "🟠 **[FO1] — Original defect.**\n\nIt fails on retry.",
        path: null,
        line: null,
        threadId: null,
        status: "continued",
        human: null,
        evidence: ["original source"]
    };
    const old = { ...input, head: "f".repeat(40) };
    const state = {
        version: 1,
        repositoryId: input.repository.id,
        pr: input.pr,
        head: old.head,
        round: 1,
        status: "complete",
        findings: [finding],
        actions: [],
        mappings: { FO1: finding.id }
    };
    const prefix = `/repos/${input.repository.name}`;
    const url = `https://github.com/${input.repository.name}/pull/${input.pr}`;
    const pull = {
        number: input.pr,
        base: {
            repo: { id: input.repository.id, full_name: input.repository.name }
        },
        head: { sha: input.head },
        state: "open",
        draft: false,
        user: { id: 7, login: "author" }
    };
    const reviews = [
        {
            id: 2,
            user: bot,
            html_url: `${url}#pullrequestreview-2`,
            body:
                finding.body +
                "\n\n" +
                actionMarker(old, "finding", finding.id) +
                "\n\n---\n\nSibling stays visible."
        }
    ];
    const comments = [
        {
            id: 1,
            user: bot,
            body: encodeState(state),
            html_url: `${url}#issuecomment-1`
        }
    ];
    const calls = [];
    const inline = [];
    const resolved = new Set();
    let nextId = 10;
    async function exchange(endpoint, options) {
        const route = new URL(endpoint).pathname;
        const body = options.body && JSON.parse(options.body);
        calls.push({ route, method: options.method, body });
        let response;
        if (route === "/users/github-actions%5Bbot%5D") response = bot;
        else if (route === "/graphql") {
            if (body.query.startsWith("mutation ")) {
                const operation = body.query.includes("unresolveReviewThread")
                    ? "unresolveReviewThread"
                    : "resolveReviewThread";
                if (operation === "resolveReviewThread")
                    resolved.add(body.variables.id);
                else resolved.delete(body.variables.id);
                return new Response(
                    JSON.stringify({
                        data: {
                            [operation]: {
                                thread: {
                                    id: body.variables.id,
                                    isResolved: resolved.has(body.variables.id)
                                }
                            }
                        }
                    })
                );
            }
            assert.match(body.query, /^query /);
            response = {
                data: {
                    repository: {
                        databaseId: input.repository.id,
                        pullRequest: {
                            number: input.pr,
                            reviewThreads: {
                                nodes: inline
                                    .filter((item) => !item.in_reply_to_id)
                                    .map((item) => ({
                                        id: `thread-${item.id}`,
                                        isResolved: resolved.has(
                                            `thread-${item.id}`
                                        ),
                                        comments: {
                                            nodes: inline
                                                .filter(
                                                    (comment) =>
                                                        comment.id ===
                                                            item.id ||
                                                        comment.in_reply_to_id ===
                                                            item.id
                                                )
                                                .map((comment) => ({
                                                    databaseId: comment.id
                                                })),
                                            pageInfo: { hasNextPage: false }
                                        }
                                    })),
                                pageInfo: { hasNextPage: false }
                            }
                        }
                    }
                }
            };
        } else if (route === `${prefix}/pulls/${input.pr}`) response = pull;
        else if (route === `${prefix}/pulls/${input.pr}/comments`)
            response = inline;
        else if (/\/pulls\/\d+\/comments\/\d+\/replies$/.test(route)) {
            assert.equal(options.method, "POST");
            const parent = Number(route.split("/").at(-2));
            assert.ok(
                inline.some(
                    (item) => item.id === parent && !item.in_reply_to_id
                )
            );
            response = {
                id: nextId++,
                user: bot,
                in_reply_to_id: parent,
                body: body.body,
                html_url: `${url}#discussion_r${nextId - 1}`
            };
            inline.push(response);
        } else if (/\/issues\/comments\/[0-9]+$/.test(route)) {
            const item = comments.find(
                (comment) => comment.id === Number(route.split("/").at(-1))
            );
            assert.ok(item);
            if (options.method === "PATCH") item.body = body.body;
            response = item;
        } else if (/\/reviews\/[0-9]+$/.test(route)) {
            const item = reviews.find(
                (entry) => entry.id === Number(route.split("/").at(-1))
            );
            assert.ok(item);
            if (options.method === "PUT") item.body = body.body;
            response = item;
        } else if (
            route === `${prefix}/issues/${input.pr}/comments` ||
            route === `${prefix}/pulls/${input.pr}/reviews`
        ) {
            const collection = route.includes("/issues/") ? comments : reviews;
            if (options.method === "POST") {
                const id = nextId++;
                const item = {
                    id,
                    user: bot,
                    body: body.body,
                    html_url: `${url}#${collection === comments ? "issuecomment-" : "pullrequestreview-"}${id}`,
                    issue_url: `https://api.github.com${prefix}/issues/${input.pr}`
                };
                collection.push(item);
                for (const finding of body.comments || [])
                    inline.push({
                        ...finding,
                        id: nextId++,
                        user: bot,
                        pull_request_review_id: id,
                        html_url: `${url}#discussion_r${nextId - 1}`
                    });
                response = item;
            } else response = collection;
        } else
            throw new Error(
                `Unexpected recorded route ${options.method} ${route}`
            );
        return new Response(JSON.stringify(response), { status: 200 });
    }
    return {
        input,
        finding,
        reviews,
        comments,
        inline,
        calls,
        exchange,
        pull,
        resolved
    };
}

module.exports = { wireFixture };
