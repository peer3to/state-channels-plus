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
function decodeModelResult(generated, context) {
    if (typeof generated !== "string") return generated;
    // Retain compatibility with persisted/in-flight protocol-v1 results.
    if (generated.trimStart().startsWith("{")) {
        try {
            return JSON.parse(generated);
        } catch {
            check(false, "INVALID_RESULT");
        }
    }
    if (context && !generated.includes("<!-- pr-review-document"))
        generated = require("./compact-review").compactReview(
            generated,
            context
        );
    return markdownResult(generated);
}
function repairModelResult(previous, reply) {
    if (typeof previous !== "string" || typeof reply !== "string") return reply;
    const footer = /^<!-- review-result (\{[^\n]*\}) -->$/;
    if (!footer.test(reply.trim())) return reply;
    const markers = [
        ...previous.matchAll(/^<!-- review-result (\{[^\n]*\}) -->\r?$/gm)
    ];
    if (markers.length !== 1) return reply;
    return previous.replace(markers[0][0], () => reply.trim());
}
function formatFeedback(generated) {
    let value;
    try {
        value = decodeModelResult(generated);
    } catch {
        return "Check the ordinary Markdown contract: each finding needs a ### [ID] heading, Status and Location lines, its visible [ID] and Fix ID-FIX callout. Include the Review completion fields. Discussion table sources must have been read through public tools. Do not generate JSON or hidden bookkeeping.";
    }
    if (
        value?.coverage?.complete &&
        (value.coverage.missing?.length || value.evidence?.errors?.length)
    )
        return "coverage.complete is true but coverage.missing or errors is nonempty. errors means UNRESOLVED failures, not recovered tool attempts. If a wrong-path read was followed by a successful read of the intended file, remove that recovered incident from errors. Do not clear a real unresolved failure: finish the missing work or report incomplete coverage honestly.";
    return "The decoded report failed result validation. Check finding IDs, dispositions, field types, evidence, document SHAs and the supplied model-output contract. Do not redo the substantive review merely to repair its format.";
}
module.exports = {
    markdownResult,
    decodeModelResult,
    repairModelResult,
    formatFeedback
};
