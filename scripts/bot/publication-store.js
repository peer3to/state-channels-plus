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
    async read(request) {
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
    project(journal) {
        return {
            states: journal.states.map((state, index) =>
                index === journal.states.length - 1
                    ? state
                    : {
                          snapshotDigest: state.snapshotDigest || digest(state),
                          version: state.version,
                          repositoryId: state.repositoryId,
                          pr: state.pr,
                          head: state.head,
                          round: state.round,
                          status: state.status,
                          findings: state.findings.map(({ id }) => ({ id })),
                          mappings: state.mappings || {},
                          actions: []
                      }
            )
        };
    }
    async load(request) {
        return this.project(await this.read(request));
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
            const stored = await this.read(request);
            const current = this.project(stored);
            const next = this.project({ states });
            if (digest(current) === digest(next)) return next;
            check(digest(current) === previous, "INVALID_RESULT");
            await writeJson(
                this.root,
                `${request.repository.id}-${request.pr}-publication.json`,
                {
                    states: states.map((state, index) => {
                        const historical = stored.states.find(
                            (entry) =>
                                entry.head === state.head &&
                                digest(
                                    this.project({
                                        states: [entry, states.at(-1)]
                                    }).states[0]
                                ) === digest(next.states[index])
                        );
                        if (
                            index < states.length - 1 &&
                            stored.states.some(
                                (entry) => entry.head === state.head
                            )
                        )
                            check(historical, "INVALID_RESULT");
                        if (index < states.length - 1 && historical) {
                            check(
                                digest(
                                    this.project({
                                        states: [historical, states.at(-1)]
                                    }).states[0]
                                ) === digest(next.states[index]),
                                "INVALID_RESULT"
                            );
                            return historical;
                        }
                        return state;
                    })
                }
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
            setupMs: 60000
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
