const { spawn } = require("node:child_process");
const { EventEmitter } = require("node:events");
const { check } = require("../data");
const { ReviewError, sanitized } = require("../errors");
// Milliseconds left for one setup step before the shared setup deadline.
function setupTimeout(deadline, maximum = 30000) {
    if (deadline === null) return maximum;
    const remaining = deadline - performance.now();
    check(remaining > 0, "SETUP_TIMEOUT");
    return Math.max(1, Math.min(maximum, Math.ceil(remaining)));
}
// Stops the native process tree and closes the source tools within one limit.
async function stopNative(child, tools, terminationMs) {
    let timer;
    try {
        await Promise.race([
            Promise.all([child?.stop(terminationMs), tools.close?.()]),
            new Promise((_, reject) => {
                timer = setTimeout(
                    () => reject(new ReviewError("SERVICE_UNAVAILABLE")),
                    terminationMs
                );
            })
        ]);
    } finally {
        clearTimeout(timer);
    }
}
// Provider-neutral text for a recoverable tool failure; throws when fail-closed.
function toolFailureText(error) {
    // Only tool-local input/availability failures are recoverable. Transport
    // identity checks and infrastructure/budget failures remain fail-closed.
    if (
        !(error instanceof ReviewError) ||
        ![
            "INVALID_REQUEST",
            "UNAUTHORIZED",
            "CONTEXT_UNAVAILABLE",
            "BUSY"
        ].includes(error.code)
    )
        throw error;
    const safe = sanitized(error);
    return JSON.stringify({
        error: { code: safe.code, message: safe.message },
        guidance:
            "This tool request failed; it supplied no evidence. Use permitted requests or correct the arguments. Keep coverage incomplete if required evidence remains unavailable."
    });
}
// Runs one source tool and returns its provider-neutral outcome.
async function runTool(tools, name, input, maxBytes) {
    let value;
    try {
        value = await tools.call(name, input);
    } catch (error) {
        return { success: false, text: toolFailureText(error) };
    }
    const output = JSON.stringify(value);
    check(Buffer.byteLength(output) <= maxBytes, "CONTEXT_BUDGET_EXCEEDED");
    return { success: true, text: output };
}
class NativeProcess extends EventEmitter {
    child;
    exited;
    fragments = [];
    nextId = 1;
    pending = new Map();
    failure = null;
    constructor(executable, args, options) {
        super();
        this.child = spawn(executable, args, {
            ...options,
            detached: true,
            stdio: ["pipe", "pipe", "pipe"]
        });
        this.exited = new Promise((resolve) => {
            this.child.once("exit", (code, signal) => {
                this.fail(new ReviewError("SERVICE_UNAVAILABLE"));
                resolve({ code, signal });
            });
            this.child.once("error", () => {
                this.fail(new ReviewError("SERVICE_UNAVAILABLE"));
                resolve({ code: null, signal: null });
            });
        });
        // Provider diagnostics can contain credentials; only typed failures leave this owner.
        this.child.stdin.on("error", () =>
            this.fail(new ReviewError("SERVICE_UNAVAILABLE"))
        );
        this.child.stderr.resume();
        // Decode across pipe chunks: a UTF-8 character can straddle two reads.
        this.child.stdout.setEncoding("utf8");
        this.child.stdout.on("data", (chunk) => {
            // Resumed threads include accumulated history, not just one report.
            // Assemble each frame once without imposing a review-size cutoff.
            let start = 0,
                newline;
            while ((newline = chunk.indexOf("\n", start)) >= 0) {
                this.fragments.push(chunk.slice(start, newline));
                const line = this.fragments.join("");
                this.fragments = [];
                start = newline + 1;
                try {
                    this.receive(JSON.parse(line));
                } catch {
                    this.fail(new ReviewError("INVALID_RESULT"));
                }
            }
            if (start < chunk.length) this.fragments.push(chunk.slice(start));
        });
    }
    fail(error) {
        this.failure = error;
        for (const entry of this.pending.values()) {
            clearTimeout(entry.timer);
            entry.reject(error);
        }
        this.pending.clear();
        this.emit("failure", error);
    }
    receive(message) {
        if (message.id !== undefined && !message.method) {
            const pending = this.pending.get(message.id);
            if (!pending) return;
            clearTimeout(pending.timer);
            this.pending.delete(message.id);
            if (message.error)
                pending.reject(new ReviewError("SERVICE_UNAVAILABLE"));
            else pending.resolve(message.result);
        } else this.emit("message", message);
    }
    write(message) {
        check(!this.failure, "SERVICE_UNAVAILABLE");
        this.child.stdin.write(JSON.stringify(message) + "\n");
    }
    request(method, params, timeout = 30000) {
        check(!this.failure, "SERVICE_UNAVAILABLE");
        const id = this.nextId++;
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                reject(new ReviewError("SERVICE_UNAVAILABLE"));
            }, timeout);
            this.pending.set(id, { resolve, reject, timer });
            this.write({ id, method, params });
        });
    }
    async stop(timeoutMs) {
        const deadline = performance.now() + timeoutMs;
        const pid = this.child.pid;
        if (!pid) {
            await this.exited;
            return;
        }
        const signal = (name) => {
            try {
                process.kill(-pid, name);
            } catch (error) {
                if (error.code !== "ESRCH") throw error;
            }
        };
        signal("SIGTERM");
        let timer;
        try {
            await Promise.race([
                this.exited,
                new Promise((resolve) => {
                    timer = setTimeout(resolve, Math.min(1000, timeoutMs / 2));
                })
            ]);
        } finally {
            clearTimeout(timer);
        }
        signal("SIGKILL");
        let exitTimer;
        try {
            await Promise.race([
                this.exited,
                new Promise((_, reject) => {
                    exitTimer = setTimeout(
                        () => reject(new ReviewError("SERVICE_UNAVAILABLE")),
                        Math.max(1, deadline - performance.now())
                    );
                })
            ]);
        } finally {
            clearTimeout(exitTimer);
        }
        // The leader can exit before its signalled descendants are reaped.
        while (true) {
            try {
                process.kill(-pid, 0);
            } catch (error) {
                if (error.code === "ESRCH") return;
                throw error;
            }
            const remaining = deadline - performance.now();
            check(remaining > 0, "SERVICE_UNAVAILABLE");
            await new Promise((resolve) =>
                setTimeout(resolve, Math.min(25, remaining))
            );
        }
    }
}
function tool(
    name,
    description,
    properties,
    required = Object.keys(properties)
) {
    return {
        name,
        description,
        inputSchema: {
            type: "object",
            additionalProperties: false,
            properties,
            required
        }
    };
}
const TOOLS = [
    tool(
        "source_list",
        "List the assigned checkout's tracked source paths.",
        {}
    ),
    tool("source_read", "Read bounded lines of a tracked source file.", {
        path: { type: "string" },
        start: { type: "integer" },
        count: { type: "integer" }
    }),
    tool(
        "source_search",
        "Search literal text in bounded tracked source files.",
        {
            text: { type: "string" },
            paths: { type: "array", items: { type: "string" } }
        }
    ),
    tool("source_diff", "Read the pinned source diff for one tracked path.", {
        path: { type: "string" }
    }),
    tool("public_github_read", "Read a bounded public page for this PR only.", {
        url: { type: "string" }
    })
];
module.exports = {
    NativeProcess,
    TOOLS,
    setupTimeout,
    stopNative,
    toolFailureText,
    runTool
};
