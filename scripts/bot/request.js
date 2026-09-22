const fs = require("node:fs/promises");
const path = require("node:path");
const { digest, check } = require("./data");
const { request } = require("./protocol");
const { clientPublicKey } = require("./identity");
const { policyDigest } = require("./config");
async function bundleDigest(root) {
    const files = [];
    async function walk(relative) {
        const entries = await fs.readdir(path.join(root, relative), {
            withFileTypes: true
        });
        for (const entry of entries.sort((a, b) =>
            a.name.localeCompare(b.name)
        )) {
            check(!entry.isSymbolicLink());
            const name = path.join(relative, entry.name);
            if (entry.isDirectory()) await walk(name);
            else {
                check(entry.isFile());
                files.push([
                    name,
                    digest(await fs.readFile(path.join(root, name)))
                ]);
            }
        }
    }
    await walk("");
    return digest(files);
}
function buildRequest(bound) {
    return request({ version: 1, ...bound });
}
module.exports = { buildRequest, bundleDigest };
async function main() {
    const { git } = require("./worktrees");
    const { writeJson } = require("./data");
    const event = JSON.parse(
        await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8")
    );
    const pull = event.pull_request;
    check(
        pull &&
            pull.head.repo.id === event.repository.id &&
            process.env.GITHUB_ACTOR !== "dependabot[bot]",
        "UNAUTHORIZED"
    );
    const root = process.cwd();
    const input = buildRequest({
        repository: {
            id: event.repository.id,
            name: event.repository.full_name
        },
        pr: pull.number,
        head: pull.head.sha,
        base: pull.base.sha,
        mergeBase: git(["merge-base", pull.head.sha, pull.base.sha], root),
        attempt: `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`,
        run: {
            id: Number(process.env.GITHUB_RUN_ID),
            attempt: Number(process.env.GITHUB_RUN_ATTEMPT)
        },
        caller: clientPublicKey(),
        mode: "ci",
        botRevision: git(
            ["log", "-1", "--format=%H", "--", "scripts/bot"],
            root
        ),
        skillDigest: await bundleDigest(path.join(__dirname, "skill")),
        policyDigest: policyDigest(),
        runtime: "codex-0.154.0",
        operations: ["review", "propose-replies"],
        readScope: ["source", "discussion", "reviews"]
    });
    const output = process.argv[2];
    if (process.argv[3])
        input.resolvedThreads = JSON.parse(
            await fs.readFile(process.argv[3], "utf8")
        );
    request(input);
    check(output);
    const directory = path.dirname(path.resolve(output));
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await writeJson(directory, path.basename(output), input);
    if (process.env.GITHUB_OUTPUT)
        await fs.appendFile(
            process.env.GITHUB_OUTPUT,
            `caller=${input.caller}\n`
        );
}
if (require.main === module)
    main().catch((error) => {
        console.error(require("./errors").sanitized(error).message);
        process.exitCode = 1;
    });
