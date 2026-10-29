#!/usr/bin/env node
// Controlled external provider, not a simulation of worker/session/adapter logic.
const fs = require("node:fs");
const crypto = require("node:crypto");
const { DEFAULT_MODELS } = require("../../config");
const { file, record, writeReview } = require("./peer-review");
// A second listed model lets tests select a non-default worker model.
const ALTERNATE_MODEL = "alternate-review-model";
if (process.argv.includes("--version")) {
    process.stdout.write("codex-cli 0.156.1\n");
    process.exit(0);
}
const pending = new Map();
let serial = 0,
    thread;
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
function tool(name, args, turn) {
    const id = `tool-${++serial}`;
    return new Promise((resolve) => {
        pending.set(id, resolve);
        send({
            id,
            method: "item/tool/call",
            params: {
                threadId: thread.id,
                turnId: turn,
                tool: name,
                arguments: args
            }
        });
    });
}
async function generate(params, turn) {
    const prompt = params.input[0].text;
    if (thread.model === "ask-user-model") {
        // Headless probe: the model asks the user before reviewing.
        const id = `input-${++serial}`;
        thread.userAnswer = await new Promise((resolve) => {
            pending.set(id, resolve);
            send({
                id,
                method: "item/tool/requestUserInput",
                params: {
                    threadId: thread.id,
                    turnId: turn,
                    itemId: "ask",
                    isBlocking: true,
                    autoResolutionMs: null,
                    questions: [
                        {
                            id: "proceed",
                            header: "Proceed?",
                            question: "Should I continue?",
                            isOther: false,
                            isSecret: false,
                            options: null
                        }
                    ]
                }
            });
        });
        record(file(thread.id), thread);
    }
    const text = await writeReview(prompt, thread, async (name, args) => {
        const result = await tool(name, args, turn);
        return { success: result.success, text: result.contentItems[0].text };
    });
    send({
        method: "item/completed",
        params: {
            threadId: thread.id,
            turnId: turn,
            item: { type: "agentMessage", text }
        }
    });
    send({
        method: "turn/completed",
        params: { threadId: thread.id, turn: { id: turn, status: "completed" } }
    });
}
require("node:readline")
    .createInterface({ input: process.stdin })
    .on("line", (line) => {
        const message = JSON.parse(line);
        if (pending.has(message.id)) {
            pending.get(message.id)(message.result);
            pending.delete(message.id);
            return;
        }
        const params = message.params || {};
        let result = {};
        if (message.method === "account/read")
            result = { account: { type: "chatgpt" } };
        else if (message.method === "model/list")
            result = {
                data: [
                    { id: DEFAULT_MODELS.codex },
                    { model: ALTERNATE_MODEL },
                    { model: "ask-user-model" },
                    { model: "no-profile-model" }
                ]
            };
        else if (["thread/start", "thread/resume"].includes(message.method)) {
            thread =
                message.method === "thread/start"
                    ? { id: crypto.randomUUID(), turns: 0 }
                    : JSON.parse(
                          fs.readFileSync(file(params.threadId), "utf8")
                      );
            thread.instructions = params.developerInstructions;
            thread.model = params.model;
            thread.cwd = params.cwd;
            thread.sandbox = params.sandbox ?? null;
            thread.environments = params.environments ?? null;
            // The real app-server reports the -c default_permissions profile.
            thread.permissionArgs = process.argv.filter((arg) =>
                /^(default_permissions|permissions\.|shell_environment_policy)/.test(
                    arg
                )
            );
            record(file(thread.id), thread);
            result = {
                thread: { id: thread.id },
                // "no-profile-model" simulates a CLI that ignored the profile.
                activePermissionProfile:
                    process.argv.includes('default_permissions="review"') &&
                    params.model !== "no-profile-model"
                        ? { id: "review" }
                        : null
            };
        } else if (message.method === "thread/read")
            result = {
                thread: JSON.parse(
                    fs.readFileSync(file(params.threadId), "utf8")
                )
            };
        else if (message.method === "turn/start") {
            const turn = `turn-${++serial}`;
            thread.turnSettings = [
                ...(thread.turnSettings || []),
                { model: params.model, effort: params.effort }
            ];
            send({ id: message.id, result: { turn: { id: turn } } });
            generate(params, turn).catch((error) => {
                process.stderr.write(error.stack);
                process.exit(1);
            });
            return;
        } else if (!["initialize", "initialized"].includes(message.method))
            throw new Error(`Unexpected provider operation ${message.method}`);
        if (message.id !== undefined) send({ id: message.id, result });
    });
