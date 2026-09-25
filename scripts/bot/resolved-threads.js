const fs = require("node:fs/promises");
const path = require("node:path");
const { GitHubWriter, actionsBotId } = require("./github-write");
const { check, writeJson } = require("./data");

async function resolvedThreads(reader) {
    return (await reader.threads({ idsOnly: true }))
        .filter((thread) => thread.isResolved)
        .map((thread) => ({
            id: thread.id,
            comments: thread.comments.nodes.map((comment) => comment.databaseId)
        }));
}
module.exports = { resolvedThreads };
async function main() {
    const event = JSON.parse(
        await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8")
    );
    check(
        event.pull_request &&
            event.pull_request.head.repo.id === event.repository.id,
        "UNAUTHORIZED"
    );
    const reader = new GitHubWriter(
        {
            repository: {
                id: event.repository.id,
                name: event.repository.full_name
            },
            pr: event.pull_request.number
        },
        {
            token: process.env.GITHUB_TOKEN,
            botId: await actionsBotId(process.env.GITHUB_TOKEN)
        }
    );
    const output = path.resolve(process.argv[2]);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await writeJson(
        path.dirname(output),
        path.basename(output),
        await resolvedThreads(reader)
    );
}
if (require.main === module)
    main().catch((error) => {
        console.error(require("./errors").sanitized(error).message);
        process.exitCode = 1;
    });
