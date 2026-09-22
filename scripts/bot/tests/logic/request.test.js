const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gitFixture } = require("../fixtures/git");
const { policyDigest, DEFAULTS } = require("../../config");
const { clientPublicKey } = require("../../identity");

describe("review CI request setup", function () {
    it("binds the existing caller and built-in policy through the real request command", async function () {
        await gitFixture(async ({ root, source, input, command }) => {
            await fs.mkdir(path.join(source, "scripts/bot"), {
                recursive: true
            });
            await fs.writeFile(
                path.join(source, "scripts/bot/version.txt"),
                "fixture revision"
            );
            command(source, ["add", "scripts/bot"]);
            command(source, ["commit", "-m", "Bot fixture"]);
            const head = command(source, ["rev-parse", "HEAD"]);
            const repository = { id: 1, full_name: "owner/repo" };
            const event = path.join(root, "event.json");
            await fs.writeFile(
                event,
                JSON.stringify({
                    repository,
                    pull_request: {
                        number: 6,
                        head: { sha: head, repo: repository },
                        base: { sha: input.base }
                    }
                })
            );
            const output = path.join(root, "outputs");
            const file = path.join(root, "request.json");
            const resolvedFile = path.join(root, "resolved.json");
            await fs.writeFile(
                resolvedFile,
                JSON.stringify([{ id: "thread1", comments: [1, 2] }])
            );
            const environment = {
                PATH: process.env.PATH,
                GITHUB_ACTIONS: "true",
                GITHUB_EVENT_PATH: event,
                GITHUB_ACTOR: "maintainer",
                GITHUB_RUN_ID: "123",
                GITHUB_REPOSITORY_ID: "873087994",
                GITHUB_RUN_ATTEMPT: "1",
                GITHUB_OUTPUT: output,
                SCP_TEST_ORCHESTRATOR_SEED: "12".repeat(32)
            };
            execFileSync(
                process.execPath,
                [
                    path.resolve(__dirname, "../../request.js"),
                    file,
                    resolvedFile
                ],
                {
                    cwd: source,
                    env: environment,
                    stdio: "pipe"
                }
            );
            const request = JSON.parse(await fs.readFile(file, "utf8"));
            assert.equal(request.policyDigest, policyDigest(DEFAULTS));
            assert.deepEqual(request.resolvedThreads, [
                { id: "thread1", comments: [1, 2] }
            ]);
            assert.equal(request.caller, clientPublicKey(environment));
            assert.equal(
                await fs.readFile(output, "utf8"),
                `caller=${request.caller}\n`
            );
            assert.equal(request.head, head);
            assert.equal(request.botRevision, head);
            assert.ok(
                !(await fs.readFile(file, "utf8")).includes(
                    environment.SCP_TEST_ORCHESTRATOR_SEED
                )
            );
        });
    });
    it("rejects unrelated fields in review policy", function () {
        assert.throws(() => policyDigest({ approvalToolsDigest: "unrelated" }));
    });
});
