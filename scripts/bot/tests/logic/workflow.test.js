const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");
const read = (name) =>
    fs.readFileSync(
        path.join(__dirname, "../../../../.github/workflows", name),
        "utf8"
    );
const source = read("review.yml");
const review = YAML.parse(source);
const ci = YAML.parse(read("ci.yml"));
describe("review CI workflow", function () {
    it("runs the same serialized approval gate after both independent workflows without a default-branch trigger", function () {
        assert.deepEqual(ci.jobs.approve.needs, [
            "review-bot-tests",
            "spec",
            "test",
            "browser"
        ]);
        assert.deepEqual(review.jobs.approve.needs, [
            "review-model",
            "review-publish"
        ]);
        assert.deepEqual(
            ci.jobs.approve.concurrency,
            review.jobs.approve.concurrency
        );
        for (const workflow of [ci, review]) {
            assert.equal(workflow.on.workflow_run, undefined);
            assert.equal(
                workflow.jobs.approve.steps.at(-1).run,
                "node scripts/bot/final-approval.js"
            );
            assert.equal(
                workflow.jobs.approve.permissions["pull-requests"],
                "write"
            );
        }
    });
    it("runs ordinary gates independently and serializes only distributed tests", function () {
        assert.equal(ci.concurrency, undefined);
        for (const name of ["spec", "test", "browser", "review-bot-tests"]) {
            assert.equal(ci.jobs[name].needs, undefined);
            assert.equal(ci.jobs[name].if, undefined);
            if (name !== "test")
                assert.equal(ci.jobs[name].concurrency, undefined);
        }
        assert.deepEqual(ci.jobs.test.concurrency, {
            group: "state-channels-plus-distributed-tests",
            queue: "max",
            "cancel-in-progress": false
        });
        assert.equal(ci.jobs["review-model"], undefined);
    });
    it("finishes active reviews and retains only the latest pending head per PR", function () {
        assert.deepEqual(review.concurrency, {
            group: "review-${{ github.event.pull_request.number }}",
            "cancel-in-progress": false
        });
        assert.deepEqual(review.on.pull_request.types, [
            "opened",
            "synchronize",
            "reopened"
        ]);
        assert.deepEqual(Object.keys(review.jobs), [
            "approve",
            "review-model",
            "review-publish"
        ]);
        assert.equal(review.jobs["review-publish"].needs, "review-model");
        assert.ok(
            review.jobs["review-model"].if.includes(
                "head.repo.full_name == github.repository"
            )
        );
        assert.ok(review.jobs["review-model"].if.includes("dependabot[bot]"));
    });
    it("checks admission using pinned checkout without dynamic loaders", function () {
        assert.ok(!source.includes("raw.githubusercontent"));
        assert.ok(!source.includes("new Function"));
        const model = review.jobs["review-model"];
        assert.equal(
            model.steps.find((s) => s.id === "admit").run,
            "node scripts/bot/head-check.js"
        );
        for (const id of ["model", "request"])
            assert.equal(
                model.steps.find((s) => s.id === id).if,
                "steps.admit.outputs.current == 'true'"
            );
        for (const job of Object.values(review.jobs)) {
            const checkout = job.steps.find((s) =>
                s.uses?.startsWith("actions/checkout@")
            );
            assert.equal(
                checkout.with.ref,
                "${{ github.event.pull_request.head.sha }}"
            );
            assert.equal(checkout.with["persist-credentials"], false);
        }
    });
    it("preserves failed model artifacts and returns receipts within publication", function () {
        const model = review.jobs["review-model"];
        const publish = review.jobs["review-publish"];
        assert.ok(
            model.steps
                .find((s) => s.id === "result")
                .if.includes("steps.model.outcome == 'failure'")
        );
        assert.ok(
            publish.if.includes("needs.review-model.result == 'failure'")
        );
        const receipt = publish.steps.find((s) =>
            s.run?.includes("scripts/bot/persist.js")
        );
        assert.ok(receipt.if.includes("!cancelled()"));
        assert.ok(receipt.if.includes("superseded"));
        assert.ok(
            !publish.steps.some((s) =>
                s.uses?.startsWith("actions/upload-artifact")
            )
        );
        assert.equal(
            model.steps.find((s) => s.id === "result").with["retention-days"],
            1
        );
        for (const job of Object.values(review.jobs))
            assert.equal(job.permissions.actions, "read");
    });
    it("keeps worker credentials away from setup and publisher tokens away from model steps", function () {
        for (const [name, job] of Object.entries(review.jobs)) {
            assert.equal(job.env, undefined);
            assert.equal(
                job.permissions["pull-requests"] === "write",
                name === "review-publish" || name === "approve"
            );
            assert.equal(
                job.permissions.issues === "write",
                name === "review-publish"
            );
            for (const step of job.steps) {
                if (step.uses || step.run?.includes("yarn install"))
                    assert.equal(step.env, undefined);
                if (step.env?.SCP_TEST_POOL_SECRET)
                    assert.equal(
                        step.env.SCP_TEST_ORCHESTRATOR_SEED,
                        "${{ secrets.SCP_TEST_ORCHESTRATOR_SEED }}"
                    );
                if (
                    step.run?.includes("yarn review-bot:review") ||
                    step.run?.includes("scripts/bot/persist.js")
                )
                    assert.equal(step.env?.GITHUB_TOKEN, undefined);
                if (step.run?.includes("yarn install"))
                    assert.ok(step.run.includes("--ignore-scripts"));
            }
        }
    });
});
