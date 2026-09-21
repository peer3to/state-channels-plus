const { check } = require("./data");
const { readStates, actionMarker } = require("./state");

function findingBounds(id) {
    check(/^[A-Z][A-Z0-9]{0,127}$/.test(id), "INVALID_RESULT");
    return {
        start: `<!-- peer3-review-finding:v1 ${id}:start -->`,
        end: `<!-- peer3-review-finding:v1 ${id}:end -->`
    };
}
function wrapFinding(id, body) {
    const bounds = findingBounds(id);
    return `${bounds.start}\n${body}\n${bounds.end}`;
}
// Locate only bot-owned, controller-marked findings. IDs in arbitrary prose are
// not sufficient authority to edit a GitHub comment.
function findingSource(request, observations, botId, finding) {
    const states = readStates(observations, request, botId);
    const candidates = [
        ...observations.comments.map((item) => ({ item, kind: "comment" })),
        ...observations.reviews.map((item) => ({ item, kind: "review" })),
        ...observations.inline.map((item) => ({ item, kind: "inline" }))
    ].filter(({ item }) => item.user?.id === botId && item.user.type === "Bot");
    const bounds = findingBounds(finding.id);
    for (const state of states) {
        if (!state.findings.some((item) => item.id === finding.id)) continue;
        const marker = actionMarker(
            { ...request, head: state.head },
            "finding",
            finding.id
        );
        for (const candidate of candidates) {
            const body = candidate.item.body || "";
            const markerAt = body.indexOf(marker);
            if (markerAt < 0) continue;
            const start = body.indexOf(bounds.start);
            const end = body.indexOf(bounds.end, start);
            if (start >= 0 && end > start)
                return {
                    ...candidate,
                    start,
                    end: end + bounds.end.length,
                    marker
                };
            if (candidate.kind === "inline")
                return { ...candidate, start: 0, end: body.length, marker };
            // Older reviews grouped findings, with a marker following each body.
            // Only replace the matching heading through that marker, never siblings.
            const localId = Object.entries(state.mappings || {}).find(
                ([, id]) => id === finding.id
            )?.[0];
            const ids = [finding.id, localId].filter((id) =>
                /^[A-Z][A-Z0-9]*$/.test(id || "")
            );
            const lead = new RegExp(
                `^[^\\n]*?\\*\\*\\[(?:${ids.join("|")})\\]`,
                "gm"
            );
            const matches = [...body.slice(0, markerAt).matchAll(lead)];
            if (matches.length === 1)
                return {
                    ...candidate,
                    start: matches[0].index,
                    end: markerAt + marker.length,
                    marker
                };
        }
    }
    return null;
}
module.exports = { findingBounds, wrapFinding, findingSource };
