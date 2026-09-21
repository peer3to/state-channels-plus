const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const source = fs.readFileSync(
    path.join(__dirname, "../../../../.github/workflows/ci.yml"),
    "utf8"
);
const workflow = YAML.parse(source);
function dependencies(job) {
    return Array.isArray(job.needs) ? job.needs : job.needs ? [job.needs] : [];
}
function graph(jobs) {
    const active = new Set(),
        done = new Set();
    function visit(name) {
        assert.ok(jobs[name], `Missing dependency ${name}`);
        assert.ok(!active.has(name), `Dependency cycle at ${name}`);
        if (done.has(name)) return;
        active.add(name);
        for (const dependency of dependencies(jobs[name])) visit(dependency);
        active.delete(name);
        done.add(name);
    }
    for (const name of Object.keys(jobs)) visit(name);
}
describe("review CI workflow", function () {
    it("keeps a repository-wide queued workflow and the existing PR triggers", function () {
        assert.deepEqual(workflow.on.pull_request.types, [
            "opened",
            "synchronize",
            "reopened"
        ]);
        assert.deepEqual(workflow.concurrency, {
            group: "state-channels-plus-ci",
            queue: "max",
            "cancel-in-progress": false
        });
        assert.equal(workflow.permissions.contents, "read");
    });
    it("uses four advisory review jobs after the separate hard admission gate", function () {
        for (const name of [
            "review-model",
            "review-publish",
            "review-persist",
            "review-cleanup"
        ]) {
            assert.ok(workflow.jobs[name]);
            assert.ok(Number.isInteger(workflow.jobs[name]["timeout-minutes"]));
            assert.equal(workflow.jobs[name]["continue-on-error"], undefined);
            assert.ok(dependencies(workflow.jobs[name]).includes("head-check"));
        }
        assert.equal(workflow.jobs["review-restore"], undefined);
        assert.ok(workflow.jobs["review-model"]["timeout-minutes"] > 30);
    });
    it("stops dependent pipeline work when temporary acceptance fails", function () {
        for (const name of ["spec", "test", "browser", "review-model"]) {
            const job = workflow.jobs[name];
            assert.ok(dependencies(job).includes("review-bot-tests"));
            assert.ok(
                !job.if.includes("!cancelled()") && !job.if.includes("always()")
            );
            assert.equal(job["continue-on-error"], undefined);
        }
        for (const name of ["spec", "test", "browser"])
            assert.ok(
                dependencies(workflow.jobs[name]).includes(
                    "review-bot-observer"
                )
            );
        assert.ok(
            source.includes(
                "!cancelled() && needs.head-check.result == 'success'"
            )
        );
    });
    it("keeps producer observer and normal-suite dependencies acyclic", function () {
        graph(workflow.jobs);
    });
    it("restores review and normal-suite parallelism after feature-only edges are removed", function () {
        const jobs = structuredClone(workflow.jobs);
        delete jobs["review-bot-tests"];
        delete jobs["review-bot-observer"];
        for (const job of Object.values(jobs))
            job.needs = dependencies(job).filter(
                (name) => !name.startsWith("review-bot-")
            );
        graph(jobs);
        for (const name of ["spec", "test", "browser", "review-model"])
            assert.deepEqual(jobs[name].needs, ["head-check"]);
    });
    it("confines credentials to their owning steps and leaves cleanup checkout-free", function () {
        const model = workflow.jobs["review-model"],
            publisher = workflow.jobs["review-publish"];
        assert.ok(model.if.includes("eligible"));
        assert.ok(publisher.if.includes("eligible"));
        for (const job of [model, publisher, workflow.jobs["review-persist"]]) {
            assert.equal(job.env, undefined);
            for (const step of job.steps) {
                if (step.run?.includes("yarn install")) {
                    assert.ok(step.run.includes("--ignore-scripts"));
                    assert.equal(step.env, undefined);
                }
                if (step.env?.SCP_TEST_POOL_SECRET)
                    assert.equal(step.env.GITHUB_TOKEN, undefined);
            }
        }
        const cleanup = workflow.jobs["review-cleanup"];
        assert.deepEqual(cleanup.permissions, { actions: "write" });
        assert.ok(
            cleanup.steps.every(
                (step) => !step.uses?.startsWith("actions/checkout")
            )
        );
    });
    it("preserves ordinary test admission for ineligible fork and Dependabot reviews", function () {
        const observer = workflow.jobs["review-bot-observer"];
        assert.ok(
            observer.if.includes("needs.review-bot-tests.result == 'success'")
        );
        assert.ok(observer.if.includes("needs.head-check.result == 'success'"));
        assert.ok(!observer.if.includes("eligible == 'true'"));
        for (const step of observer.steps.filter(
            (entry) => entry.uses || entry.run?.includes("yarn")
        ))
            assert.equal(
                step.if,
                "needs.head-check.outputs.eligible == 'true'"
            );
        assert.equal(
            workflow.jobs["review-model"].if,
            "needs.head-check.outputs.current == 'true' && needs.head-check.outputs.eligible == 'true'"
        );
    });
});

describe("review CI credential setup", function () {
    it("uses the existing orchestrator seed and exports only its public key", function () {
        assert.ok(!source.includes("SCP_REVIEW_CLIENT_SEED"));
        assert.ok(!source.includes("REVIEW_SERVICE_ENABLED"));
        assert.ok(!source.includes("REVIEW_MAINTAINER_IDS"));
        assert.ok(!source.includes("SCP_REVIEW_SERVER_KEY"));
        assert.ok(!source.includes("REVIEW_POLICY_JSON"));
        assert.ok(!source.includes("vars.SCP_REVIEW_CLIENT_KEY"));
        const model = workflow.jobs["review-model"];
        assert.equal(
            model.outputs.caller,
            "${{ steps.request.outputs.caller }}"
        );
        const request = model.steps.find((step) => step.id === "request");
        assert.equal(
            request.env.SCP_TEST_ORCHESTRATOR_SEED,
            "${{ secrets.SCP_TEST_ORCHESTRATOR_SEED }}"
        );
        for (const name of ["review-model", "review-publish", "review-persist"])
            for (const step of workflow.jobs[name].steps.filter(
                (step) => step.env?.SCP_TEST_POOL_SECRET
            ))
                assert.equal(
                    step.env.SCP_TEST_ORCHESTRATOR_SEED,
                    "${{ secrets.SCP_TEST_ORCHESTRATOR_SEED }}"
                );
        for (const step of workflow.jobs["review-publish"].steps.filter(
            (step) => step.env?.SCP_REVIEW_CLIENT_KEY
        ))
            assert.equal(
                step.env.SCP_REVIEW_CLIENT_KEY,
                "${{ needs.review-model.outputs.caller }}"
            );
    });
    it("grants comment and review writes only to the publisher without an App secret", function () {
        assert.ok(!source.includes("REVIEW_APP"));
        assert.ok(!source.includes("REVIEW_BOT_USER_ID"));
        assert.ok(!source.includes("create-github-app-token"));
        for (const [name, job] of Object.entries(workflow.jobs)) {
            assert.equal(
                job.permissions?.["pull-requests"] === "write",
                name === "review-publish"
            );
            assert.equal(
                job.permissions?.issues === "write",
                name === "review-publish"
            );
            assert.equal(
                job.permissions?.actions === "write",
                name === "review-cleanup"
            );
        }
        for (const id of ["publish", "publish-final"])
            assert.equal(
                workflow.jobs["review-publish"].steps.find(
                    (step) => step.id === id
                ).env.GITHUB_TOKEN,
                "${{ github.token }}"
            );
    });
});
