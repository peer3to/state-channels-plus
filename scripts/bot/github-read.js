const { performance } = require("node:perf_hooks");
const { check, digest } = require("./data");
const { ReviewError } = require("./errors");
const { DEFAULTS } = require("./config");
class PublicAccounting {
    requests = 0;
    bytes = 0;
    pages = 0;
    fallbackBlockMs;
    throttles = 0;
    lastThrottle = null;
    // Public origins map to advertised or fallback retry timestamps in milliseconds.
    blockedUntil = new Map();
    constructor(limits = DEFAULTS) {
        this.fallbackBlockMs = limits.contextMs;
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
    constructor(limits, shared = null) {
        this.limits = limits;
        this.shared = shared;
    }
    remaining() {
        return Math.max(
            0,
            this.limits.contextMs - (performance.now() - this.started)
        );
    }
    beforeRequest(url) {
        if (
            this.requests >= this.limits.contextRequests ||
            this.pages >= this.limits.contextPages ||
            this.remaining() <= 0
        )
            throw new ReviewError("CONTEXT_BUDGET_EXCEEDED");
        this.shared?.beforeRequest(url);
        this.requests++;
    }
    addBytes(bytes) {
        this.shared?.addBytes(bytes);
        this.bytes += bytes;
        if (this.bytes > this.limits.contextBytes)
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
function permittedUrl(value, repository, pr = null) {
    const url = new URL(value);
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
function decodePage(url, body, contentType, repository, pr) {
    if (contentType.includes("json")) {
        let value;
        try {
            value = JSON.parse(body);
        } catch {
            throw new ReviewError("CONTEXT_UNAVAILABLE");
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
    const head = body.match(/<head(?:\s[^>]*)?>([\s\S]*?)<\/head>/i)?.[1] || "";
    const canonical = [...head.matchAll(/<link\b[^>]*>/gi)].some(
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
    repository;
    repositoryId;
    pr;
    budget;
    exchange;
    controller = new AbortController();
    constructor(repository, pr, budget, exchange = fetch) {
        this.repository =
            typeof repository === "string" ? repository : repository.name;
        this.repositoryId =
            typeof repository === "string" ? null : repository.id;
        this.pr = pr;
        this.budget = budget;
        this.exchange = exchange;
    }
    permitted(input) {
        const url = new URL(input);
        if (
            this.repositoryId &&
            url.hostname === "api.github.com" &&
            url.pathname.startsWith(`/repositories/${this.repositoryId}/`)
        )
            url.pathname = url.pathname.replace(
                `/repositories/${this.repositoryId}/`,
                `/repos/${this.repository}/`
            );
        return permittedUrl(url.href, this.repository, this.pr);
    }
    async read(input) {
        try {
            return await this.readWithinBudget(input);
        } catch (error) {
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
            const response = await this.exchange(url, {
                method: "GET",
                redirect: "manual",
                headers: {
                    Accept:
                        url.hostname === "api.github.com"
                            ? "application/vnd.github+json"
                            : "text/html",
                    "User-Agent": "peer3-review-service"
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
            if (response.status >= 300 && response.status < 400) {
                check(response.headers.get("location"), "CONTEXT_UNAVAILABLE");
                url = this.permitted(
                    new URL(response.headers.get("location"), url).href
                );
                await response.body?.cancel();
                continue;
            }
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
            const body = Buffer.concat(chunks).toString("utf8");
            const data = decodePage(
                url.href,
                body,
                response.headers.get("content-type") || "",
                this.repository,
                this.pr
            );
            let next =
                response.headers
                    .get("link")
                    ?.match(/<([^>]+)>;\s*rel="next"/)?.[1] || null;
            if (next) next = this.permitted(next).href;
            this.budget.record(url.href, body, response.headers, data, next);
            return { data, next, source: this.budget.sources.at(-1) };
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
        const paths = this.budget.sources.map(
            (source) => new URL(source.url).pathname
        );
        const required = [
            `/repos/${this.repository}/pulls/${this.pr}`,
            `/repos/${this.repository}/issues/${this.pr}/comments`,
            `/repos/${this.repository}/pulls/${this.pr}/comments`,
            `/repos/${this.repository}/pulls/${this.pr}/reviews`
        ];
        return (
            required.every((route) => paths.includes(route)) &&
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
