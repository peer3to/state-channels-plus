const path = require("path");

function toWireTask(task, projectRoot) {
    const root = path.resolve(projectRoot);
    return {
        label: task.label,
        logName: task.logName,
        args: task.args.map((arg) => {
            if (!path.isAbsolute(arg)) return arg;
            const relative = path.relative(root, arg);
            if (
                !relative ||
                relative === ".." ||
                relative.startsWith(`..${path.sep}`)
            ) {
                throw new Error(`Task path leaves project: ${arg}`);
            }
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
            const resolved = path.resolve(root, arg.projectPath);
            if (resolved !== root && !resolved.startsWith(root + path.sep)) {
                throw new Error(
                    `Task path leaves extracted project: ${arg.projectPath}`
                );
            }
            return resolved;
        })
    };
}

module.exports = { toWireTask, fromWireTask };
