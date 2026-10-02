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

function holdReason(options) {
    const { running, concurrencyCap, resourceGate, memBoundGb, targetLoad } =
        options;
    if (running >= concurrencyCap)
        return `cap (running ${running}/${concurrencyCap})`;
    if (options.schedule === "cost") {
        return `${resourceGate.lastHoldReason ?? "unknown"} (cost budget; owned ${resourceGate.occupiedGb.toFixed(1)}/${memBoundGb.toFixed(1)}GB, cpu ${(resourceGate.cpuUtil * 100).toFixed(0)}%)`;
    }
    if (resourceGate.occupiedGb + resourceGate.avgPerTestGb >= memBoundGb) {
        return `memory (owned ${resourceGate.occupiedGb.toFixed(1)}+${resourceGate.avgPerTestGb.toFixed(1)}≥${memBoundGb.toFixed(1)}GB)`;
    }
    return `cpu ${(resourceGate.cpuUtil * 100).toFixed(0)}%>=${(targetLoad * 100).toFixed(0)}%`;
}

module.exports = { admissionCost, buildSlotEnv, holdReason };
