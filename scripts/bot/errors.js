const MESSAGES = Object.freeze({
    SUBSCRIPTION_LIMIT: "Included subscription usage is exhausted.",
    LOGIN_EXPIRED: "Subscription login has expired.",
    MODEL_UNAVAILABLE: "The required model is unavailable.",
    SERVICE_UNAVAILABLE: "Review service is unavailable.",
    DISK_FULL: "Disk is full.",
    TRANSFER_TIMEOUT: "Review result transfer timed out.",
    QUEUE_TIMEOUT: "The review queue wait limit was reached.",
    SETUP_TIMEOUT: "Review setup timed out.",
    REVIEW_TIMEOUT:
        "The model execution limit was reached (at most thirty minutes).",
    CONTEXT_BUDGET_EXCEEDED: "The public context budget was exhausted.",
    CONTEXT_RATE_LIMITED: "Public context retrieval was rate limited.",
    CONTEXT_UNAVAILABLE: "Required public context is unavailable.",
    ACCOUNTING_INCOMPLETE:
        "Required finding/comment accounting remains incomplete.",
    INVALID_REQUEST: "The review request is invalid.",
    INVALID_RESULT: "The review result is invalid.",
    UNAUTHORIZED: "Review caller is not authorized.",
    STALE_HEAD: "The triggering PR head is no longer current.",
    BUSY: "The bounded review queue is full.",
    VALIDATION_EXPIRED: "The CI validation window expired.",
    ISOLATION_UNVERIFIED: "Required host isolation is not verified.",
    BILLING_UNVERIFIED: "Included-usage-only account controls are not verified."
});
class ReviewError extends Error {
    code;
    diagnostics;
    constructor(code) {
        super(MESSAGES[code] || MESSAGES.SERVICE_UNAVAILABLE);
        this.code = Object.hasOwn(MESSAGES, code)
            ? code
            : "SERVICE_UNAVAILABLE";
    }
}
function sanitized(error) {
    const code = error?.code === "ENOSPC" ? "DISK_FULL" : error?.code;
    const result = new ReviewError(code);
    if (error instanceof ReviewError && error.diagnostics !== undefined)
        result.diagnostics = error.diagnostics;
    return result;
}
module.exports = { MESSAGES, ReviewError, sanitized };
