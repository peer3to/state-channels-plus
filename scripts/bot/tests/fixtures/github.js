const assert = require("node:assert/strict");
// Recorded GitHub wire responses exercise the real read/write owners. They do not
// prove live API permissions or actual publication.
class RecordedGitHub {
    records;
    requests = [];
    constructor(records) {
        this.records = [...records];
    }
    async exchange(url, options) {
        const expected = this.records.shift();
        assert.ok(expected, `Unexpected request ${options.method} ${url}`);
        assert.equal(options.method, expected.method || "GET");
        assert.equal(
            new URL(url).pathname + new URL(url).search,
            expected.path
        );
        const body = options.body ? JSON.parse(options.body) : null;
        expected.inspect?.(body);
        this.requests.push({
            url,
            method: options.method,
            body,
            headers: options.headers || {}
        });
        return new Response(
            [204, 304].includes(expected.status)
                ? null
                : (expected.rawBody ?? JSON.stringify(expected.response)),
            {
                status: expected.status || 200,
                headers: {
                    "content-type": "application/json",
                    ...expected.headers
                }
            }
        );
    }
    done() {
        assert.equal(this.records.length, 0, "Unused recorded responses");
    }
}
function observation(request, comments = [], reviews = []) {
    const prefix = `/repos/${request.repository.name}`;
    return [
        {
            path: `${prefix}/pulls/${request.pr}`,
            response: {
                number: request.pr,
                base: { repo: { id: request.repository.id } },
                head: { sha: request.head },
                state: "open",
                draft: false,
                user: { id: 7, login: "author", type: "User" }
            }
        },
        {
            path: `${prefix}/pulls/${request.pr}/comments?per_page=100&page=1`,
            response: []
        },
        {
            path: `${prefix}/issues/${request.pr}/comments?per_page=100&page=1`,
            response: comments
        },
        {
            path: `${prefix}/pulls/${request.pr}/reviews?per_page=100&page=1`,
            response: reviews
        },
        {
            path: "/graphql",
            method: "POST",
            response: {
                data: {
                    repository: {
                        databaseId: request.repository.id,
                        pullRequest: {
                            number: request.pr,
                            reviewThreads: {
                                nodes: [],
                                pageInfo: {
                                    hasNextPage: false,
                                    endCursor: null
                                }
                            }
                        }
                    }
                }
            }
        }
    ];
}
module.exports = { RecordedGitHub, observation };
