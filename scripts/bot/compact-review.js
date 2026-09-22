const { check } = require("./data");

// Convert the model's prose into the existing Studio document. Identity, hashes,
// duplicated evidence and editor wrappers are controller work, not model output.
function compactReview(
    markdown,
    {
        request,
        revisions = new Map(),
        previous = [],
        sourceBase = request.mergeBase
    }
) {
    const sections = markdown.split(/(?=^## )/m);
    const completion = sections.find((s) =>
        s.startsWith("## Review completion\n")
    );
    check(completion, "INVALID_RESULT");
    const field = (name) =>
        completion.match(new RegExp(`^${name}: (.+)$`, "m"))?.[1];
    check(["yes", "no"].includes(field("Complete")), "INVALID_RESULT");
    const recommendation = field("Recommendation") || "comment";
    check(["comment", "approve"].includes(recommendation), "INVALID_RESULT");
    const list = (name) => {
        const value = field(name);
        check(value, "INVALID_RESULT");
        return value === "none" ? [] : value.split("; ");
    };
    const coverage = {
        complete: field("Complete") === "yes",
        missing: list("Missing"),
        verificationMissing: list("Verification missing"),
        files: [],
        lenses: list("Lenses"),
        behaviors: list("Behaviors")
    };
    const accounting = [];
    const addAccounting = (sourceId, disposition, response, findingId) => {
        const sourceRevision = revisions.get(sourceId);
        check(sourceRevision, "INVALID_RESULT");
        accounting.push({
            sourceId,
            sourceRevision,
            disposition,
            response,
            findingId,
            humanAssessment: null
        });
    };
    for (const line of markdown.split("\n")) {
        const row = line.match(
            /^\| ((?:comment|inline|review):\d+) \| (response|no-action|continued|fixed|disagreement) \| (.*?) \| ([A-Z0-9]+|-) \|$/
        );
        if (row)
            addAccounting(
                row[1],
                row[2],
                row[3],
                row[4] === "-" ? null : row[4]
            );
    }
    const document = {
        schema: 2,
        repo: request.repository.name,
        pr: request.pr,
        headSha: request.head,
        baseSha: sourceBase
    };
    const blocks = [];
    for (const section of sections) {
        if (section === completion) continue;
        const parts = section.split(/(?=^### \[[A-Z0-9]+\] )/m);
        const prose = parts.shift();
        check(
            !/^### \[[^\]\n]+\]|^Status: |^Location: /m.test(prose),
            "INVALID_RESULT"
        );
        blocks.push(prose);
        for (const part of parts) {
            const match = part.match(/^### \[([A-Z0-9]+)\] ([^\n]+)\n/);
            check(match, "INVALID_RESULT");
            const [, id] = match;
            const status = part.match(
                /^Status: (new|continued|fixed|recurred|disagreement)$/m
            )?.[1];
            const location = part.match(/^Location: (.+)$/m)?.[1];
            check(status && location, "INVALID_RESULT");
            const target =
                location === "general" ? null : location.match(/^(.+):(\d+)$/);
            check(location === "general" || target, "INVALID_RESULT");
            const body = part
                .slice(match[0].length)
                .replace(/^Status: .*\n?/m, "")
                .replace(/^Location: .*\n?/m, "")
                .trim();
            check(
                body.includes(`[${id}]`) && body.includes(`Fix ${id}-FIX`),
                "INVALID_RESULT"
            );
            const evidence = [
                ...body.matchAll(/https:\/\/github\.com\/[^\s)>]+/g)
            ].map((m) => m[0]);
            const old = previous.find((f) => f.id === id);
            const metadata = {
                id,
                kind: target ? "inline" : "general",
                status,
                threadId: old?.threadId || null,
                evidence: [...new Set(evidence)]
            };
            if (target)
                Object.assign(metadata, {
                    path: target[1],
                    line: Number(target[2]),
                    side: "RIGHT"
                });
            if (body.includes("🧑 **HUMAN DECISION REQUIRED**")) {
                const question = body.match(
                    /^(?:\*\*)?Decision:(?:\*\*)?\s*(.+)$/m
                )?.[1];
                check(question, "INVALID_RESULT");
                metadata.decision = {
                    required: true,
                    question,
                    reason: question,
                    revision: 1,
                    authority: "author"
                };
            }
            if (revisions.has(`finding:${id}`))
                addAccounting(
                    `finding:${id}`,
                    status === "new" || status === "recurred"
                        ? "continued"
                        : status,
                    body,
                    id
                );
            blocks.push(
                `- [ ] **[${id}] ${target ? "Inline comment" : "General PR comment"}**\n  <!-- pr-review-finding ${JSON.stringify(metadata)} -->\n  <!-- human:${id}:start -->\n  <!-- human:${id}:end -->\n  <!-- ai:${id}:start -->\n${body
                    .split("\n")
                    .map((line) => `  ${line}`)
                    .join("\n")}\n  <!-- ai:${id}:end -->\n\n`
            );
        }
    }
    return `<!-- pr-review-document ${JSON.stringify(document)} -->\n${blocks.join("")}\n<!-- review-result ${JSON.stringify({ coverage, accounting, recommendation, errors: [] })} -->\n`;
}
module.exports = { compactReview };
