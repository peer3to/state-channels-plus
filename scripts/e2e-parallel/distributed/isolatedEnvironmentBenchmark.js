/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const { IsolatedEnvironmentManager } = require("./isolatedEnvironment");
const { parseArgs } = require("./isolatedEnvironmentSelfCheck");

const profile = {
    schedulerTickMs: 1000,
    workers: 1,
    slots: 0,
    cpu: 0.5,
    memoryBytes: 512 * 1024 ** 2,
    diskBytes: 2 * 1024 ** 3,
    pidsLimit: 128,
    targetLoad: 0.8
};

async function measureRun(environment, manager, sentinel, label) {
    const startedAt = performance.now();
    await environment.start();
    const controlReadyAt = performance.now();
    await environment.send("ENVIRONMENT_SETUP", {
        environmentKey: environment.allocation.environmentKey,
        orchestratorPublicKey: environment.allocation.orchestratorPublicKey,
        profile,
        limits: {
            maxCompressedBytes: 1024,
            maxExpandedBytes: 1024,
            maxAttemptSpoolBytes: 1024
        }
    });
    const workspaceStartedAt = performance.now();
    const needed = environment.waitFor("WORKSPACE_NEED", 5000);
    await environment.send("WORKSPACE_OFFER", {
        manifest: {
            version: 3,
            packageManager: "pnpm",
            workspaceId: "0".repeat(64),
            sourceDigest: "0".repeat(64),
            rootProjectPath: "project",
            fileCount: 0,
            files: [],
            repositories: []
        }
    });
    await needed;
    const workspaceReadyAt = performance.now();
    const taskStartedAt = performance.now();
    const artifact = await manager.backend.operatorSelfCheck(
        environment.handle,
        sentinel
    );
    const taskCompletedAt = performance.now();
    const resources = await manager.backend.operatorResourceSnapshot(
        environment.handle
    );
    await environment.stop();
    return {
        label,
        containerLaunchToControlReadyMs: controlReadyAt - startedAt,
        workspaceOfferToNeedMs: workspaceReadyAt - workspaceStartedAt,
        controlReadyToFirstTaskMs: taskCompletedAt - controlReadyAt,
        fixedTaskMs: taskCompletedAt - taskStartedAt,
        totalMs: performance.now() - startedAt,
        artifactBytes: artifact.length,
        resources
    };
}

async function main(argv = process.argv) {
    const options = parseArgs(argv);
    const workRoot = path.resolve(options.workRoot);
    const sentinel = path.join(workRoot, "benchmark-host-sentinel");
    const cpuStarted = process.cpuUsage();
    const managerStartedAt = performance.now();
    const manager = await IsolatedEnvironmentManager.create({
        workRoot,
        runnerImage: options.runnerImage,
        executionBackend: "docker",
        trustedRoot: path.resolve(__dirname, "../../..")
    });
    const environment = await manager.allocate({
        environmentKey: crypto.randomBytes(32).toString("hex"),
        orchestratorPublicKey: crypto.randomBytes(32).toString("hex"),
        profile
    });
    const allocationMs = performance.now() - managerStartedAt;
    fs.mkdirSync(workRoot, { recursive: true });
    fs.writeFileSync(sentinel, "host-owned", { mode: 0o600 });
    let cold;
    let stoppedCache;
    try {
        cold = await measureRun(
            environment,
            manager,
            sentinel,
            "cold-container-and-volume"
        );
        stoppedCache = await measureRun(
            environment,
            manager,
            sentinel,
            "stopped-container-cached-volume"
        );
        if (fs.readFileSync(sentinel, "utf8") !== "host-owned") {
            throw new Error("Benchmark runtime changed the host sentinel");
        }
    } finally {
        fs.rmSync(sentinel, { force: true });
        await environment.destroy();
    }
    console.log(
        JSON.stringify({
            benchmark: "isolated-environment-lifecycle",
            allocationMs,
            cold,
            stoppedCache,
            hostCpuCount: os.cpus().length,
            hostMemoryBytes: os.totalmem(),
            hostFreeMemoryBytes: os.freemem(),
            hostLoadAverage: os.loadavg(),
            supervisorCpuMicros: process.cpuUsage(cpuStarted),
            platform: process.platform
        })
    );
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
}

module.exports = { main };
