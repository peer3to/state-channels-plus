#!/usr/bin/env node
// Controlled external provider, not a simulation of worker/session/adapter logic.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const assert = require("node:assert/strict");
const { MODEL } = require("../../config");
if (process.argv.includes("--version")) {
    process.stdout.write("codex-cli 0.154.0\n");
    process.exit(0);
}
const pending = new Map();
let serial = 0,
    thread;
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
const file = (id) => path.join(process.cwd(), `${id}.json`);
function record(filename, value) {
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(value));
    fs.renameSync(`${filename}.tmp`, filename);
}
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
    const bound = prompt.split("Controller-bound input:\n")[1];
    const input = bound ? JSON.parse(bound) : thread.input;
    thread.input = input;
    record(file(`started-${input.pr}`), {
        input,
        instructions: thread.instructions,
        threadId: thread.id
    });
    while (fs.existsSync("hold") && !fs.existsSync(`release-${input.pr}`))
        await new Promise((resolve) => setTimeout(resolve, 10));
    const source = await tool(
        "source_read",
        { path: "README.md", start: 1, count: 1 },
        turn
    );
    assert.equal(source.success, true);
    assert.equal(
        JSON.parse(source.contentItems[0].text).lines[0],
        "Reviewed source."
    );
    const discussion = [];
    for (const route of [
        `pulls/${input.pr}`,
        `issues/${input.pr}/comments`,
        `pulls/${input.pr}/comments`,
        `pulls/${input.pr}/reviews`
    ]) {
        const page = await tool(
            "public_github_read",
            {
                url: `https://api.github.com/repos/${input.repository.name}/${route}`
            },
            turn
        );
        assert.equal(page.success, true);
        if (route === `pulls/${input.pr}/comments`) {
            for (const comment of JSON.parse(page.contentItems[0].text).data) {
                if (comment.user?.type !== "Bot")
                    discussion.push(
                        `| inline:${comment.id} | response | This discussion was read in the current turn. | - |`
                    );
            }
        }
    }
    const restored = prompt.match(
        /Previously excluded finding context: ([^\n]+)/
    );
    const findings = [
        ...(input.previousFindings || []),
        ...(restored ? JSON.parse(restored[1]) : [])
    ].filter((finding) => !["fixed", "disagreement"].includes(finding.status));
    const cards = findings
        .map(
            (finding) =>
                `### [${finding.id}] Retained finding\nStatus: continued\nLocation: general\n${finding.body}\n> Fix ${finding.id}-FIX\n> Retain the pending operation.\n`
        )
        .join("\n");
    const accounting = findings
        .map(
            (finding) =>
                `| finding:${finding.id} | continued | Still relevant in current source. | ${finding.id} |`
        )
        .concat(discussion)
        .join("\n");
    const text = `# Review\n\n## Correctness\n${cards}\n## Discussion\n${accounting}\n## Review completion\nComplete: yes\nMissing: none\nVerification missing: controlled provider, not live model acceptance\nLenses: correctness\nBehaviors: source read\n`;
    thread.turns++;
    record(file(thread.id), thread);
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
            result = { data: [{ id: MODEL }] };
        else if (["thread/start", "thread/resume"].includes(message.method)) {
            thread =
                message.method === "thread/start"
                    ? { id: crypto.randomUUID(), turns: 0 }
                    : JSON.parse(
                          fs.readFileSync(file(params.threadId), "utf8")
                      );
            thread.instructions = params.developerInstructions;
            record(file(thread.id), thread);
            result = { thread: { id: thread.id } };
        } else if (message.method === "thread/read")
            result = {
                thread: JSON.parse(
                    fs.readFileSync(file(params.threadId), "utf8")
                )
            };
        else if (message.method === "turn/start") {
            const turn = `turn-${++serial}`;
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
