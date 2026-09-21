const { PublicGitHub, ContextBudget } = require("../../github-read");
const { DEFAULTS } = require("../../config");
const { RecordedGitHub } = require("./github");
const { request } = require("./records");
const input = request();
const prefix = `/repos/${input.repository.name}`;
const checksPath = `${prefix}/commits/${input.head}/check-runs`;
const statusPath = `${prefix}/commits/${input.head}/status`;
const timelinePath = `${prefix}/issues/${input.pr}/timeline`;
function checks(overrides = {}) {
    return {
        total_count: 1,
        check_runs: [
            {
                id: 10,
                head_sha: input.head,
                name: "test",
                status: "completed",
                conclusion: "success"
            }
        ],
        ...overrides
    };
}
function status(overrides = {}) {
    return {
        sha: input.head,
        repository: { full_name: input.repository.name },
        state: "pending",
        total_count: 1,
        statuses: [{ id: 11, context: "build", state: "pending" }],
        ...overrides
    };
}
function context(records, head = input.head) {
    const wire = new RecordedGitHub(records);
    const budget = new ContextBudget(DEFAULTS);
    const owner = new PublicGitHub(
        input.repository,
        input.pr,
        budget,
        wire.exchange.bind(wire),
        head
    );
    return { wire, budget, owner };
}
module.exports = {
    input,
    prefix,
    checksPath,
    statusPath,
    timelinePath,
    checks,
    status,
    context
};
