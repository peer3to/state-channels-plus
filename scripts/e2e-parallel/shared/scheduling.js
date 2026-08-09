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

function holdReason(options) {
    const { running, concurrencyCap, resourceGate, memBoundGb, targetLoad } =
        options;
    if (running >= concurrencyCap)
        return `cap (running ${running}/${concurrencyCap})`;
    if (resourceGate.occupiedGb + resourceGate.avgPerTestGb >= memBoundGb) {
        return `memory (owned ${resourceGate.occupiedGb.toFixed(1)}+${resourceGate.avgPerTestGb.toFixed(1)}≥${memBoundGb.toFixed(1)}GB)`;
    }
    return `cpu ${(resourceGate.cpuUtil * 100).toFixed(0)}%>=${(targetLoad * 100).toFixed(0)}%`;
}

module.exports = { buildSlotEnv, holdReason };
