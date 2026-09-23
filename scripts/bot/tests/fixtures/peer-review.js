// Controlled provider review behaviour shared by the Codex and Claude peers.
// Each peer supplies only its own wire protocol through callTool.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const file = (id) => path.join(process.cwd(), `${id}.json`);
function record(filename, value) {
    fs.writeFileSync(`${filename}.tmp`, JSON.stringify(value));
    fs.renameSync(`${filename}.tmp`, filename);
}
async function writeReview(prompt, thread, callTool) {
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
    const source = await callTool("source_read", {
        path: "README.md",
        start: 1,
        count: 1
    });
    assert.equal(source.success, true);
    assert.equal(JSON.parse(source.text).lines[0], "Reviewed source.");
    const discussion = [];
    for (const route of [
        `pulls/${input.pr}`,
        `issues/${input.pr}/comments`,
        `pulls/${input.pr}/comments`,
        `pulls/${input.pr}/reviews`
    ]) {
        const page = await callTool("public_github_read", {
            url: `https://api.github.com/repos/${input.repository.name}/${route}`
        });
        assert.equal(page.success, true);
        if (route === `pulls/${input.pr}/comments`) {
            for (const comment of JSON.parse(page.text).data) {
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
                `### [${finding.id}] Retained finding\nStatus: continued\nLocation: general\n${finding.body ?? `🟠 **[${finding.id}] Retained from this conversation.**`}\n> Fix ${finding.id}-FIX\n> Retain the pending operation.\n`
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
    return text;
}
module.exports = { file, record, writeReview };
