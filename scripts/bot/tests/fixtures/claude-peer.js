#!/usr/bin/env node
// Controlled Claude Code CLI, not a simulation of worker/session/adapter logic.
// Speaks the CLI's stream-json protocol with in-band MCP tool calls.
const fs = require("node:fs");
const { file, record, writeReview } = require("./peer-review");
const args = process.argv.slice(2);
const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
if (args[0] === "--version") {
    process.stdout.write("2.1.280 (Claude Code)\n");
    process.exit(0);
}
if (args[0] === "auth" && args[1] === "status") {
    // A test simulates a logged-out CLI with a marker in CLAUDE_CONFIG_DIR.
    const loggedIn = !(
        process.env.CLAUDE_CONFIG_DIR &&
        fs.existsSync(`${process.env.CLAUDE_CONFIG_DIR}/logged-out`)
    );
    process.stdout.write(
        JSON.stringify({ loggedIn, authMethod: "claude.ai" }) + "\n"
    );
    process.exit(0);
}
const send = (frame) => process.stdout.write(JSON.stringify(frame) + "\n");
// The CLI starts in the review's scratch folder; the fixture keeps its session
// records in the runtime folder beside the instructions, where tests read them.
const workingDirectory = process.cwd();
process.chdir(require("node:path").dirname(option("--system-prompt-file")));
const resumed = option("--resume");
const id = resumed || option("--session-id");
const thread = resumed
    ? JSON.parse(fs.readFileSync(file(id), "utf8"))
    : { id, turns: 0 };
thread.model = option("--model");
thread.cwd = workingDirectory;
thread.builtInTools = (option("--tools") || "").split(",").filter(Boolean);
thread.permissionPrompts = option("--permission-prompts");
thread.settings = option("--settings")
    ? JSON.parse(fs.readFileSync(option("--settings"), "utf8"))
    : null;
// Like the real CLI, results over this many tokens (default 25k) never reach
// the model. GitHub JSON measured about two characters per token live.
thread.maxMcpOutputTokens = process.env.MAX_MCP_OUTPUT_TOKENS;
const outputCap = Number(process.env.MAX_MCP_OUTPUT_TOKENS || 25000) * 2;
thread.effort = option("--effort");
thread.instructions = fs.readFileSync(option("--system-prompt-file"), "utf8");
thread.allowedTools = args.slice(
    args.indexOf("--allowedTools") + 1,
    args.indexOf("--system-prompt-file")
);
record(file(id), thread);
const pending = new Map();
let serial = 0,
    tools = [];
function mcp(method, params) {
    const requestId = `mcp-${++serial}`;
    return new Promise((resolve) => {
        pending.set(requestId, resolve);
        send({
            type: "control_request",
            request_id: requestId,
            request: {
                subtype: "mcp_message",
                server_name: "review",
                message: { jsonrpc: "2.0", id: serial, method, params }
            }
        });
    });
}
async function turn(prompt) {
    send({
        type: "system",
        subtype: "init",
        session_id: id,
        model: thread.model,
        tools: [
            ...thread.builtInTools,
            ...tools.map((tool) => `mcp__review__${tool.name}`),
            // Isolation probes: a built-in tool leaking into the session.
            ...(thread.model === "extra-tool-model" ? ["WebFetch"] : [])
        ]
    });
    if (thread.model === "permission-prompt-model") {
        // Isolation probe: the CLI asks the host to approve a tool.
        send({
            type: "control_request",
            request_id: "permission-1",
            request: { subtype: "can_use_tool", tool_name: "Bash", input: {} }
        });
        return;
    }
    if (thread.model.startsWith("probe-")) {
        // Probe: one tool call, recording exactly what the model received.
        const [name, args] =
            thread.model === "probe-github-model"
                ? [
                      "public_github_read",
                      {
                          url: "https://api.github.com/repos/owner/repo/pulls/6/files?per_page=100"
                      }
                  ]
                : ["source_read", { path: "README.md", start: 1, count: 2 }];
        const response = await mcp("tools/call", { name, arguments: args });
        const text = response.result.content[0].text;
        thread.probe = {
            length: text.length,
            isError: !!response.result.isError,
            text: text.slice(0, 1000)
        };
        record(file(id), thread);
        send({
            type: "result",
            subtype: "success",
            is_error: false,
            session_id: id,
            result: "probed"
        });
        return;
    }
    if (thread.model === "unlisted-review-model") {
        send({
            type: "assistant",
            session_id: id,
            error: "model_not_found",
            message: { content: [{ type: "text", text: "Model issue." }] }
        });
        send({
            type: "result",
            subtype: "success",
            is_error: true,
            session_id: id,
            api_error_status: 404
        });
        return;
    }
    const text = await writeReview(prompt, thread, async (name, input) => {
        send({
            type: "assistant",
            session_id: id,
            message: { content: [{ type: "tool_use", name, input }] }
        });
        const response = await mcp("tools/call", { name, arguments: input });
        const text = response.result.content[0].text;
        // The size threshold (about 50 KB by default) replaces a result with
        // a preview unless the tool raised it through its listed _meta.
        const listed = tools.find((tool) => tool.name === name);
        const sizeCap =
            listed?._meta?.["anthropic/maxResultSizeChars"] ?? 50000;
        if (text.length > sizeCap)
            return {
                success: false,
                text: `Output too large. Full output saved to a file.`
            };
        if (text.length > outputCap)
            return {
                success: false,
                text: `MCP tool "${name}" response exceeds maximum allowed tokens`
            };
        return { success: !response.result.isError, text };
    });
    send({
        type: "assistant",
        session_id: id,
        message: { content: [{ type: "text", text }] }
    });
    send({
        type: "result",
        subtype: "success",
        is_error: false,
        session_id: id,
        result: text
    });
}
require("node:readline")
    .createInterface({ input: process.stdin })
    .on("line", async (line) => {
        const message = JSON.parse(line);
        if (message.type === "control_response") {
            const resolve = pending.get(message.response.request_id);
            pending.delete(message.response.request_id);
            // The worker refuses isolation probes with an error response.
            if (resolve) resolve(message.response.response.mcp_response);
        } else if (message.type === "control_request") {
            await mcp("initialize", { protocolVersion: "2025-06-18" });
            tools = (await mcp("tools/list", {})).result.tools;
            send({
                type: "control_response",
                response: {
                    subtype: "success",
                    request_id: message.request_id,
                    response: {}
                }
            });
        } else if (message.type === "user") {
            thread.turnSettings = [
                ...(thread.turnSettings || []),
                { model: thread.model, effort: thread.effort }
            ];
            await turn(message.message.content);
        } else throw new Error(`Unexpected CLI input ${message.type}`);
    });
