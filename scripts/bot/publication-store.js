const fs = require("node:fs/promises");
const { check, digest, ownedPath, writeJson } = require("./data");

// Private worker journal. A compare-and-swap prevents stale CI deliveries from
// replacing a newer publication; identical retries are safe after lost replies.
class PublicationStore {
    root;
    pending = Promise.resolve();
    constructor(root) {
        this.root = root;
    }
    async load(request) {
        const name = `${request.repository.id}-${request.pr}-publication.json`;
        try {
            return JSON.parse(
                await fs.readFile(await ownedPath(this.root, name), "utf8")
            );
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            return { states: [] };
        }
    }
    save(request, previous, states) {
        const task = this.pending.then(async () => {
            check(Array.isArray(states), "INVALID_RESULT");
            for (const state of states) {
                check(
                    state.repositoryId === request.repository.id &&
                        state.pr === request.pr &&
                        /^[a-f0-9]{40}$/.test(state.head) &&
                        Number.isSafeInteger(state.round) &&
                        state.round > 0 &&
                        ["intent", "partial", "complete"].includes(
                            state.status
                        ) &&
                        Array.isArray(state.findings) &&
                        Array.isArray(state.actions),
                    "INVALID_RESULT"
                );
            }
            const current = await this.load(request);
            const next = { states };
            if (digest(current) === digest(next)) return next;
            check(digest(current) === previous, "INVALID_RESULT");
            await writeJson(
                this.root,
                `${request.repository.id}-${request.pr}-publication.json`,
                next
            );
            return next;
        });
        this.pending = task.catch(() => {});
        return task;
    }
}

async function withPublicationStore(request, executionId, body) {
    const { callService } = require("./client");
    const { clientSeed } = require("./identity");
    const { DEFAULTS } = require("./config");
    return callService({
        request,
        operation: "publication",
        stateRoot: process.env.SCP_REVIEW_CLIENT_STATE,
        secret: process.env.SCP_TEST_POOL_SECRET,
        seed: clientSeed(),
        limits: {
            ...DEFAULTS,
            queueMs: 60000,
            setupMs: 60000,
            modelMs: 1,
            validationMs: 1
        },
        interact: async (send) => {
            const call = async (payload) =>
                (await send({ executionId, ...payload })).publication;
            return body({
                load: () => call({}),
                save: (_request, previous, states) => call({ previous, states })
            });
        }
    });
}
module.exports = { PublicationStore, withPublicationStore };
