const fs = require("node:fs/promises");
const path = require("node:path");
const { check, ownedPath, writeJson, digest } = require("./data");
const protocol = require("./protocol");
const { GitHubWriter } = require("./github-write");
const { MESSAGES, sanitized } = require("./errors");
async function handoffDigest(root) {
    const names = (await fs.readdir(root)).sort();
    const records = [];
    for (const name of names) {
        check(
            [
                "request.json",
                "result.json",
                "inspection.json",
                "publication.json"
            ].includes(name),
            "INVALID_RESULT"
        );
        const file = await ownedPath(root, name);
        const stat = await fs.stat(file);
        check(stat.isFile() && stat.size <= 4 * 1024 * 1024, "INVALID_RESULT");
        records.push({
            name,
            content: (await fs.readFile(file)).toString("base64")
        });
    }
    return digest(records);
}
async function validateHandoff({
    kind,
    artifactId,
    expectedDigest,
    source,
    destination,
    event,
    runId,
    attempt,
    token,
    exchange = fetch
}) {
    check(
        kind === "result" && Number.isSafeInteger(artifactId) && artifactId > 0
    );
    const repository = {
        id: event.repository.id,
        name: event.repository.full_name
    };
    const reader = new GitHubWriter(
        { repository, pr: event.pull_request.number },
        { token, botId: 1, exchange }
    );
    const artifact = await reader.api(`/actions/artifacts/${artifactId}`);
    const expectedName = `review-${runId}-${attempt}-${kind}`;
    check(
        artifact.id === artifactId &&
            artifact.name === expectedName &&
            artifact.workflow_run?.id === runId,
        "UNAUTHORIZED"
    );
    let root = source;
    const downloaded = await fs.readdir(source);
    if (downloaded.includes(expectedName)) {
        check(downloaded.length === 1, "INVALID_RESULT");
        root = await ownedPath(source, expectedName);
    }
    check(
        /^[a-f0-9]{64}$/.test(expectedDigest || "") &&
            (await handoffDigest(root)) === expectedDigest,
        "INVALID_RESULT"
    );
    const names = await fs.readdir(root);
    check(
        names.every((name) =>
            [
                "request.json",
                "result.json",
                "inspection.json",
                "publication.json"
            ].includes(name)
        ),
        "INVALID_RESULT"
    );
    const read = async (name) => {
        const file = await ownedPath(root, name);
        const stat = await fs.stat(file);
        check(stat.isFile() && stat.size <= 4 * 1024 * 1024, "INVALID_RESULT");
        return JSON.parse(await fs.readFile(file, "utf8"));
    };
    const request = protocol.request(await read("request.json"));
    check(
        request.repository.id === repository.id &&
            request.repository.name === repository.name &&
            request.pr === event.pull_request.number &&
            request.head === event.pull_request.head.sha &&
            request.run.id === runId &&
            request.run.attempt === attempt,
        "UNAUTHORIZED"
    );
    const result = await read("result.json");
    if (result.code) {
        protocol.failureResult(result, request);
    } else protocol.result(result, request);
    await fs.mkdir(destination, { recursive: true, mode: 0o700 });
    await writeJson(destination, "request.json", request);
    await writeJson(destination, "result.json", result);
}
async function main() {
    const [kind, id, source, destination] = process.argv.slice(2);
    if (kind === "digest") {
        console.log(`digest=${await handoffDigest(id)}`);
        return;
    }
    const event = JSON.parse(
        await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8")
    );
    await validateHandoff({
        kind,
        artifactId: Number(id),
        expectedDigest: process.env.REVIEW_HANDOFF_DIGEST,
        source,
        destination,
        event,
        runId: Number(process.env.GITHUB_RUN_ID),
        attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
        token: process.env.GITHUB_TOKEN
    });
}
if (require.main === module)
    main().catch((error) => {
        console.error(sanitized(error).message);
        process.exitCode = 1;
    });
module.exports = { validateHandoff, handoffDigest };
