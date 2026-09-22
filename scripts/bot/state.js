const { check, digest } = require("./data");
// Legacy snapshot codec is retained for migration and historical fixtures only.
// New publication state belongs to the worker; GitHub carries small ID markers.
// Model prose must still have HTML control markers stripped before publishing.
const MARKER = /<!-- peer3-review-state:v1 ([A-Za-z0-9+/=]+) -->/g;
function stripState(body) {
    return body.replace(MARKER, "").trim();
}
function publicContext(value) {
    if (Array.isArray(value)) return value.map(publicContext);
    if (!value || typeof value !== "object") return value;
    const result = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            key === "body" &&
            typeof item === "string" &&
            value.user?.type === "Bot"
                ? stripState(item)
                : publicContext(item)
        ])
    );
    if (value.user?.type === "Bot" && typeof value.body === "string") {
        const findings = new Map();
        for (const match of value.body.matchAll(MARKER)) {
            try {
                const state = JSON.parse(
                    Buffer.from(match[1], "base64").toString("utf8")
                );
                for (const finding of state.findings || [])
                    findings.set(finding.id, {
                        id: finding.id,
                        status: finding.status,
                        threadId: finding.threadId,
                        sourceId: `finding:${finding.id}`,
                        sourceRevision: digest(finding)
                    });
            } catch {
                /* A malformed legacy marker is not review evidence. */
            }
        }
        if (findings.size) result.reviewFindings = [...findings.values()];
    }
    return result;
}
function encodeState(state) {
    return `<!-- peer3-review-state:v1 ${Buffer.from(JSON.stringify(state)).toString("base64")} -->`;
}
function attachState(body, state) {
    // Keep other heads' history for round allocation and finding reconciliation.
    const retained = body
        .replace(MARKER, (marker, encoded) => {
            const previous = JSON.parse(
                Buffer.from(encoded, "base64").toString("utf8")
            );
            return previous.repositoryId === state.repositoryId &&
                previous.pr === state.pr &&
                previous.head === state.head
                ? ""
                : marker;
        })
        .trim();
    return `${retained}\n\n${encodeState(state)}`;
}
function readStates(comments, request, botId) {
    if (!Array.isArray(comments) && comments.publicationStates)
        return structuredClone(comments.publicationStates);
    const containers = Array.isArray(comments)
        ? comments.map((item) => ({ item, kind: "comment" }))
        : [
              ...(comments.comments || []).map((item) => ({
                  item,
                  kind: "comment"
              })),
              ...(comments.reviews || []).map((item) => ({
                  item,
                  kind: "review"
              }))
          ];
    const states = [];
    for (const { item: comment, kind } of containers) {
        if (comment.user?.id !== botId || comment.user.type !== "Bot") continue;
        for (const match of (comment.body || "").matchAll(MARKER)) {
            check(match[1].length <= 1024 * 1024, "INVALID_RESULT");
            let state;
            try {
                state = JSON.parse(
                    Buffer.from(match[1], "base64").toString("utf8")
                );
            } catch {
                check(false, "INVALID_RESULT");
            }
            check(
                state.version === 1 &&
                    state.repositoryId === request.repository.id &&
                    state.pr === request.pr &&
                    /^[a-f0-9]{40}$/.test(state.head),
                "INVALID_RESULT"
            );
            check(
                Number.isSafeInteger(state.round) &&
                    state.round > 0 &&
                    (state.sequence === undefined ||
                        (Number.isSafeInteger(state.sequence) &&
                            state.sequence >= 0)) &&
                    ["intent", "partial", "complete"].includes(state.status),
                "INVALID_RESULT"
            );
            check(
                Array.isArray(state.findings) && Array.isArray(state.actions),
                "INVALID_RESULT"
            );
            states.push({ ...state, commentId: comment.id, commentKind: kind });
        }
    }
    return states.sort(
        (a, b) =>
            a.round - b.round ||
            (a.sequence || 0) - (b.sequence || 0) ||
            a.commentId - b.commentId
    );
}
function allocate(request, observations, botId) {
    const states = readStates(observations, request, botId);
    const sameHead = states
        .filter((state) => state.head === request.head)
        .at(-1);
    if (sameHead) return sameHead;
    return {
        version: 1,
        repositoryId: request.repository.id,
        pr: request.pr,
        head: request.head,
        round: Math.max(0, ...states.map((state) => state.round)) + 1,
        status: "intent",
        findings: [],
        actions: []
    };
}
// Same exposure as the state marker above: this digest covers only fields the
// model receives in its request, so a forged marker in model prose could make
// findAction believe an action was already applied. Model text is stripped of
// HTML comment syntax before it reaches a published body.
function actionMarker(request, operation, identity) {
    return `<!-- peer3-review-action:v1 ${digest({ repositoryId: request.repository.id, pr: request.pr, head: request.head, operation, identity })} -->`;
}
function findAction(observations, marker, botId) {
    return [
        ...observations.comments,
        ...observations.inline,
        ...observations.reviews
    ].find(
        (item) =>
            item.user?.id === botId &&
            item.user.type === "Bot" &&
            item.body?.includes(marker)
    );
}
module.exports = {
    stripState,
    publicContext,
    attachState,
    encodeState,
    readStates,
    allocate,
    actionMarker,
    findAction
};
