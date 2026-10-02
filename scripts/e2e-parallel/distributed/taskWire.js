const path = require("path");
const { assertContained } = require("../shared/paths");
const { normalizeTaskRunner } = require("../shared/taskRunners");

// This whitelist is the only thing that crosses to the worker — a field left
// out here is silently dropped. `runner` carries the tier so the worker can
// keep forge tasks off its slot and account pools; a worker whose runner code
// predates the field simply gives every task a slot it may not need.
function toWireTask(
    task,
    projectRoot,
    { schedule = "fifo", distributedProtocol } = {}
) {
    const root = path.resolve(projectRoot);
    const includeCost = schedule === "cost" && distributedProtocol >= 15;
    return {
        label: task.label,
        logName: task.logName,
        runner: normalizeTaskRunner(task.runner),
        ...(includeCost
            ? {
                  cost: {
                      cores: task.cost.cores,
                      rssGb: task.cost.rssGb,
                      heavy: task.cost.heavy
                  }
              }
            : {}),
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
    if (Object.hasOwn(task, "cost")) {
        const cost = task.cost;
        if (
            !cost ||
            typeof cost !== "object" ||
            Array.isArray(cost) ||
            Object.keys(cost).length !== 3 ||
            !Object.keys(cost).every((field) =>
                ["cores", "rssGb", "heavy"].includes(field)
            ) ||
            !["cores", "rssGb"].every(
                (field) => Number.isFinite(cost[field]) && cost[field] >= 0
            ) ||
            typeof cost.heavy !== "boolean"
        )
            throw new Error("Invalid wire task cost");
    }
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

// A cost worker's free budget on TASK_REQUEST. It may be negative: an idle
// worker always takes a task, however large its predicted cost.
function fromWireCostBudget(budget) {
    if (budget === undefined) return undefined;
    if (
        !budget ||
        typeof budget !== "object" ||
        Array.isArray(budget) ||
        Object.keys(budget).length !== 2 ||
        !["cores", "rssGb"].every((field) => Number.isFinite(budget[field]))
    )
        throw new Error("Invalid wire cost budget");
    return budget;
}

module.exports = { toWireTask, fromWireTask, fromWireCostBudget };
