const { check, exact } = require("./data");
const { parseReview } = require("./review-format");

// Prose has one owner: the Studio AI block. The footer contains only bookkeeping.
function markdownResult(markdown) {
    check(
        typeof markdown === "string" &&
            Buffer.byteLength(markdown) <= 1024 * 1024,
        "INVALID_RESULT"
    );
    const markers = [
        ...markdown.matchAll(/^<!-- review-result (\{[^\n]*\}) -->\r?$/gm)
    ];
    check(markers.length === 1, "INVALID_RESULT");
    let control;
    try {
        control = JSON.parse(markers[0][1]);
    } catch {
        check(false, "INVALID_RESULT");
    }
    exact(
        control,
        ["coverage", "accounting", "recommendation", "errors"],
        "INVALID_RESULT"
    );
    const report = markdown.replace(markers[0][0], "").trim() + "\n";
    let parsed;
    try {
        parsed = parseReview(report);
    } catch {
        check(false, "INVALID_RESULT");
    }
    return {
        report,
        findings: parsed.findings.map((card) => ({
            id: card.id,
            threadId: card.threadId ?? null,
            status: card.status ?? "new",
            body: card.aiBody,
            path: card.kind === "inline" ? card.path : null,
            line: card.kind === "inline" ? card.line : null,
            human: card.decision ?? null,
            evidence: card.evidence ?? []
        })),
        coverage: control.coverage,
        accounting: control.accounting,
        recommendation: control.recommendation,
        evidence: { errors: control.errors ?? [] }
    };
}
function decodeModelResult(generated) {
    if (typeof generated !== "string") return generated;
    // Retain compatibility with persisted/in-flight protocol-v1 results.
    if (generated.trimStart().startsWith("{")) {
        try {
            return JSON.parse(generated);
        } catch {
            check(false, "INVALID_RESULT");
        }
    }
    return markdownResult(generated);
}
module.exports = { markdownResult, decodeModelResult };
