const path = require("path");
const { assertContained } = require("../shared/paths");

function toWireTask(task, projectRoot) {
    const root = path.resolve(projectRoot);
    return {
        label: task.label,
        logName: task.logName,
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
        args: task.args.map((arg) => {
            if (typeof arg === "string") return arg;
            return assertContained(root, path.resolve(root, arg.projectPath), {
                message: `Task path leaves extracted project: ${arg.projectPath}`
            });
        })
    };
}

module.exports = { toWireTask, fromWireTask };
