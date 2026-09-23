const { performance } = require("node:perf_hooks");
const { check, digest } = require("./data");
const { ReviewError } = require("./errors");
const { DEFAULTS } = require("./config");
// Worker memory kept for conditional GitHub reads, oldest pages evicted first.
const CONDITIONAL_CACHE_BYTES = 64 * 1024 * 1024;
class PublicAccounting {
    requests = 0;
    bytes = 0;
    pages = 0;
    fallbackBlockMs;
    throttles = 0;
    lastThrottle = null;
    // Public origins map to advertised or fallback retry timestamps in milliseconds.
    blockedUntil = new Map();
    // Read-only GitHub token sent to api.github.com only; null reads anonymously.
    token;
    // Canonical API URL -> last full response (body, etag, headers). A 304 to an
    // If-None-Match reuses it and, when authenticated, costs no GitHub quota.
    conditional = new Map();
    conditionalBytes = 0;
    constructor(limits = DEFAULTS, token = null) {
        this.fallbackBlockMs = limits.throttleFallbackMs;
        this.token = token || null;
    }
    remember(url, body, headers) {
        this.forget(url);
        const size = Buffer.byteLength(body);
        if (size > CONDITIONAL_CACHE_BYTES) return;
        this.conditional.set(url, {
            body,
            size,
            headers: new Headers(headers)
        });
        this.conditionalBytes += size;
        for (const [oldest, entry] of this.conditional) {
            if (this.conditionalBytes <= CONDITIONAL_CACHE_BYTES) break;
            this.conditional.delete(oldest);
            this.conditionalBytes -= entry.size;
        }
    }
    forget(url) {
        const entry = this.conditional.get(url);
        if (!entry) return;
        this.conditional.delete(url);
        this.conditionalBytes -= entry.size;
    }
    beforeRequest(url) {
        const origin = new URL(url).origin;
        if ((this.blockedUntil.get(origin) || 0) > Date.now())
            throw new ReviewError("CONTEXT_RATE_LIMITED");
        this.requests++;
    }
    addBytes(count) {
        this.bytes += count;
    }
    observe(url, response) {
        if (
            response.status !== 429 &&
            response.headers.get("x-ratelimit-remaining") !== "0"
        )
            return;
        const retry = response.headers.get("retry-after");
        const advertised = retry
            ? /^[0-9]+$/.test(retry)
                ? Date.now() + Number(retry) * 1000
                : Date.parse(retry)
            : Number(response.headers.get("x-ratelimit-reset")) * 1000;
        const now = Date.now();
        const advertisedReset = Number.isFinite(advertised) && advertised > now;
        const origin = new URL(url).origin;
        const until = advertisedReset ? advertised : now + this.fallbackBlockMs;
        this.blockedUntil.set(
            origin,
            Math.max(this.blockedUntil.get(origin) || 0, until)
        );
        this.throttles++;
        this.lastThrottle = {
            origin,
            status: response.status,
            reason: advertisedReset
                ? "advertised-reset"
                : "context-window-fallback",
            blockedUntil: this.blockedUntil.get(origin)
        };
        console.warn(
            JSON.stringify({
                event: "review-public-throttle",
                throttles: this.throttles,
                ...this.lastThrottle
            })
        );
    }
}
class ContextBudget {
    limits;
    started = performance.now();
    requests = 0;
    pages = 0;
    bytes = 0;
    sources = [];
    cacheHits = 0;
    shared;
    // Only bounded maintenance passes supply a deadline; review owns its timeout.
    deadlineMs;
    constructor(limits, shared = null, deadlineMs = Infinity) {
        this.limits = limits;
        this.shared = shared;
        this.deadlineMs = deadlineMs;
    }
    remaining() {
        return Math.max(
            0,
            this.deadlineMs - (performance.now() - this.started)
        );
    }
    beforeRequest(url) {
        if (
            (this.limits.contextRequests > 0 &&
                this.requests >= this.limits.contextRequests) ||
            (this.limits.contextPages > 0 &&
                this.pages >= this.limits.contextPages) ||
            this.remaining() <= 0
        )
            throw new ReviewError("CONTEXT_BUDGET_EXCEEDED");
        this.shared?.beforeRequest(url);
        this.requests++;
    }
    addBytes(bytes) {
        this.shared?.addBytes(bytes);
        this.bytes += bytes;
        if (
            this.limits.contextBytes > 0 &&
            this.bytes > this.limits.contextBytes
        )
            throw new ReviewError("CONTEXT_BUDGET_EXCEEDED");
    }
    record(url, body, headers, data, next) {
        this.pages++;
        if (this.shared) this.shared.pages++;
        let semantic = body;
        if (
            data &&
            !Array.isArray(data) &&
            data.base &&
            /\/pulls\/[1-9][0-9]*$/.test(new URL(url).pathname)
        ) {
            const context = structuredClone(data);
            delete context.base.sha;
            semantic = context;
        }
        this.sources.push({
            url,
            revision: digest(body),
            contextRevision: digest(semantic),
            page:
                new URL(url).searchParams.get("page") ||
                new URL(url).searchParams.get("cursor") ||
                "1",
            next,
            loaded: data?.html === undefined ? "data" : "unknown",
            etag: headers.get("etag"),
            modified: headers.get("last-modified")
        });
    }
    identity() {
        return digest(
            [
                ...new Map(
                    this.sources.map(({ url, contextRevision }) => [
                        url,
                        { url, revision: contextRevision }
                    ])
                ).values()
            ].sort((a, b) => a.url.localeCompare(b.url))
        );
    }
}
function publicUrl(value) {
    try {
        return new URL(value);
    } catch {
        throw new ReviewError("CONTEXT_UNAVAILABLE");
    }
}
function permittedUrl(value, repository, pr = null, head = null) {
    const url = publicUrl(value);
    check(
        url.protocol === "https:" &&
            !url.username &&
            !url.password &&
            !url.port &&
            !url.hash,
        "CONTEXT_UNAVAILABLE"
    );
    const prefix =
        url.hostname === "api.github.com"
            ? `/repos/${repository}/`
            : url.hostname === "github.com"
              ? `/${repository}/`
              : null;
    check(prefix && url.pathname.startsWith(prefix), "CONTEXT_UNAVAILABLE");
    const suffix = url.pathname.slice(prefix.length);
    if (suffix === "actions/runs") {
        check(
            pr !== null &&
                url.hostname === "api.github.com" &&
                /^[a-f0-9]{40}$/.test(head || "") &&
                url.searchParams.getAll("head_sha").length === 1 &&
                url.searchParams.get("head_sha") === head &&
                [...url.searchParams.keys()].every((key) =>
                    ["head_sha", "page", "per_page"].includes(key)
                ),
            "CONTEXT_UNAVAILABLE"
        );
        return url;
    }
    const patterns =
        pr === null
            ? [/^pulls(?:\/[1-9][0-9]*)?$/]
            : [
                  new RegExp(
                      `^pulls/${pr}(?:/(?:comments|reviews|files|commits))?$`
                  ),
                  new RegExp(`^issues/${pr}/comments$`),
                  new RegExp(
                      `^pull/${pr}(?:/(?:files|commits|conversation|review|reviews|show_partial|timeline))?$`
                  )
              ];
    if (pr !== null && url.hostname === "api.github.com") {
        patterns.push(new RegExp(`^issues/${pr}/timeline$`));
        if (/^[a-f0-9]{40}$/.test(head || ""))
            patterns.push(
                new RegExp(`^commits/${head}/(?:check-runs|status)$`)
            );
    }
    check(
        patterns.some((pattern) => pattern.test(suffix)),
        "CONTEXT_UNAVAILABLE"
    );
    check(
        [...url.searchParams.keys()].every((key) =>
            [
                "page",
                "per_page",
                "state",
                "sort",
                "direction",
                "after",
                "before",
                "cursor"
            ].includes(key)
        ),
        "CONTEXT_UNAVAILABLE"
    );
    return url;
}
function decodePage(url, body, contentType, repository, pr, head = null) {
    const pathname = new URL(url).pathname;
    const commitEvidence = /\/commits\/[^/]+\/(?:check-runs|status)$/.test(
        pathname
    );
    const timeline = pathname === `/repos/${repository}/issues/${pr}/timeline`;
    const workflowRuns = pathname === `/repos/${repository}/actions/runs`;
    if (commitEvidence || timeline || workflowRuns) {
        permittedUrl(url, repository, pr, head);
        check(contentType.includes("json"), "CONTEXT_UNAVAILABLE");
    }
    if (contentType.includes("json")) {
        let value;
        try {
            value = JSON.parse(body);
        } catch {
            throw new ReviewError("CONTEXT_UNAVAILABLE");
        }
        if (timeline) {
            check(
                Array.isArray(value) &&
                    value.every(
                        (event) =>
                            event &&
                            typeof event === "object" &&
                            typeof event.event === "string" &&
                            event.event.length > 0
                    ),
                "CONTEXT_UNAVAILABLE"
            );
            return value;
        }
        if (commitEvidence || workflowRuns) {
            const checks = pathname.endsWith("/check-runs");
            const entries = workflowRuns
                ? value?.workflow_runs
                : checks
                  ? value?.check_runs
                  : value?.statuses;
            check(
                value &&
                    !Array.isArray(value) &&
                    Number.isSafeInteger(value.total_count) &&
                    Array.isArray(entries) &&
                    value.total_count >= entries.length,
                "CONTEXT_UNAVAILABLE"
            );
            if (workflowRuns) {
                check(
                    entries.every(
                        (run) =>
                            run &&
                            Number.isSafeInteger(run.id) &&
                            run.id > 0 &&
                            run.head_sha === head &&
                            run.repository?.full_name === repository &&
                            typeof run.status === "string" &&
                            run.status.length > 0 &&
                            (run.conclusion === null ||
                                typeof run.conclusion === "string")
                    ),
                    "CONTEXT_UNAVAILABLE"
                );
            } else if (checks) {
                check(
                    entries.every(
                        (run) =>
                            run &&
                            Number.isSafeInteger(run.id) &&
                            run.id > 0 &&
                            run.head_sha === head &&
                            typeof run.name === "string" &&
                            typeof run.status === "string" &&
                            run.status.length > 0 &&
                            (run.conclusion === null ||
                                typeof run.conclusion === "string")
                    ),
                    "CONTEXT_UNAVAILABLE"
                );
            } else {
                const states = ["error", "failure", "pending", "success"];
                check(
                    value.sha === head &&
                        value.repository?.full_name === repository &&
                        states.includes(value.state) &&
                        entries.every(
                            (status) =>
                                status &&
                                Number.isSafeInteger(status.id) &&
                                status.id > 0 &&
                                typeof status.context === "string" &&
                                states.includes(status.state)
                        ),
                    "CONTEXT_UNAVAILABLE"
                );
            }
            return value;
        }
        check(
            Array.isArray(value) ||
                (value &&
                    typeof value === "object" &&
                    (pr === null
                        ? Number.isSafeInteger(value.number)
                        : value.number === pr)),
            "CONTEXT_UNAVAILABLE"
        );
        if (!Array.isArray(value))
            check(
                value.base?.repo?.full_name === repository,
                "CONTEXT_UNAVAILABLE"
            );
        return value;
    }
    const identity = `/${repository}/pull/${pr}`;
    const htmlHead =
        body.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i)?.[1] || "";
    const canonical = [...htmlHead.matchAll(/<link\b[^>]*>/gi)].some(
        ([tag]) =>
            /\brel=["']canonical["']/i.test(tag) &&
            tag.includes(`href="https://github.com${identity}"`)
    );
    check(
        canonical &&
            /(?:id="discussion_bucket"|id="issuecomment-[0-9]+"|data-discussion-hovercard-type="pull_request")/.test(
                body
            ),
        "CONTEXT_UNAVAILABLE"
    );
    // HTML is context, not authenticated author/resolution evidence.
    return {
        html: body,
        structuralIdentity: identity,
        resolution: "unavailable"
    };
}
class PublicGitHub {
    // Source IDs map to canonical revisions of discussion actually read by this turn.
    revisions = new Map();
    // IDs of substantive non-reviewer discussion items actually retrieved.
    requiredDiscussion = new Set();
    repository;
    repositoryId;
    pr;
    head;
    budget;
    exchange;
    resolvedComments;
    // Canonical permitted URLs whose latest attempted read has not succeeded.
    unavailable = new Set();
    controller = new AbortController();
    constructor(
        repository,
        pr,
        budget,
        exchange = fetch,
        head = null,
        resolvedThreads = []
    ) {
        this.resolvedComments = new Set(
            resolvedThreads.flatMap((thread) => thread.comments)
        );
        this.repository =
            typeof repository === "string" ? repository : repository.name;
        this.repositoryId =
            typeof repository === "string" ? null : repository.id;
        this.pr = pr;
        check(head === null || /^[a-f0-9]{40}$/.test(head), "INVALID_REQUEST");
        this.head = head;
        this.budget = budget;
        this.exchange = exchange;
    }
    permitted(input) {
        const url = publicUrl(input);
        if (
            this.repositoryId &&
            url.hostname === "api.github.com" &&
            url.pathname.startsWith(`/repositories/${this.repositoryId}/`)
        )
            url.pathname = url.pathname.replace(
                `/repositories/${this.repositoryId}/`,
                `/repos/${this.repository}/`
            );
        return permittedUrl(url.href, this.repository, this.pr, this.head);
    }
    async read(input) {
        let url = this.permitted(input).href;
        // A PR browser link names the same resource as the structured API route.
        // Do not depend on GitHub's changing HTML shell for this read.
        if (url === `https://github.com/${this.repository}/pull/${this.pr}`)
            url = `https://api.github.com/repos/${this.repository}/pulls/${this.pr}`;
        const browser = new URL(url);
        if (
            browser.hostname === "github.com" &&
            browser.pathname === `/${this.repository}/pull/${this.pr}/files`
        ) {
            url = `https://api.github.com/repos/${this.repository}/pulls/${this.pr}/files?per_page=100`;
            const page = browser.searchParams.get("page");
            if (page) url += `&page=${encodeURIComponent(page)}`;
        }
        try {
            const page = await this.readWithinBudget(url);
            this.unavailable.delete(url);
            return page;
        } catch (error) {
            this.unavailable.add(url);
            if (error?.name === "TimeoutError" || error?.name === "AbortError")
                throw new ReviewError(
                    this.budget.remaining() <= 0
                        ? "CONTEXT_BUDGET_EXCEEDED"
                        : "CONTEXT_UNAVAILABLE"
                );
            throw error;
        }
    }
    async readWithinBudget(input) {
        let url = this.permitted(input);
        for (let redirects = 0; redirects <= 3; redirects++) {
            this.budget.beforeRequest(url);
            const api = url.hostname === "api.github.com";
            const shared = this.budget.shared;
            const cached = api ? shared?.conditional.get(url.href) : undefined;
            const response = await this.exchange(url, {
                method: "GET",
                redirect: "manual",
                headers: {
                    Accept: api ? "application/vnd.github+json" : "text/html",
                    "User-Agent": "peer3-review-service",
                    // The token never leaves api.github.com, even on redirect.
                    ...(api && shared?.token
                        ? { Authorization: `Bearer ${shared.token}` }
                        : {}),
                    ...(cached
                        ? { "If-None-Match": cached.headers.get("etag") }
                        : {})
                },
                signal: AbortSignal.any([
                    this.controller.signal,
                    AbortSignal.timeout(
                        Math.max(
                            1,
                            Math.ceil(Math.min(30000, this.budget.remaining()))
                        )
                    )
                ])
            });
            this.budget.shared?.observe(url, response);
            let body, headers;
            if (response.status === 304 && cached) {
                // Unchanged since the remembered read: reuse its body and headers.
                await response.body?.cancel();
                this.budget.cacheHits++;
                ({ body, headers } = cached);
            } else if (response.status >= 300 && response.status < 400) {
                check(response.headers.get("location"), "CONTEXT_UNAVAILABLE");
                url = this.permitted(
                    new URL(response.headers.get("location"), url).href
                );
                await response.body?.cancel();
                continue;
            } else {
                if (
                    response.status === 429 ||
                    (response.status === 403 &&
                        response.headers.get("x-ratelimit-remaining") === "0")
                ) {
                    await response.body?.cancel();
                    throw new ReviewError("CONTEXT_RATE_LIMITED");
                }
                if (!response.ok) {
                    await response.body?.cancel();
                    throw new ReviewError("CONTEXT_UNAVAILABLE");
                }
                const chunks = [];
                for await (const chunk of response.body) {
                    this.budget.addBytes(chunk.length);
                    chunks.push(Buffer.from(chunk));
                }
                body = Buffer.concat(chunks).toString("utf8");
                headers = response.headers;
                if (api && headers.get("etag"))
                    shared?.remember(url.href, body, headers);
            }
            let data = decodePage(
                url.href,
                body,
                headers.get("content-type") || "",
                this.repository,
                this.pr,
                this.head
            );
            let next =
                headers.get("link")?.match(/<([^>]+)>;\s*rel="next"/)?.[1] ||
                null;
            if (next) next = this.permitted(next).href;
            this.budget.record(url.href, body, headers, data, next);
            const kind = url.pathname.endsWith(`/issues/${this.pr}/comments`)
                ? "comment"
                : url.pathname.endsWith(`/pulls/${this.pr}/comments`)
                  ? "inline"
                  : url.pathname.endsWith(`/pulls/${this.pr}/reviews`)
                    ? "review"
                    : null;
            if (kind === "inline" && Array.isArray(data))
                data = data.filter(
                    (item) => !this.resolvedComments.has(item.id)
                );
            if (kind && Array.isArray(data))
                for (const item of data) {
                    this.revisions.set(
                        `${kind}:${item.id}`,
                        require("./reconcile").sourceRevision(item)
                    );
                    if (
                        item.body?.trim() &&
                        !(
                            item.user?.type === "Bot" &&
                            item.user?.login === "github-actions[bot]"
                        )
                    )
                        this.requiredDiscussion.add(`${kind}:${item.id}`);
                    else this.requiredDiscussion.delete(`${kind}:${item.id}`);
                }
            const publicData = require("./state").publicContext(data);
            for (const item of Array.isArray(publicData)
                ? publicData
                : [publicData])
                for (const finding of item?.reviewFindings || [])
                    this.revisions.set(
                        finding.sourceId,
                        finding.sourceRevision
                    );
            return {
                data: publicData,
                next,
                source: this.budget.sources.at(-1),
                threadResolution: {
                    status: "unknown",
                    guidance:
                        "Public reads do not establish resolved/unresolved thread state. Do not infer it. This alone does not make source/discussion coverage incomplete: record it in coverage.verificationMissing and return recommendation comment. The publisher checks current thread state before any resolution action. Missing source, comments, replies or pagination still blocks completion."
                }
            };
        }
        throw new ReviewError("CONTEXT_UNAVAILABLE");
    }
    abort() {
        this.controller.abort();
    }
    async pages(input) {
        const data = [];
        let next = input;
        while (next) {
            const page = await this.read(next);
            check(Array.isArray(page.data), "CONTEXT_UNAVAILABLE");
            data.push(...page.data);
            next = page.next;
        }
        return data;
    }
    gathered() {
        const required = [
            `/repos/${this.repository}/pulls/${this.pr}`,
            `/repos/${this.repository}/issues/${this.pr}/comments`,
            `/repos/${this.repository}/pulls/${this.pr}/comments`,
            `/repos/${this.repository}/pulls/${this.pr}/reviews`
        ];
        return (
            this.unavailable.size === 0 &&
            required.every((route) =>
                this.budget.sources.some((source) => {
                    const url = new URL(source.url);
                    return (
                        url.pathname === route &&
                        (!url.searchParams.has("page") ||
                            url.searchParams.get("page") === "1")
                    );
                })
            ) &&
            this.budget.sources.every(
                (source) =>
                    source.loaded === "data" &&
                    (!source.next ||
                        this.budget.sources.some(
                            (other) => other.url === source.next
                        ))
            )
        );
    }
    async fresh(sources) {
        sources = [
            ...new Map(sources.map((source) => [source.url, source])).values()
        ];
        for (const source of sources) {
            const page = await this.read(source.url);
            if (page.source.contextRevision !== source.contextRevision)
                return false;
            // Changed page membership is covered by the response body and next link.
            if (
                page.next &&
                !sources.some((candidate) => candidate.url === page.next)
            )
                return false;
        }
        return sources.length > 0;
    }
}
module.exports = {
    PublicAccounting,
    ContextBudget,
    PublicGitHub,
    permittedUrl,
    decodePage
};
