const crypto = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs/promises");
const { performance } = require("node:perf_hooks");
const { ModelBudget } = require("./timing");
const { check, digest, writeJson, ownedPath } = require("./data");
const { ReviewError, sanitized } = require("./errors");
const protocol = require("./protocol");
class Sessions {
    root;
    limits;
    // Canonical repository/PR keys own exclusive execution and pending requests.
    slots = new Map();
    // Caller/attempt keys retain immutable bound delivery records for reconnects.
    attempts = new Map();
    // Correction digests retain immutable corrected deliveries across reconnects.
    corrections = new Map();
    running = 0;
    stopping = false;
    failures = [];
    previous = new Map();
    constructor(root, limits) {
        this.root = root;
        this.limits = limits;
    }
    async initialize() {
        await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
        await fs.mkdir(path.join(this.root, "attempts"), {
            recursive: true,
            mode: 0o700
        });
        await fs.mkdir(path.join(this.root, "corrections"), {
            recursive: true,
            mode: 0o700
        });
        for (const name of await fs.readdir(
            path.join(this.root, "corrections")
        )) {
            if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
            const saved = JSON.parse(
                await fs.readFile(
                    await ownedPath(this.root, `corrections/${name}`),
                    "utf8"
                )
            );
            protocol.request(saved.request);
            protocol.correction(saved.correction, saved.request);
            protocol.result(saved.result, saved.request);
            check(name === `${digest(saved.correction)}.json`);
            this.corrections.set(name.slice(0, -5), saved);
        }
        for (const name of await fs.readdir(path.join(this.root, "attempts"))) {
            if (!/^[a-f0-9]{64}-[A-Za-z0-9_-]+\.json$/.test(name)) continue;
            const saved = JSON.parse(
                await fs.readFile(
                    await ownedPath(this.root, `attempts/${name}`),
                    "utf8"
                )
            );
            protocol.request(saved.request);
            check(
                name === `${this.attemptKey(saved.request)}.json` &&
                    saved.requestDigest === digest(saved.request)
            );
            if (saved.failure) {
                protocol.failureResult(saved.failure, saved.request);
                this.attempts.set(this.attemptKey(saved.request), {
                    request: saved.request,
                    requestDigest: saved.requestDigest,
                    failure: saved.failure
                });
                continue;
            }
            protocol.result(saved.result, saved.request);
            this.attempts.set(this.attemptKey(saved.request), {
                request: saved.request,
                requestDigest: saved.requestDigest,
                promise: Promise.resolve(saved.result)
            });
        }
        for (const name of await fs.readdir(this.root)) {
            if (!/^[1-9][0-9]*-[1-9][0-9]*\.json$/.test(name)) continue;
            const saved = JSON.parse(
                await fs.readFile(await ownedPath(this.root, name), "utf8")
            );
            const key = name.slice(0, -5);
            this.previous.set(key, saved);
            if (saved.request && saved.result && saved.sessionId)
                await this.baseline(saved.request);
            if (saved.status !== "released")
                this.slots.set(key, {
                    active: {
                        id: saved.executionId,
                        unavailable: true,
                        closed: false,
                        budget: { active: null, terminationFailed: true },
                        deliveries: [],
                        effective: saved.effective
                    },
                    pending: []
                });
        }
    }
    key(request) {
        return `${request.repository.id}-${request.pr}`;
    }
    attemptKey(request) {
        return `${request.caller}-${request.attempt}`;
    }
    async submit(request, evidenceIdentity, execute, isFresh) {
        protocol.request(request);
        check(!this.stopping, "SERVICE_UNAVAILABLE");
        const attemptKey = this.attemptKey(request);
        const previous = this.attempts.get(attemptKey);
        if (previous) {
            check(previous.requestDigest === digest(request));
            if (previous.failure) {
                const error = new ReviewError(previous.failure.code);
                error.diagnostics = previous.failure.diagnostics;
                throw error;
            }
            return previous.promise;
        }
        const effective = protocol.effectiveIdentity(request, evidenceIdentity);
        let resolve, reject;
        const promise = new Promise((yes, no) => {
            resolve = yes;
            reject = no;
        });
        const delivery = {
            request,
            requestDigest: digest(request),
            promise,
            resolve,
            reject
        };
        this.attempts.set(attemptKey, delivery);
        const key = this.key(request);
        const slot = this.slots.get(key) || { active: null, pending: [] };
        this.slots.set(key, slot);
        if (slot.active?.unavailable) {
            this.attempts.delete(attemptKey);
            throw new ReviewError("SERVICE_UNAVAILABLE");
        }
        const candidate = {
            delivery,
            effective,
            execute,
            isFresh,
            timer: null
        };
        const active = slot.active;
        if (
            active &&
            (active.result
                ? active.effective === effective
                : protocol.effectiveIdentity(
                      active.deliveries[0].request,
                      evidenceIdentity
                  ) === effective) &&
            !active.closed &&
            !active.budget.terminationFailed
        ) {
            // An unfinished review has no completed evidence snapshot to reuse.
            // Equivalent deliveries join its work, including during setup.
            let fresh = !active.result;
            if (active.result) {
                try {
                    fresh = await isFresh(active);
                } catch {
                    /* Unknown freshness queues a separate review. */
                }
            }
            if (fresh && slot.active === active && !active.closed) {
                active.deliveries.push(delivery);
                if (active.result) await this.deliver(active, delivery);
                return promise;
            }
        }
        const pendingCount = [...this.slots.values()].reduce(
            (count, owner) => count + owner.pending.length,
            0
        );
        if (pendingCount >= this.limits.maxPending) {
            this.attempts.delete(attemptKey);
            throw new ReviewError("BUSY");
        }
        candidate.timer = setTimeout(() => {
            const index = slot.pending.indexOf(candidate);
            if (index >= 0) {
                slot.pending.splice(index, 1);
                this.rejectDelivery(
                    delivery,
                    new ReviewError("QUEUE_TIMEOUT")
                ).catch((error) => this.failures.push(error));
            }
        }, this.limits.queueMs);
        slot.pending.push(candidate);
        this.drain(key).catch(reject);
        return promise;
    }
    async drain(key) {
        const slot = this.slots.get(key);
        if (
            !slot ||
            slot.active ||
            !slot.pending.length ||
            this.stopping ||
            this.running >= this.limits.concurrency
        )
            return;
        const candidate = slot.pending.shift();
        clearTimeout(candidate.timer);
        const execution = {
            id: crypto.randomUUID(),
            effective: candidate.effective,
            deliveries: [candidate.delivery],
            budget: new ModelBudget(this.limits.modelMs),
            correctionUsed: false,
            revision: 0,
            result: null,
            // Setup failures must not discard the PR's existing conversation.
            sessionId: this.previous.get(key)?.sessionId || null,
            closed: false,
            timer: null,
            validationStarted: null,
            validationMs: 0
        };
        slot.active = execution;
        this.running++;
        try {
            if (!(await candidate.isFresh(null)))
                throw new ReviewError("STALE_HEAD");
            await this.baseline(candidate.delivery.request);
            await this.persist(key, execution);
            execution.result = await candidate.execute(execution);
            await this.persist(key, execution);
            if (
                execution.deliveries.some(
                    (entry) => entry.request.mode === "ci"
                )
            ) {
                execution.validationStarted = performance.now();
                execution.timer = setTimeout(
                    () =>
                        this.finish(key, execution.id).catch((error) =>
                            this.failures.push(error)
                        ),
                    this.limits.validationMs
                );
            }
            for (const delivery of execution.deliveries)
                await this.deliver(execution, delivery);
            if (!execution.timer) await this.finish(key, execution.id);
        } catch (error) {
            for (const delivery of execution.deliveries)
                await this.rejectDelivery(delivery, error);
            if (execution.budget.terminationFailed) {
                execution.unavailable = true;
                await this.persist(key, execution);
            } else await this.finish(key, execution.id);
        }
    }
    async rejectDelivery(delivery, error) {
        const failure = protocol.failure(sanitized(error), delivery.request);
        delivery.failure = failure;
        try {
            await writeJson(
                this.root,
                `attempts/${this.attemptKey(delivery.request)}.json`,
                {
                    request: delivery.request,
                    requestDigest: delivery.requestDigest,
                    failure
                }
            );
        } catch (persistenceError) {
            this.failures.push(sanitized(persistenceError));
        }
        delivery.reject(error);
    }
    async deliver(execution, delivery) {
        const output = structuredClone(execution.result);
        output.binding = protocol.binding(delivery.request);
        output.executionId = execution.id;
        output.effectiveIdentity = execution.effective;
        output.revision = execution.revision;
        await writeJson(
            this.root,
            `attempts/${this.attemptKey(delivery.request)}.json`,
            {
                request: delivery.request,
                requestDigest: delivery.requestDigest,
                result: output
            }
        );
        delivery.resolve(output);
    }
    async persist(key, execution) {
        await writeJson(this.root, `${key}.json`, {
            executionId: execution.id,
            effective: execution.effective,
            request: execution.request,
            nativeProcessPid: execution.nativeProcessPid,
            sessionId: execution.sessionId,
            revision: execution.revision,
            correctionUsed: execution.correctionUsed,
            modelMs: execution.budget.consumed,
            validationMs: execution.validationMs,
            status: execution.unavailable
                ? "termination-unverified"
                : execution.closed
                  ? "released"
                  : "unpublished",
            result: execution.result
        });
    }
    async baseline(request) {
        const key = this.key(request);
        const read = async (name) => {
            try {
                return JSON.parse(
                    await fs.readFile(
                        await ownedPath(this.root, name, true),
                        "utf8"
                    )
                );
            } catch (error) {
                if (error.code === "ENOENT") return null;
                throw error;
            }
        };
        const recorded = await read(`${key}-baseline.json`);
        const previous = await read(`${key}.json`);
        // Older workers could acknowledge incomplete reports as published reviews.
        if (
            previous?.result &&
            (!recorded || recorded.head === previous.request?.head)
        ) {
            try {
                protocol.requireCompleteReview(previous.result);
            } catch {
                if (recorded)
                    await fs.rm(
                        await ownedPath(this.root, `${key}-baseline.json`),
                        { force: true }
                    );
                return null;
            }
        }
        if (recorded) return recorded;
        // Upgrade existing workers without discarding their last confirmed round.
        if (!previous?.result || !previous.request || !previous.sessionId)
            return null;
        const receipt = await read(
            `${key}-receipt-${previous.request.attempt}.json`
        );
        if (!receipt?.complete || receipt.kind !== "review") return null;
        protocol.request(previous.request);
        protocol.result(previous.result, previous.request);
        protocol.receipt(receipt, previous.request);
        const baseline = {
            head: previous.request.head,
            mergeBase: previous.request.mergeBase,
            sessionId: previous.sessionId,
            round: receipt.round
        };
        await writeJson(this.root, `${key}-baseline.json`, baseline);
        return baseline;
    }
    async correct(request, input, execute) {
        protocol.correction(input, request);
        const completed = this.corrections.get(digest(input));
        if (completed) {
            check(
                digest(completed.request) === digest(request),
                "UNAUTHORIZED"
            );
            return structuredClone(completed.result);
        }
        const key = this.key(request);
        const execution = this.slots.get(key)?.active;
        if (
            !execution ||
            execution.closed ||
            execution.id !== input.executionId
        )
            throw new ReviewError("VALIDATION_EXPIRED");
        check(
            execution.deliveries.some(
                (entry) =>
                    digest(entry.request) === digest(request) &&
                    entry.request.mode === "ci"
            ),
            "UNAUTHORIZED"
        );
        check(execution.effective === input.effectiveIdentity);
        const correctionId = digest(input);
        if (execution.correctionId === correctionId)
            return execution.correctionPromise;
        if (
            execution.correctionUsed ||
            execution.revision !== input.resultRevision
        )
            throw new ReviewError("ACCOUNTING_INCOMPLETE");
        execution.correctionUsed = true;
        execution.correctionId = correctionId;
        clearTimeout(execution.timer);
        execution.timer = null;
        execution.validationMs +=
            performance.now() - execution.validationStarted;
        execution.validationStarted = null;
        execution.correctionPromise = (async () => {
            try {
                await this.persist(key, execution);
                const corrected = await execute(
                    execution,
                    protocol.correctionPrompt(input, request)
                );
                execution.revision += 1;
                execution.result = structuredClone(corrected);
                await this.persist(key, execution);
                const result = structuredClone(corrected);
                Object.assign(result, {
                    binding: protocol.binding(request),
                    executionId: execution.id,
                    effectiveIdentity: execution.effective,
                    revision: execution.revision
                });
                const saved = { request, correction: input, result };
                await writeJson(
                    this.root,
                    `corrections/${correctionId}.json`,
                    saved
                );
                this.corrections.set(correctionId, saved);
                // Validation resumes within the original finite hold allowance.
                const left = this.limits.validationMs - execution.validationMs;
                if (left <= 0) throw new ReviewError("VALIDATION_EXPIRED");
                execution.validationStarted = performance.now();
                execution.timer = setTimeout(
                    () =>
                        this.finish(key, execution.id).catch((error) =>
                            this.failures.push(error)
                        ),
                    left
                );
                return result;
            } catch (error) {
                if (execution.budget.terminationFailed) {
                    execution.unavailable = true;
                    await this.persist(key, execution);
                } else await this.finish(key, execution.id);
                throw error;
            }
        })();
        return execution.correctionPromise;
    }
    async acknowledge(request, executionId, receipt) {
        const key = this.key(request),
            execution = this.slots.get(key)?.active;
        if (!execution || execution.id !== executionId) {
            const delivery = this.attempts.get(this.attemptKey(request));
            check(
                delivery &&
                    delivery.requestDigest === digest(request) &&
                    !delivery.failure,
                "UNAUTHORIZED"
            );
            const generated = await delivery.promise;
            check(generated.executionId === executionId, "UNAUTHORIZED");
            return this.maintain(key, () =>
                this.recordReceipt(request, generated, receipt)
            );
        }
        check(
            execution.deliveries.some(
                (entry) => digest(entry.request) === digest(request)
            ),
            "UNAUTHORIZED"
        );
        await this.recordReceipt(
            request,
            execution.result,
            receipt,
            execution.sessionId
        );
        await this.finish(key, executionId);
    }
    async recordReceipt(
        request,
        generated,
        receipt,
        sessionId = generated?.sessionId
    ) {
        if (!receipt) return;
        const key = this.key(request);
        protocol.receipt(receipt, request);
        await writeJson(
            this.root,
            `${key}-receipt-${request.attempt}.json`,
            receipt
        );
        if (receipt?.complete && receipt.kind === "review" && generated) {
            protocol.requireCompleteReview(generated);
            const previous = await this.baseline(request);
            if (previous && previous.round >= receipt.round) return;
            await writeJson(this.root, `${key}-baseline.json`, {
                head: request.head,
                mergeBase: request.mergeBase,
                sessionId,
                round: receipt.round
            });
        }
    }
    async finish(key, id) {
        const slot = this.slots.get(key),
            execution = slot?.active;
        if (!execution || execution.id !== id) return;
        if (execution.finishing) return execution.finishing;
        if (execution.closed) return;
        check(
            execution.budget.active === null &&
                !execution.budget.terminationFailed,
            "SERVICE_UNAVAILABLE"
        );
        clearTimeout(execution.timer);
        execution.finishing = (async () => {
            try {
                await execution.release?.();
            } catch (error) {
                execution.unavailable = true;
                await this.persist(key, execution);
                throw error;
            }
            if (execution.validationStarted !== null)
                execution.validationMs +=
                    performance.now() - execution.validationStarted;
            execution.closed = true;
            await this.persist(key, execution);
            this.previous.set(key, {
                sessionId: execution.sessionId,
                result: execution.result
            });
            slot.active = null;
            this.running--;
            for (const queuedKey of this.slots.keys())
                this.drain(queuedKey).catch((error) =>
                    this.failures.push(error)
                );
        })();
        return execution.finishing;
    }
    async maintain(key, operation) {
        check(!this.busy(key), "BUSY");
        const slot = this.slots.get(key) || { active: null, pending: [] };
        this.slots.set(key, slot);
        const maintenance = {
            unavailable: true,
            deliveries: [],
            budget: { active: null, terminationFailed: false }
        };
        slot.active = maintenance;
        try {
            return await operation();
        } finally {
            if (slot.active === maintenance) slot.active = null;
            this.drain(key).catch((error) => this.failures.push(error));
        }
    }
    async removeRecords(key) {
        check(/^[1-9][0-9]*-[1-9][0-9]*$/.test(key));
        for (const [attemptKey, delivery] of this.attempts) {
            if (!delivery.request || this.key(delivery.request) !== key)
                continue;
            await fs.rm(
                await ownedPath(this.root, `attempts/${attemptKey}.json`, true),
                { force: true }
            );
            this.attempts.delete(attemptKey);
        }
        for (const [id, saved] of this.corrections) {
            if (this.key(saved.request) !== key) continue;
            await fs.rm(await ownedPath(this.root, `corrections/${id}.json`), {
                force: true
            });
            this.corrections.delete(id);
        }
        for (const name of await fs.readdir(this.root)) {
            if (
                name === `${key}.json` ||
                name === `${key}-baseline.json` ||
                name === `${key}-publication.json` ||
                (name.startsWith(`${key}-receipt-`) && name.endsWith(".json"))
            )
                await fs.rm(await ownedPath(this.root, name), { force: true });
        }
        this.previous.delete(key);
    }
    busy(key) {
        const slot = this.slots.get(key);
        return Boolean(slot?.active || slot?.pending.length);
    }
    async close() {
        this.stopping = true;
        for (const [key, slot] of this.slots) {
            for (const candidate of slot.pending.splice(0)) {
                clearTimeout(candidate.timer);
                candidate.delivery.reject(
                    new ReviewError("SERVICE_UNAVAILABLE")
                );
            }
            if (slot.active && !slot.active.unavailable) {
                check(
                    slot.active.budget.active === null,
                    "SERVICE_UNAVAILABLE"
                );
                await this.finish(key, slot.active.id);
            }
        }
    }
}
module.exports = { Sessions };
