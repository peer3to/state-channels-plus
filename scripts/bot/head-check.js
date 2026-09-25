const fs = require("node:fs/promises");
const { check } = require("./data");
const { GitHubWriter } = require("./github-write");
async function admit(event, actor, token, exchange = fetch) {
    const pull = event.pull_request;
    if (!pull || !event.repository?.id || !pull.head?.sha || !pull.number)
        return { current: false, eligible: false, reason: "NO_PR" };
    const repository = {
        id: event.repository.id,
        name: event.repository.full_name
    };
    check(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository.name));
    try {
        const owner = new GitHubWriter(
            { repository, pr: pull.number },
            { token, botId: 1, exchange, maxCalls: 1 }
        );
        const fresh = await owner.api(`/pulls/${pull.number}`);
        check(
            fresh.number === pull.number &&
                fresh.base?.repo?.id === repository.id &&
                /^[a-f0-9]{40}$/.test(fresh.head?.sha || "")
        );
        return {
            current: fresh.head.sha === pull.head.sha,
            eligible:
                pull.head.repo?.id === repository.id &&
                actor !== "dependabot[bot]",
            head: pull.head.sha,
            repository,
            pr: pull.number
        };
    } catch {
        const error = new Error(
            "Could not obtain the latest PR head; CI admission failed."
        );
        error.code = "ADMISSION_LOOKUP_FAILED";
        throw error;
    }
}
async function main() {
    const event = JSON.parse(
        await fs.readFile(process.env.GITHUB_EVENT_PATH, "utf8")
    );
    const result = await admit(
        event,
        process.env.GITHUB_ACTOR,
        process.env.GITHUB_TOKEN
    );
    if (process.env.GITHUB_OUTPUT)
        await fs.appendFile(
            process.env.GITHUB_OUTPUT,
            `current=${result.current}\neligible=${result.eligible}\nhead=${result.head || ""}\n`
        );
    console.log(
        result.current
            ? "Current PR head admitted."
            : "Stale or missing PR head; substantive work skipped."
    );
}
if (require.main === module)
    main().catch((error) => {
        console.error(
            `${error.code || "ADMISSION_LOOKUP_FAILED"}: Could not obtain the latest PR head; CI admission failed.`
        );
        process.exitCode = 1;
    });
module.exports = { admit };
