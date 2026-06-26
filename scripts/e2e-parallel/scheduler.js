/* eslint-disable no-console */
const fs = require("fs");
const {
    FALLBACK_PEERS,
    MIN_THREAD_FACTOR,
    MAX_THREAD_FACTOR,
    STARVATION_KNOCKDOWN,
    EPSILON,
    SCHEDULER_METADATA_PATH
} = require("./constants");

// Known scenario helper → peer count (including any spectator the helper adds).
const SCENARIO_PEER_COUNTS = {
    fourPeersDisputeResolution: 4,
    fourPeersDisputeResolutionAndSnapshotUpdateDetached: 4,
    fourPeersDisputeResolutionAndSnapshotUpdateWait: 4,
    preDisputeSetup: 3,
    preDisputeSetupCalldataPath: 4,
    preDisputeSetupDisconnectedPeer: 4,
    setupTwoLeaversAcrossMilestones: 5,
    setupTwoLeaversWithPendingJoinerAcrossMilestones: 5,
    syncSpectatorAndPrepareJoin: 4,
    spectatorJoinedAndSynced: 4,
    spectatorPromotedViaJoinChannelWait: 3,
    spectatorPromotedViaForceInboundWait: 4,
    readyForRedispute: 4,
    activeChannelWithDispute: 3
};

// Resolve thread-mode booleans with precedence: CLI flag > inherited env > default.
// Defaults: vmThread=true, sdkThread=useExternalNode (sdk-in-thread requires
// a PROVIDER_URL which is only injected under --per-slot-node or --shared-node).
function resolveThreadModes(cli, useExternalNode) {
    let sdkThread, sdkThreadSource;
    if (cli.sdkThread !== undefined) {
        sdkThread = cli.sdkThread;
        sdkThreadSource = "explicit";
    } else if (process.env.RUN_SDK_IN_THREAD !== undefined) {
        sdkThread = process.env.RUN_SDK_IN_THREAD !== "false";
        sdkThreadSource = "explicit";
    } else if (useExternalNode) {
        sdkThread = true;
        sdkThreadSource = "external-node default";
    } else {
        sdkThread = false;
        sdkThreadSource = "default off";
    }

    const vmThread =
        cli.vmThread !== undefined
            ? cli.vmThread
            : process.env.VM_DEDICATED_THREAD !== undefined
              ? process.env.VM_DEDICATED_THREAD !== "false"
              : true;

    return { sdkThread, sdkThreadSource, vmThread };
}

// Number of OS threads a single peer contributes: 1 per enabled thread mode,
// clamped to at least 1. VM_DEDICATED_THREAD defaults true / RUN_SDK_IN_THREAD defaults to usePerSlotNode.
function threadsPerPeerFromModes({ sdkThread, vmThread }) {
    return Math.max(1, (vmThread ? 1 : 0) + (sdkThread ? 1 : 0));
}

/**
 * Heuristically derive the peer count for a single `it()` block.
 *
 * Strategy (in priority order):
 *  1. If the test body calls a known scenario helper, use the mapped peer count
 *     (optionally overridden by an inline peerCount/numPeers/initialPeers
 *     property found within the next 200 characters).
 *  2. Otherwise fall back to the maximum first-integer-argument seen in direct
 *     lifecycle.start / timeoutSetup / harness.setup calls, plus any
 *     addSpectatorWait() calls.
 *  3. If nothing is found, use FALLBACK_PEERS.
 */
