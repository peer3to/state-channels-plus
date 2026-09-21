const { check, digest } = require("./data");
// Round state and action markers live as HTML comments inside the bot's own
// comment bodies, because GitHub gives the bot no other durable per-PR store it
// owns. Model-authored prose is published into those same bodies, and this
// payload only validates repository/PR/head, all of which the model already
// knows. Anything model-authored must therefore have its HTML comment syntax
// stripped before publication; review-format.js owns that.
const MARKER = /<!-- peer3-review-state:v1 ([A-Za-z0-9+/=]+) -->/g;
function encodeState(state) {
    return `<!-- peer3-review-state:v1 ${Buffer.from(JSON.stringify(state)).toString("base64")} -->`;
}
function readStates(comments, request, botId) {
    const states = [];
    for (const comment of comments) {
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
                    ["intent", "partial", "complete"].includes(state.status),
                "INVALID_RESULT"
            );
            check(
                Array.isArray(state.findings) && Array.isArray(state.actions),
                "INVALID_RESULT"
            );
            states.push({ ...state, commentId: comment.id });
        }
    }
    return states.sort(
        (a, b) => a.round - b.round || a.commentId - b.commentId
    );
}
function allocate(request, observations, botId) {
    const states = readStates(observations.comments, request, botId);
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
    encodeState,
    readStates,
    allocate,
    actionMarker,
    findAction
};
