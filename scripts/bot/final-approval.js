const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { check } = require("./data");
const protocol = require("./protocol");
const { GitHubWriter, actionsBotId } = require("./github-write");
const { canApprove } = require("./approval");
const { callService } = require("./client");
const { clientSeed } = require("./identity");
const { DEFAULTS } = require("./config");

const WORKFLOWS = {
    "ci.yml": ["review-bot-tests", "spec", "test", "browser"],
    "review.yml": ["review-model", "review-publish"]
};
async function collection(github, route, key) {
    const items = [];
    for (let page = 1; ; page++) {
        const value = await github.api(
            `${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`
        );
        check(Array.isArray(value[key]), "CONTEXT_UNAVAILABLE");
        items.push(...value[key]);
        if (value[key].length < 100) return items;
    }
}
async function completedInputs(github, request) {
    const selected = {};
    for (const [workflow, required] of Object.entries(WORKFLOWS)) {
        const runs = await collection(
            github,
            `/actions/workflows/${workflow}/runs?event=pull_request&head_sha=${request.head}`,
            "workflow_runs"
        );
        const run = runs
            .filter(
                (item) =>
                    item.head_sha === request.head &&
                    item.head_repository?.id === request.repository.id &&
                    item.pull_requests?.some(
                        (pull) => pull.number === request.pr
                    )
            )
            .sort((a, b) => b.id - a.id)[0];
        if (!run) return null;
        const jobs = await collection(
            github,
            `/actions/runs/${run.id}/jobs?filter=latest`,
            "jobs"
        );
        // A rerun copies retained jobs into the new attempt under its number, so
        // a listing with an older attempt has not caught up with the rerun yet.
        if (!jobs.every((job) => job.run_attempt === run.run_attempt))
            return null;
        const substantive = jobs.filter((job) => job.name !== "approve");
        if (
            !required.every((name) =>
                substantive.some((job) => job.name === name)
            ) ||
            !substantive.every(
                (job) =>
                    job.status === "completed" && job.conclusion === "success"
            )
        )
            return null;
        let modelAttempt = null;
        if (workflow === "review.yml") {
            // Retained jobs report the rerun's attempt, not the one that ran the
            // model; the newest result artifact names the producing attempt.
            const artifacts = await collection(
                github,
                `/actions/runs/${run.id}/artifacts`,
                "artifacts"
            );
            modelAttempt = Math.max(
                0,
                ...artifacts
                    .filter((artifact) => !artifact.expired)
                    .map((artifact) =>
                        Number(
                            new RegExp(`^review-${run.id}-(\\d+)-result$`).exec(
                                artifact.name
                            )?.[1]
                        )
                    )
                    .filter(
                        (attempt) =>
                            Number.isSafeInteger(attempt) &&
                            attempt > 0 &&
                            attempt <= run.run_attempt
                    )
            );
            if (!modelAttempt) return null;
        }
        selected[workflow] = {
            id: run.id,
            attempt: run.run_attempt,
            modelAttempt,
            jobs: substantive.map((job) => job.id).sort((a, b) => a - b)
        };
    }
    return selected;
}
async function finalize({ github, request, loadStatus, inputs, readInputs }) {
    const status = await loadStatus();
    check(
        status.repository.id === request.repository.id &&
            status.repository.name === request.repository.name &&
            status.pr === request.pr &&
            status.head === request.head &&
            status.run.id === inputs["review.yml"].id &&
            status.run.attempt === inputs["review.yml"].modelAttempt,
        "INVALID_RESULT"
    );
    const current = await readInputs();
    if (JSON.stringify(current) !== JSON.stringify(inputs))
        return "waiting-for-ci";
    const again = await loadStatus();
    if (again.snapshot !== status.snapshot) return "review-changed";
    let observed;
    try {
        observed = await github.observe();
    } catch (error) {
        if (error.code === "STALE_HEAD") return "superseded";
        throw error;
    }
    if (
        !canApprove({
            status: again,
            observations: observed,
            head: request.head,
            botId: github.botId,
            ciPassed: !!current
        })
    )
        return "not-ready";
    const marker = `<!-- peer3-review-approval:v1 ${request.head} -->`;
    if (
        observed.reviews.some(
            (review) =>
                review.user?.id === github.botId &&
                review.state === "APPROVED" &&
                review.commit_id === request.head &&
                review.body?.includes(marker)
        )
    )
        return "already-approved";
    await github.approve(marker);
    return "approved";
}
async function main() {
    const event = JSON.parse(
        await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8")
    );
    const pull = event.pull_request;
    check(
        pull?.head?.repo?.id === event.repository.id &&
            process.env.GITHUB_ACTOR !== "dependabot[bot]",
        "UNAUTHORIZED"
    );
    const expected = {
        repository: {
            id: event.repository.id,
            name: event.repository.full_name
        },
        pr: pull.number,
        head: pull.head.sha
    };
    const token = process.env.GITHUB_TOKEN;
    const github = new GitHubWriter(expected, {
        token,
        botId: await actionsBotId(token)
    });
    const inputs = await completedInputs(github, expected);
    if (!inputs) {
        console.log(
            "Approval deferred: substantive CI/review jobs have not all succeeded."
        );
        return;
    }
    const run = inputs["review.yml"];
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "review-approval-"));
    try {
        // This artifact is data only. Never execute downloaded review content.
        execFileSync(
            "gh",
            [
                "run",
                "download",
                String(run.id),
                "--repo",
                expected.repository.name,
                "--name",
                `review-${run.id}-${run.modelAttempt}-result`,
                "--dir",
                root
            ],
            {
                env: { ...process.env, GH_TOKEN: token },
                stdio: ["ignore", "pipe", "pipe"],
                timeout: 60000
            }
        );
        const request = protocol.request(
            JSON.parse(
                await fs.readFile(path.join(root, "request.json"), "utf8")
            )
        );
        check(
            request.repository.id === expected.repository.id &&
                request.repository.name === expected.repository.name &&
                request.pr === expected.pr &&
                request.head === expected.head &&
                request.run.id === run.id &&
                request.run.attempt === run.modelAttempt,
            "INVALID_RESULT"
        );
        const generated = protocol.result(
            JSON.parse(
                await fs.readFile(path.join(root, "result.json"), "utf8")
            ),
            request
        );
        const loadStatus = () =>
            callService({
                request,
                operation: "publication",
                payload: { executionId: generated.executionId },
                secret: process.env.SCP_TEST_POOL_SECRET,
                seed: clientSeed({
                    ...process.env,
                    GITHUB_REPOSITORY_ID: String(request.repository.id),
                    GITHUB_RUN_ID: String(run.id),
                    GITHUB_RUN_ATTEMPT: String(run.modelAttempt)
                }),
                stateRoot: process.env.SCP_REVIEW_CLIENT_STATE,
                limits: { ...DEFAULTS, queueMs: 60000, setupMs: 60000 }
            }).then((response) => {
                check(response.approval, "INVALID_RESULT");
                return response.approval;
            });
        console.log(
            `Approval: ${await finalize({
                github,
                request,
                loadStatus,
                inputs,
                readInputs: () => completedInputs(github, expected)
            })}`
        );
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
}
if (require.main === module)
    main().catch((error) => {
        console.error(error.message);
        process.exitCode = 1;
    });
module.exports = { completedInputs, finalize, main };
