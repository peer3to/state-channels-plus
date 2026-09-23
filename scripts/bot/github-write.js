const { check } = require("./data");
const { ReviewError } = require("./errors");
// CI owns mutations. The service, review request client and model tools must never
// import this module. The assessment fetch CLI uses a GET/query-only transport.
// Preflight pagination and batched review publication are ported from the manual
// publisher identified in skill/provenance.json; this port has independent upkeep.
async function boundedJson(response) {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
        size += chunk.length;
        check(size <= 8 * 1024 * 1024, "CONTEXT_BUDGET_EXCEEDED");
        chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
async function actionsBotId(token, exchange = fetch) {
    check(typeof token === "string" && token.length > 0, "UNAUTHORIZED");
    const response = await exchange(
        "https://api.github.com/users/github-actions%5Bbot%5D",
        {
            method: "GET",
            redirect: "error",
            signal: AbortSignal.timeout(30000),
            headers: {
                Authorization: `Bearer ${token}`,
                Accept: "application/vnd.github+json",
                "X-GitHub-Api-Version": "2022-11-28"
            }
        }
    );
    check(response.ok, "CONTEXT_UNAVAILABLE");
    const actor = await boundedJson(response);
    check(
        actor.login === "github-actions[bot]" &&
            actor.type === "Bot" &&
            Number.isSafeInteger(actor.id) &&
            actor.id > 0,
        "UNAUTHORIZED"
    );
    return actor.id;
}
class GitHubWriter {
    request;
    token;
    botId;
    exchange;
    calls = 0;
    maxCalls;
    wait;
    constructor(
        request,
        {
            token,
            botId,
            exchange = fetch,
            maxCalls = Infinity,
            wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
        }
    ) {
        check(
            typeof token === "string" &&
                token.length > 0 &&
                Number.isSafeInteger(botId) &&
                botId > 0
        );
        this.request = request;
        this.token = token;
        this.botId = botId;
        this.exchange = exchange;
        this.maxCalls = maxCalls;
        this.wait = wait;
    }
    async readResponse(url, options) {
        // Retry reads only. A lost mutation reply must be reconciled by markers
        // before another write; blindly retrying POST can duplicate findings.
        const read =
            options.method === "GET" ||
            (url.endsWith("/graphql") &&
                /^\s*query\b/.test(JSON.parse(options.body).query));
        for (let attempt = 0; ; attempt++) {
            try {
                const response = await this.exchange(url, options);
                if (
                    !read ||
                    attempt === 2 ||
                    ![429, 500, 502, 503, 504].includes(response.status)
                )
                    return response;
                await response.body?.cancel();
            } catch (error) {
                if (!read || attempt === 2) throw error;
            }
            await this.wait(1000 * 2 ** attempt);
            options = { ...options, signal: AbortSignal.timeout(30000) };
        }
    }
    async api(suffix, { method = "GET", body, allowMissing = false } = {}) {
        check(
            (method === "GET" &&
                (/^\/actions\/workflows\/(?:ci|review)\.yml\/runs\?event=pull_request&head_sha=[a-f0-9]{40}&per_page=100&page=[1-9][0-9]*$/.test(
                    suffix
                ) ||
                    /^\/actions\/runs\/[1-9][0-9]*\/jobs\?filter=latest&per_page=100&page=[1-9][0-9]*$/.test(
                        suffix
                    ))) ||
                /^\/(?:pulls|issues)\/[1-9][0-9]*(?:\/(?:comments|reviews)(?:\/[1-9][0-9]*(?:\/(?:dismissals|replies))?)?)?(?:\?per_page=100&page=[1-9][0-9]*)?$/.test(
                    suffix
                ) ||
                /^\/issues\/comments\/[1-9][0-9]*$/.test(suffix) ||
                /^\/collaborators\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/permission$/.test(
                    suffix
                ) ||
                /^\/actions\/artifacts\/[1-9][0-9]*$/.test(suffix) ||
                /^\/actions\/runs\/[1-9][0-9]*\/attempts\/[1-9][0-9]*\/jobs\?per_page=100&page=[1-9][0-9]*$/.test(
                    suffix
                )
        );
        check(["GET", "POST", "PUT", "PATCH"].includes(method));
        check(++this.calls <= this.maxCalls, "CONTEXT_BUDGET_EXCEEDED");
        const response = await this.readResponse(
            `https://api.github.com/repos/${this.request.repository.name}${suffix}`,
            {
                method,
                redirect: "error",
                signal: AbortSignal.timeout(30000),
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    Accept: "application/vnd.github+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                    "Content-Type": "application/json"
                },
                ...(body === undefined ? {} : { body: JSON.stringify(body) })
            }
        );
        if (allowMissing && response.status === 404) {
            await response.body?.cancel();
            return null;
        }
        if (!response.ok) {
            const error = new ReviewError(
                response.status === 429 ||
                (response.status === 403 &&
                    response.headers.get("x-ratelimit-remaining") === "0")
                    ? "CONTEXT_RATE_LIMITED"
                    : "CONTEXT_UNAVAILABLE"
            );
            error.diagnostics = {
                operation: `${method} ${suffix}`,
                status: response.status,
                requestId: response.headers.get("x-github-request-id")
            };
            await response.body?.cancel();
            throw error;
        }
        return boundedJson(response);
    }
    async pages(suffix) {
        const all = [];
        for (let page = 1; ; page++) {
            const data = await this.api(`${suffix}?per_page=100&page=${page}`);
            check(Array.isArray(data), "CONTEXT_UNAVAILABLE");
            all.push(...data);
            if (data.length < 100) return all;
        }
    }
    async graph(query, variables) {
        check(++this.calls <= this.maxCalls, "CONTEXT_BUDGET_EXCEEDED");
        const response = await this.readResponse(
            "https://api.github.com/graphql",
            {
                method: "POST",
                redirect: "error",
                signal: AbortSignal.timeout(30000),
                headers: {
                    Authorization: `Bearer ${this.token}`,
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({ query, variables })
            }
        );
        if (!response.ok) {
            const error = new ReviewError("CONTEXT_UNAVAILABLE");
            error.diagnostics = {
                operation: "POST /graphql",
                status: response.status,
                requestId: response.headers.get("x-github-request-id")
            };
            await response.body?.cancel();
            throw error;
        }
        const parsed = await boundedJson(response);
        if (parsed.errors || !parsed.data) {
            const error = new ReviewError("CONTEXT_UNAVAILABLE");
            error.diagnostics = {
                operation: "POST /graphql",
                status: response.status,
                types: (parsed.errors || []).map(
                    (item) => item.type || item.extensions?.code || "unknown"
                )
            };
            throw error;
        }
        return parsed.data;
    }
    async threads({ idsOnly = false } = {}) {
        const commentFields = idsOnly
            ? "id databaseId"
            : "id databaseId body author { __typename login }";
        const [owner, name] = this.request.repository.name.split("/");
        const threads = [];
        let cursor = null;
        do {
            const data = await this.graph(
                `query ReviewThreads($owner:String!,$name:String!,$pr:Int!,$cursor:String) {
                repository(owner:$owner,name:$name) { databaseId pullRequest(number:$pr) { number reviewThreads(first:100,after:$cursor) {
                    nodes { id isResolved comments(first:100) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } } }
                    pageInfo { hasNextPage endCursor }
                } } }
            }`,
                { owner, name, pr: this.request.pr, cursor }
            );
            check(
                data.repository?.databaseId === this.request.repository.id &&
                    data.repository.pullRequest?.number === this.request.pr,
                "CONTEXT_UNAVAILABLE"
            );
            const page = data.repository.pullRequest.reviewThreads;
            check(
                Array.isArray(page?.nodes) &&
                    typeof page.pageInfo?.hasNextPage === "boolean",
                "CONTEXT_UNAVAILABLE"
            );
            for (const thread of page.nodes) {
                check(
                    typeof thread.id === "string" &&
                        typeof thread.isResolved === "boolean" &&
                        Array.isArray(thread.comments?.nodes),
                    "CONTEXT_UNAVAILABLE"
                );
                let next = thread.comments.pageInfo;
                while (next.hasNextPage) {
                    check(
                        typeof next.endCursor === "string" &&
                            next.endCursor.length > 0,
                        "CONTEXT_UNAVAILABLE"
                    );
                    const more = await this.graph(
                        `query ReviewReplies($id:ID!,$cursor:String!) { node(id:$id) { ... on PullRequestReviewThread { id comments(first:100,after:$cursor) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } } } } }`,
                        { id: thread.id, cursor: next.endCursor }
                    );
                    check(
                        more.node?.id === thread.id &&
                            Array.isArray(more.node.comments?.nodes),
                        "CONTEXT_UNAVAILABLE"
                    );
                    thread.comments.nodes.push(...more.node.comments.nodes);
                    next = more.node.comments.pageInfo;
                }
                threads.push(thread);
            }
            check(
                !page.pageInfo.hasNextPage ||
                    (typeof page.pageInfo.endCursor === "string" &&
                        page.pageInfo.endCursor !== cursor),
                "CONTEXT_UNAVAILABLE"
            );
            cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
        } while (cursor);
        return threads;
    }
    async setResolved(thread, resolved, observations, decisions) {
        const known = observations.threads.find(
            (item) => item.id === thread.id
        );
        check(
            known &&
                (observations.inline.some(
                    (comment) =>
                        comment.user?.id === this.botId &&
                        comment.user.type === "Bot" &&
                        known.comments.nodes[0]?.databaseId === comment.id
                ) ||
                    (resolved &&
                        decisions &&
                        require("./review-decisions").threadSettled(
                            known,
                            observations,
                            decisions,
                            this.botId
                        ))),
            "UNAUTHORIZED"
        );
        if (known.isResolved === resolved)
            return { id: thread.id, unchanged: true };
        const operation = resolved
            ? "resolveReviewThread"
            : "unresolveReviewThread";
        const result = await this.graph(
            `mutation ReviewResolution($id:ID!) { ${operation}(input:{threadId:$id}) { thread { id isResolved } } }`,
            { id: thread.id }
        );
        check(
            result[operation]?.thread?.id === thread.id &&
                result[operation].thread.isResolved === resolved,
            "CONTEXT_UNAVAILABLE"
        );
        return result;
    }
    async observe() {
        const pr = this.request.pr;
        const pull = await this.api(`/pulls/${pr}`);
        check(
            pull.number === pr &&
                pull.base?.repo?.id === this.request.repository.id,
            "CONTEXT_UNAVAILABLE"
        );
        check(pull.head?.sha === this.request.head, "STALE_HEAD");
        const [inline, comments, reviews] = await Promise.all([
            this.pages(`/pulls/${pr}/comments`),
            this.pages(`/issues/${pr}/comments`),
            this.pages(`/pulls/${pr}/reviews`)
        ]);
        const threads = await this.threads();
        return {
            pull,
            inline,
            comments,
            reviews,
            threads,
            findings: [],
            authorId: pull.user.id
        };
    }
    async comment(body) {
        check(
            typeof body === "string" && body.length <= 65536,
            "INVALID_RESULT"
        );
        return this.api(`/issues/${this.request.pr}/comments`, {
            method: "POST",
            body: { body }
        });
    }
    async editGeneral(source, body) {
        check(
            source && ["comment", "review"].includes(source.kind),
            "INVALID_RESULT"
        );
        check(
            source.item.user?.id === this.botId &&
                source.item.user.type === "Bot",
            "UNAUTHORIZED"
        );
        check(
            typeof body === "string" && body.length <= 65536,
            "INVALID_RESULT"
        );
        const route =
            source.kind === "comment"
                ? `/issues/comments/${source.item.id}`
                : `/pulls/${this.request.pr}/reviews/${source.item.id}`;
        const fresh = await this.api(route);
        check(
            fresh.id === source.item.id &&
                fresh.user?.id === this.botId &&
                fresh.user.type === "Bot",
            "UNAUTHORIZED"
        );
        check(fresh.body === source.item.body, "CONTEXT_UNAVAILABLE");
        if (source.kind === "comment")
            check(
                fresh.issue_url ===
                    `https://api.github.com/repos/${this.request.repository.name}/issues/${this.request.pr}`,
                "UNAUTHORIZED"
            );
        return this.api(route, {
            method: source.kind === "comment" ? "PATCH" : "PUT",
            body: { body }
        });
    }
    async reply(thread, body, observations) {
        check(
            typeof body === "string" && body.length <= 65536,
            "INVALID_RESULT"
        );
        const known = observations.threads.find(
            (entry) => entry.id === thread.id
        );
        const root =
            known &&
            observations.inline.find(
                (comment) =>
                    comment.user?.id === this.botId &&
                    comment.user.type === "Bot" &&
                    known.comments.nodes[0]?.databaseId === comment.id
            );
        check(root && Number.isSafeInteger(root.id), "UNAUTHORIZED");
        return this.api(
            `/pulls/${this.request.pr}/comments/${root.id}/replies`,
            { method: "POST", body: { body } }
        );
    }
    async batch(findings, body) {
        check(
            typeof body === "string" &&
                body.length <= 65536 &&
                findings.every((finding) => finding.body.length <= 65536),
            "INVALID_RESULT"
        );
        return this.api(`/pulls/${this.request.pr}/reviews`, {
            method: "POST",
            body: {
                commit_id: this.request.head,
                event: "COMMENT",
                body,
                comments: findings
                    .filter((finding) => finding.path !== null)
                    .map((finding) => ({
                        path: finding.path,
                        line: finding.line,
                        side: "RIGHT",
                        body: finding.body
                    }))
            }
        });
    }
    async approve(body) {
        return this.api(`/pulls/${this.request.pr}/reviews`, {
            method: "POST",
            body: { commit_id: this.request.head, event: "APPROVE", body }
        });
    }
    async dismissOwnStale(review) {
        check(
            review.user?.id === this.botId &&
                review.user.type === "Bot" &&
                review.state === "APPROVED" &&
                review.commit_id !== this.request.head
        );
        return this.api(
            `/pulls/${this.request.pr}/reviews/${review.id}/dismissals`,
            {
                method: "PUT",
                body: {
                    message: "Review head changed. Human review still required."
                }
            }
        );
    }
}
module.exports = { GitHubWriter, actionsBotId };
