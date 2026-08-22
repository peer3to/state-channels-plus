const path = require("path");
const { assertContained } = require("../shared/paths");
const { normalizeTaskRunner } = require("../shared/taskRunners");

// This whitelist is the only thing that crosses to the worker — a field left
// out here is silently dropped. `runner` carries the tier so the worker can
// keep forge tasks off its slot and account pools; a worker whose runner code
// predates the field simply gives every task a slot it may not need.
function toWireTask(task, projectRoot) {
    const root = path.resolve(projectRoot);
    return {
        label: task.label,
        logName: task.logName,
        runner: normalizeTaskRunner(task.runner),
        args: task.args.map((arg) => {
            if (!path.isAbsolute(arg)) return arg;
            const contained = assertContained(root, arg, {
                message: `Task path leaves project: ${arg}`
            });
            const relative = path.relative(root, contained);
            return { projectPath: relative.split(path.sep).join("/") };
        })
    };
}

function fromWireTask(task, projectRoot) {
    const root = path.resolve(projectRoot);
    return {
        ...task,
        runner: normalizeTaskRunner(task.runner),
        args: task.args.map((arg) => {
            if (typeof arg === "string") return arg;
            return assertContained(root, path.resolve(root, arg.projectPath), {
                message: `Task path leaves extracted project: ${arg.projectPath}`
            });
        })
    };
}

module.exports = { toWireTask, fromWireTask };
