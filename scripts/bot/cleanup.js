const fs = require("node:fs/promises");
const path = require("node:path");
const { check, ownedPath, writeJson } = require("./data");
const { ContextBudget, PublicGitHub } = require("./github-read");
const { sanitized } = require("./errors");
const { sessionProviderOf } = require("./sessions");
const { removeWorkspace } = require("./workspace");
class LifecycleCleanup {
    worktrees;
    sessions;
    repositories;
    limits;
    deleteNative;
    exchange;
    accounting;
    constructor({
        worktrees,
        sessions,
        repositories,
        limits,
        deleteNative,
        exchange = fetch,
        accounting
    }) {
        Object.assign(this, {
            worktrees,
            sessions,
            repositories,
            limits,
            deleteNative,
            exchange,
            accounting
        });
    }
    async records() {
        const records = [];
        for (const name of await fs.readdir(this.worktrees.root)) {
            if (!/^pr-[1-9][0-9]*-[1-9][0-9]*\.json$/.test(name)) continue;
            const file = await ownedPath(this.worktrees.root, name);
            const record = JSON.parse(await fs.readFile(file, "utf8"));
            check(name === `pr-${record.repositoryId}-${record.pr}.json`);
            records.push(record);
        }
        return records;
    }
    async run() {
        const records = await this.records();
        const repositories = this.repositories || [
            ...new Map(
                records
                    .filter((record) =>
                        /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(
                            record.repositoryName || ""
                        )
                    )
                    .map((record) => [
                        record.repositoryId,
                        { id: record.repositoryId, name: record.repositoryName }
                    ])
            ).values()
        ];
        const budget = new ContextBudget(
            this.limits,
            this.accounting,
            this.limits.cleanupMs
        );
        const summary = {
            registered: records.length,
            resolved: 0,
            open: 0,
            closed: 0,
            merged: 0,
            deleted: 0,
            deferred: 0,
            unknown: 0,
            requests: 0,
            pages: 0,
            reasons: []
        };
        for (const repository of repositories) {
            const group = records.filter(
                (record) => record.repositoryId === repository.id
            );
            if (!group.length) continue;
            const reader = new PublicGitHub(
                repository,
                null,
                budget,
                this.exchange
            );
            let pulls;
            try {
                pulls = await reader.pages(
                    `https://api.github.com/repos/${repository.name}/pulls?state=all&per_page=100`
                );
            } catch (error) {
                summary.unknown += group.length;
                summary.reasons.push(sanitized(error).code);
                continue;
            }
            for (const record of group) {
                const pull = pulls.find(
                    (item) =>
                        item.number === record.pr &&
                        item.base?.repo?.id === record.repositoryId
                );
                if (!pull || !["open", "closed"].includes(pull.state)) {
                    summary.unknown++;
                    continue;
                }
                summary.resolved++;
                if (pull.state === "open") {
                    summary.open++;
                    continue;
                }
                if (pull.merged_at) summary.merged++;
                else summary.closed++;
                const key = `${record.repositoryId}-${record.pr}`;
                if (this.sessions.busy(key)) {
                    summary.deferred++;
                    continue;
                }
                try {
                    const deleted = await this.sessions.maintain(
                        key,
                        async () => {
                            const fresh = await reader.read(
                                `https://api.github.com/repos/${repository.name}/pulls/${record.pr}`
                            );
                            if (
                                fresh.data.number !== record.pr ||
                                fresh.data.base?.repo?.id !==
                                    record.repositoryId ||
                                fresh.data.state !== "closed"
                            )
                                return false;
                            const manifest = await ownedPath(
                                this.worktrees.root,
                                `${record.relative}.json`
                            );
                            check(
                                JSON.stringify(
                                    JSON.parse(
                                        await fs.readFile(manifest, "utf8")
                                    )
                                ) === JSON.stringify(record)
                            );
                            const previous = this.sessions.previous.get(key);
                            if (previous?.sessionId && !record.nativeDeleted) {
                                await this.deleteNative(
                                    previous.sessionId,
                                    sessionProviderOf(previous)
                                );
                                record.nativeDeleted = true;
                                await writeJson(
                                    this.worktrees.root,
                                    `${record.relative}.json`,
                                    record
                                );
                            }
                            await this.worktrees.remove(record, true);
                            await removeWorkspace(
                                path.dirname(this.worktrees.root),
                                key
                            );
                            await this.sessions.removeRecords(key);
                            await fs.unlink(manifest);
                            return true;
                        }
                    );
                    if (deleted) summary.deleted++;
                    else summary.deferred++;
                } catch (error) {
                    summary.deferred++;
                    summary.reasons.push(sanitized(error).code);
                }
            }
        }
        summary.unknown += records.filter(
            (record) =>
                !repositories.some(
                    (repository) => repository.id === record.repositoryId
                )
        ).length;
        summary.requests = budget.requests;
        summary.pages = budget.pages;
        return summary;
    }
}
module.exports = { LifecycleCleanup };

async function main() {
    const { configuration } = require("./config");
    const { Sessions } = require("./sessions");
    const { Worktrees } = require("./worktrees");
    const { createAdapter } = require("./adapters");
    const {
        acquireOsFileLock
    } = require("../e2e-parallel/distributed/hostLock");
    const config = configuration({
        stateRoot: path.resolve(process.argv[2], "review")
    });
    const lock = acquireOsFileLock(
        path.join(config.stateRoot, "service.lock"),
        "Stop the review service before manual cleanup."
    );
    const sessions = new Sessions(
        path.join(config.stateRoot, "sessions"),
        config.limits
    );
    const worktrees = new Worktrees(path.join(config.stateRoot, "worktrees"));
    try {
        await sessions.initialize();
        await worktrees.initialize();
        const cleanup = new LifecycleCleanup({
            sessions,
            worktrees,
            repositories: null,
            limits: config.limits,
            deleteNative: async (id, provider) => {
                const adapter = createAdapter(
                    { ...config, provider },
                    { close: async () => {} }
                );
                try {
                    await adapter.open({ modelAccess: false });
                    await adapter.delete(id);
                } finally {
                    await adapter.stop();
                }
            }
        });
        console.log(JSON.stringify(await cleanup.run()));
    } finally {
        await sessions.close();
        lock.release();
    }
}
if (require.main === module)
    main().catch((error) => {
        console.error(sanitized(error).message);
        process.exitCode = 1;
    });
