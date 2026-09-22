const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { check, digest, ownedPath, writeText, writeJson } = require("./data");
const { GitHubWriter, actionsBotId } = require("./github-write");
const { readStates } = require("./state");
const { findingSource, findingBounds } = require("./finding-source");
const { safeText } = require("./review-format");

const DOCUMENT = "<!-- peer3-assessment:v1 -->";
function assessmentFindings(request, observations, botId) {
    const marked = new Map();
    for (const item of [
        ...observations.reviews,
        ...observations.comments,
        ...observations.inline
    ]) {
        if (item.user?.id !== botId || item.user.type !== "Bot") continue;
        for (const match of (item.body || "").matchAll(
            /<!-- peer3-review-finding:v1 ([A-Z][A-Z0-9]{0,127}):start -->/g
        )) {
            const id = match[1],
                bounds = findingBounds(id);
            const end = item.body.indexOf(bounds.end, match.index);
            check(end > match.index, "INVALID_RESULT");
            const body = item.body
                .slice(match.index + bounds.start.length, end)
                .trim();
            const thread = observations.threads.find((entry) =>
                entry.comments.nodes.some((node) => node.databaseId === item.id)
            );
            marked.set(id, {
                id,
                url: item.html_url,
                body: safeText(body),
                resolved:
                    thread?.isResolved === true ||
                    body.startsWith("<details>\n<summary>✅ RESOLVED"),
                human: /HUMAN DECISION REQUIRED/.test(body),
                conversation: thread
                    ? observations.inline
                          .filter((comment) =>
                              thread.comments.nodes.some(
                                  (node) => node.databaseId === comment.id
                              )
                          )
                          .sort(
                              (a, b) =>
                                  String(a.created_at).localeCompare(
                                      String(b.created_at)
                                  ) || a.id - b.id
                          )
                          .map((comment) => ({
                              author: comment.user?.login || "Unknown author",
                              createdAt: comment.created_at || "",
                              body: safeText(comment.body || ""),
                              url: comment.html_url
                          }))
                    : [],
                revision: digest(body)
            });
        }
    }
    const state = readStates(observations, request, botId)
        .filter((item) => item.status !== "intent")
        .at(-1);
    if (!state) return [...marked.values()];
    const legacy = state.findings
        .filter((finding) => !marked.has(finding.id))
        .map((finding) => {
            const thread =
                finding.threadId &&
                observations.threads.find(
                    (item) => item.id === finding.threadId
                );
            if (finding.threadId) check(thread, "CONTEXT_UNAVAILABLE");
            const resolved =
                (state.status === "complete" &&
                    ["fixed", "disagreement"].includes(finding.status)) ||
                thread?.isResolved === true;
            const source = findingSource(request, observations, botId, finding);
            // Never silently omit an outstanding finding whose original was not located.
            check(resolved || source, "CONTEXT_UNAVAILABLE");
            return {
                id: finding.id,
                url: source?.item.html_url,
                body: finding.body,
                resolved,
                human: finding.human?.required === true,
                revision: digest(finding)
            };
        });
    return [...legacy, ...marked.values()];
}
function renderAssessment(findings, request) {
    let next = 1;
    const statusLine = (finding) =>
        `<!-- peer3-assessment-status:start -->\n**GitHub status:** ${finding.human ? "🙋 HUMAN DECISION REQUIRED" : "OPEN"}\n<!-- peer3-assessment-status:end -->`;
    const output = [];
    for (const finding of findings.filter((item) => !item.resolved)) {
        check(
            new URL(finding.url).origin === "https://github.com" &&
                new URL(finding.url).pathname ===
                    `/${request.repository.name}/pull/${request.pr}`,
            "INVALID_RESULT"
        );
        const id = `APR-${String(next++).padStart(3, "0")}`;
        const quote = (
            finding.conversation?.length
                ? finding.conversation
                      .map(
                          (comment) =>
                              `**${comment.author} · ${comment.createdAt}**${comment.url ? ` · [Open comment](${comment.url})` : ""}\n\n${comment.body}`
                      )
                      .join("\n\n---\n\n")
                : safeText(finding.body)
        )
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n");
        output.push(
            `## ${id} — [${finding.id}] — ${finding.human ? "🙋 Human assessment needed" : "Not yet assessed"}\n\n<!-- peer3-assessment-card ${JSON.stringify({ id: finding.id, url: finding.url, revision: finding.revision })} -->\nSource: [GitHub finding](${finding.url})\n\nFinding ID: ${finding.id}\n\n${statusLine(finding)}\n\n> [!QUOTE]\n> **Original comment**\n>\n${quote}\n\n### Assessment\n\n### Ready-to-post reply\n\n### Proposed fix\n\n`
        );
    }
    const header = `# PR #${request.pr} assessment\n\nRepository: ${request.repository.name}\n\n${DOCUMENT}\n\n`;
    return header + output.join("");
}
function parseTarget(value, repo) {
    const url = String(value || "").match(
        /^https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/([1-9][0-9]*)\/?$/
    );
    if (url) return { repository: { name: url[1] }, pr: Number(url[2]) };
    check(
        /^[1-9][0-9]*$/.test(value || "") &&
            /^[\w.-]+\/[\w.-]+$/.test(repo || ""),
        "INVALID_REQUEST"
    );
    return { repository: { name: repo }, pr: Number(value) };
}
async function fetchAssessment(request, { token, root, exchange = fetch }) {
    // Reuse the pagination/ownership reader, with a transport that forbids writes.
    const readOnly = (url, options) => {
        check(
            options.method === "GET" ||
                (url === "https://api.github.com/graphql" &&
                    /^\s*query\b/.test(JSON.parse(options.body).query)),
            "UNAUTHORIZED"
        );
        return exchange(url, options);
    };
    const botId = await actionsBotId(token, readOnly);
    const reader = new GitHubWriter(request, {
        token,
        botId,
        exchange: readOnly
    });
    const pull = await reader.api(`/pulls/${request.pr}`);
    check(
        pull.number === request.pr &&
            pull.base?.repo?.full_name === request.repository.name,
        "CONTEXT_UNAVAILABLE"
    );
    request.repository.id = pull.base.repo.id;
    request.head = pull.head.sha;
    const observations = await reader.observe();
    const findings = assessmentFindings(request, observations, botId);
    const relative = `temp/pr-github-reviews/${request.pr}/assessment.md`;
    const filename = await ownedPath(root, relative, true);
    let previous = "";
    let existed = false;
    try {
        previous = await fs.readFile(filename, "utf8");
        existed = true;
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    const next = renderAssessment(findings, request);
    // A concurrent local edit must not be overwritten by this fetch.
    let current = "";
    try {
        current = await fs.readFile(filename, "utf8");
    } catch (error) {
        if (error.code !== "ENOENT") throw error;
    }
    check(current === previous, "INVALID_REQUEST");
    if (existed) {
        const backup = `${relative}.backup-${Date.now()}-${randomUUID()}`;
        await writeText(root, backup, previous);
        console.log(
            `Previous assessment preserved: ${path.join(root, backup)}`
        );
    }
    await writeJson(
        root,
        `temp/pr-github-reviews/${request.pr}/github-findings.json`,
        { request, findings: findings.filter((finding) => !finding.resolved) }
    );
    await writeText(root, relative, next);
    return filename;
}
async function main(args) {
    if (args.includes("--help")) {
        console.log(
            "Usage: yarn review-bot:fetch-assessment <PR number or URL> [--repo owner/repo]\nReads GitHub only. Uses GH_TOKEN/GITHUB_TOKEN or saved gh credentials (including older gh versions). Regenerates from current GitHub findings; preserves the previous file in a timestamped backup."
        );
        return;
    }
    check(
        args.length === 1 || (args.length === 3 && args[1] === "--repo"),
        "INVALID_REQUEST"
    );
    const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
        encoding: "utf8"
    }).trim();
    let repo = args[2];
    if (!repo && !args[0].startsWith("https://")) {
        const remote = execFileSync("git", ["remote", "get-url", "origin"], {
            encoding: "utf8"
        }).trim();
        repo = remote.match(
            /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/
        )?.[1];
    }
    const token = githubToken();
    const file = await fetchAssessment(parseTarget(args[0], repo), {
        root: path.resolve(root),
        token
    });
    console.log(
        `Assessment saved: ${file}\nOpen in PR Review Studio assessment mode. Nothing was posted to GitHub.`
    );
}
function githubToken(env = process.env, execute = execFileSync) {
    const supplied = env.GH_TOKEN || env.GITHUB_TOKEN;
    if (supplied) return supplied;
    for (const args of [
        ["auth", "token", "--hostname", "github.com"],
        ["config", "get", "oauth_token", "--host", "github.com"]
    ]) {
        try {
            const token = execute("gh", args, {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
                timeout: 10000
            }).trim();
            if (token) return token;
        } catch {
            // Older gh versions lack auth token. Never expose subprocess output.
        }
    }
    throw new Error(
        "Could not read GitHub credentials using gh auth token or gh config get oauth_token. Ensure gh is installed and logged in to github.com, or supply GH_TOKEN/GITHUB_TOKEN. A read-only token with repository access is sufficient."
    );
}
if (require.main === module)
    main(process.argv.slice(2)).catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = {
    githubToken,
    assessmentFindings,
    renderAssessment,
    parseTarget,
    fetchAssessment
};
