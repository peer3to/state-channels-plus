function buildSlotEnv(slot, accountPartition) {
    return {
        PROVIDER_URL: slot?.nodeUrl,
        HARDHAT_NODE_URL: slot?.nodeUrl,
        LOCAL_DISCOVERY_REGISTRY_URL: slot?.discoveryUrl,
        E2E_MANAGER_CACHE_DIR: slot?.cacheDir,
        E2E_INTERVAL_MINING: undefined,
        E2E_SLOT_INDEX: String(accountPartition)
    };
}

/**
 * What ResourceGate.allows needs to admit `assignment` beside the running
 * ones: under `cost`, the summed predicted cost of the running assignments.
 */
function admissionCost(schedule, assignment, activeAssignments) {
    return {
        schedule,
        runningCost:
            schedule === "cost"
                ? [...activeAssignments].reduce(
                      (sum, active) => ({
                          cores: sum.cores + active.task.cost.cores,
                          rssGb: sum.rssGb + active.task.cost.rssGb
                      }),
                      { cores: 0, rssGb: 0 }
                  )
                : undefined,
        nextCost: assignment?.task.cost ?? { cores: 0, rssGb: 0 }
    };
}

/**
 * Which budget `cost` would overrun if started beside what a cost worker
 * already runs ("cpu" or "memory"), or null when it fits.
 */
function costBudgetShortfall(cost, budget) {
    if (cost.cores > budget.cores) return "cpu";
    if (cost.rssGb >= budget.rssGb) return "memory";
    return null;
}

/**
 * The free budget a cost worker sends with a task request, so it is handed
 * only a task it can start. None while it runs nothing: an idle worker always
 * takes the next task.
 */
function requestCostBudget(schedule, resourceGate, activeAssignments) {
    if (schedule !== "cost" || activeAssignments.size === 0) return undefined;
    return resourceGate.costBudget(
        admissionCost(schedule, null, activeAssignments).runningCost
    );
}

// The hold reason for a request the coordinator refused for its cost budget.
function budgetHoldReason(reason) {
    return `${reason} (cost budget; predicted cost does not fit)`;
}

function holdReason(options) {
    const { running, concurrencyCap, resourceGate, memBoundGb, targetLoad } =
        options;
    if (running >= concurrencyCap)
        return `cap (running ${running}/${concurrencyCap})`;
    if (resourceGate.cpuMeasured === false)
        return "cpu (awaiting first CPU reading)";
    if (options.schedule === "cost") {
        return `${resourceGate.lastHoldReason ?? "unknown"} (cost budget; owned ${resourceGate.occupiedGb.toFixed(1)}/${memBoundGb.toFixed(1)}GB, cpu ${(resourceGate.cpuUtil * 100).toFixed(0)}%/${(resourceGate.costCpuValve * 100).toFixed(0)}%)`;
    }
    // The gate decided and counted the reason; this only formats it.
    if (resourceGate.lastHoldReason === "memory") {
        return `memory (owned ${resourceGate.occupiedGb.toFixed(1)}+${resourceGate.avgPerTestGb.toFixed(1)}≥${memBoundGb.toFixed(1)}GB)`;
    }
    return `cpu ${(resourceGate.cpuUtil * 100).toFixed(0)}%>=${(targetLoad * 100).toFixed(0)}%`;
}

module.exports = {
    admissionCost,
    budgetHoldReason,
    buildSlotEnv,
    costBudgetShortfall,
    holdReason,
    requestCostBudget
};