function computePeerCount(itText) {
    // --- Pass 1: literal calls (lifecycle.start, timeoutSetup, harness.setup, .start) ---
    let literalPeers = 0;
    const literalRe =
        /\b(?:lifecycle\.start|timeoutSetup|harness\.setup)\(\s*(\d+)/g;
    let m;
    while ((m = literalRe.exec(itText)) !== null) {
        const v = Number.parseInt(m[1], 10);
        if (v > literalPeers) literalPeers = v;
    }

    // --- Pass 2: scenario helper calls ---
    let helperMatched = false;
    let helperPeers = 0;
    const scenarioRe = /scenario\.(\w+)\s*\(/g;
    while ((m = scenarioRe.exec(itText)) !== null) {
        const name = m[1];
        helperMatched = true;
        let base;
        if (Object.prototype.hasOwnProperty.call(SCENARIO_PEER_COUNTS, name)) {
            base = SCENARIO_PEER_COUNTS[name];
            // Allow inline override: look for peerCount/numPeers/initialPeers
            // within the 200 chars following the opening parenthesis.
            const window = itText.slice(m.index, m.index + m[0].length + 200);
            const overrideRe =
                /(?:peerCount|numPeers|initialPeers)\s*:\s*(\d+)/;
            const om = overrideRe.exec(window);
            if (om) {
                const overrideVal = Number.parseInt(om[1], 10);
                // The override sets the base participant count; spectator-adding
                // helpers still add their one spectator on top of it.
                const isSpectator = name.toLowerCase().includes("spectator");
                base = overrideVal + (isSpectator ? 1 : 0);
            }
        } else {
            // Unknown helper — be conservative
            base = FALLBACK_PEERS;
        }
        if (base > helperPeers) helperPeers = base;
    }

    // --- Resolve ---
    let peers;
    if (helperMatched) {
        peers = helperPeers;
    } else if (literalPeers > 0) {
        // Count addSpectatorWait( occurrences to account for spectators added
        // separately from the main channel setup.
        const spectatorMatches = (itText.match(/addSpectatorWait\s*\(/g) || [])
            .length;
        peers = literalPeers + spectatorMatches;
    } else {
        peers = FALLBACK_PEERS;
    }

    return Math.max(1, peers);
}

/** Read and parse the metadata file. Returns null on any error. */
function readSchedulerMetadata() {
    try {
        const raw = fs.readFileSync(SCHEDULER_METADATA_PATH, "utf8");
        return JSON.parse(raw);
    } catch {
        return null;
    }
}

/** Persist metadata. Swallows errors — a write failure must never abort a run. */
function writeSchedulerMetadata(data) {
    try {
        fs.writeFileSync(
            SCHEDULER_METADATA_PATH,
            JSON.stringify(data, null, 2),
            "utf8"
        );
    } catch {
        // Non-fatal: metadata is best-effort.
    }
}

/**
 * Compute the adaptive thread factor from prior run metadata.
 * Returns { threadFactor, didAdapt }.
 * When adaptation is disabled or no prior metadata exists, returns
 * { threadFactor: seedFactor, didAdapt: false }.
 */
function computeAdaptiveFactor({
    seedFactor,
    targetLoad,
    threadsPerPeer,
    shouldAdapt
}) {
    if (!shouldAdapt) {
        return { threadFactor: seedFactor, didAdapt: false };
    }

    const all = readSchedulerMetadata();
    // Key metadata by threadsPerPeer so different regimes don't clobber each other.
    const meta = all && typeof all === "object" ? all[threadsPerPeer] : null;
    if (
        meta == null ||
        !Number.isFinite(meta.scalingFactor) ||
        !Number.isFinite(meta.avgLoadPerCore)
    ) {
        return { threadFactor: seedFactor, didAdapt: false };
    }

    const prevFactor = meta.scalingFactor;
    const prevLoad = meta.avgLoadPerCore;
    const prevStarvation = meta.starvationTrips ?? 0;

    let nextFactor = prevFactor * (targetLoad / Math.max(prevLoad, EPSILON));
    nextFactor = Math.max(
        MIN_THREAD_FACTOR,
        Math.min(MAX_THREAD_FACTOR, nextFactor)
    );

    if (prevStarvation > 0) {
        const knocked = prevFactor * STARVATION_KNOCKDOWN;
        nextFactor = Math.min(
            nextFactor,
            Math.max(MIN_THREAD_FACTOR, Math.min(MAX_THREAD_FACTOR, knocked))
        );
    }

    console.log(
        `adapting factor ${prevFactor.toFixed(3)} → ${nextFactor.toFixed(3)} from prior load/core ${prevLoad.toFixed(3)} toward ${targetLoad}`
    );

    return { threadFactor: nextFactor, didAdapt: true };
}

module.exports = {
    SCENARIO_PEER_COUNTS,
    resolveThreadModes,
    threadsPerPeerFromModes,
    computePeerCount,
    readSchedulerMetadata,
    writeSchedulerMetadata,
    computeAdaptiveFactor
};
