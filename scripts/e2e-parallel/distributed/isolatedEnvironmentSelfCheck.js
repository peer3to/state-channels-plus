/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { IsolatedEnvironmentManager } = require("./isolatedEnvironment");

function parseArgs(argv) {
    const options = {};
    for (let index = 2; index < argv.length; index++) {
        const flag = argv[index];
        if (flag !== "--work-root" && flag !== "--runner-image") {
            throw new Error(`Unknown self-check option: ${flag}`);
        }
        const value = argv[++index];
        if (!value || value.startsWith("--"))
            throw new Error(`${flag} requires a value`);
        options[flag === "--work-root" ? "workRoot" : "runnerImage"] = value;
    }
    if (!options.workRoot) throw new Error("--work-root is required");
    options.runnerImage ||= process.env.SCP_TEST_RUNNER_IMAGE;
    return options;
}

async function main(argv = process.argv, runOptions = {}) {
    const options = parseArgs(argv);
    const allocationStartedAt = Date.now();
    const environmentKey = crypto.randomBytes(32).toString("hex");
    const manager = await IsolatedEnvironmentManager.create({
        workRoot: path.resolve(options.workRoot),
        runnerImage: options.runnerImage,
        executionBackend: "docker",
        trustedRoot: path.resolve(__dirname, "../../..")
    });
    const allocation = {
        environmentKey,
        orchestratorPublicKey: crypto.randomBytes(32).toString("hex"),
        profile: {
            schedulerTickMs: 1000,
            workers: 1,
            slots: 0,
            cpu: 0.5,
            memoryBytes: 512 * 1024 ** 2,
            diskBytes: 2 * 1024 ** 3,
            pidsLimit: 128,
            targetLoad: 0.8
        }
    };
    const environment = await manager.allocate(allocation);
    environment.on("diagnostic", (chunk) => {
        if (runOptions.report !== false) process.stderr.write(chunk);
    });
    const sentinel = path.join(
        path.resolve(options.workRoot),
        "operator-self-check-sentinel"
    );
    try {
        const launchStartedAt = Date.now();
        await environment.start();
        const controlReadyAt = Date.now();
        await environment.send("ENVIRONMENT_SETUP", {
            environmentKey: environment.allocation.environmentKey,
            orchestratorPublicKey: environment.allocation.orchestratorPublicKey,
            profile: environment.allocation.profile,
            limits: {
                maxCompressedBytes: 1024,
                maxExpandedBytes: 1024,
                maxAttemptSpoolBytes: 1024
            }
        });
        const workspaceStartedAt = Date.now();
        const workspaceNeed = environment.waitFor("WORKSPACE_NEED", 5000);
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
        await workspaceNeed;
        const workspaceReadyAt = Date.now();
        fs.mkdirSync(path.dirname(sentinel), { recursive: true });
        fs.writeFileSync(sentinel, "host-owned", { mode: 0o600 });
        const taskStartedAt = Date.now();
        const artifact = await manager.backend.operatorSelfCheck(
            environment.handle,
            sentinel
        );
        const taskCompletedAt = Date.now();
        if (fs.readFileSync(sentinel, "utf8") !== "host-owned") {
            throw new Error("Isolated runtime changed the host sentinel");
        }
        if (artifact.toString("utf8") !== "loopback-ok") {
            throw new Error("Isolated runtime self-check artifact is invalid");
        }
        await environment.stop();
        manager.markClean(environment);
        const secondProfile = {
            ...allocation.profile,
            cpu: 0.25,
            memoryBytes: 384 * 1024 ** 2,
            diskBytes: allocation.profile.diskBytes / 2,
            pidsLimit: 96
        };
        const reused = await manager.allocate({
            ...allocation,
            profile: secondProfile
        });
        await reused.start();
        const configuredLimits = await manager.backend.operatorConfiguredLimits(
            reused.handle
        );
        if (
            configuredLimits.cpu !== secondProfile.cpu ||
            configuredLimits.memoryBytes !== secondProfile.memoryBytes ||
            configuredLimits.memorySwapBytes !== secondProfile.memoryBytes ||
            configuredLimits.pidsLimit !== secondProfile.pidsLimit
        ) {
            throw new Error(
                "Retained container limits do not match the second profile"
            );
        }
        const result = {
            result: "pass",
            allocationMs: launchStartedAt - allocationStartedAt,
            containerLaunchToControlReadyMs: controlReadyAt - launchStartedAt,
            workspaceOfferToNeedMs: workspaceReadyAt - workspaceStartedAt,
            controlReadyToFirstTaskMs: taskCompletedAt - controlReadyAt,
            fixedTaskMs: taskCompletedAt - taskStartedAt,
            totalMs: taskCompletedAt - allocationStartedAt,
            artifactBytes: artifact.length,
            hostSentinelUnchanged: true,
            retainedProfileLimits: configuredLimits,
            capabilities: manager.capabilities()
        };
        if (runOptions.report !== false) console.log(JSON.stringify(result));
        return result;
    } finally {
        fs.rmSync(sentinel, { force: true });
        await environment.destroy();
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
}

module.exports = { main, parseArgs };
