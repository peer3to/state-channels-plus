/* eslint-disable no-console */
require("dotenv").config({ quiet: true });
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { IsolatedEnvironmentManager } = require("./isolatedEnvironment");
const { parseArgs } = require("./isolatedEnvironmentSelfCheck");

const profile = {
    schedulerTickMs: 1000,
    workers: 1,
    slots: 0,
    cpu: 0.5,
    memoryBytes: 256 * 1024 ** 2,
    diskBytes: 512 * 1024 ** 2,
    pidsLimit: 64,
    targetLoad: 0.8
};

async function main(argv = process.argv) {
    if (
        process.platform !== "linux" ||
        process.env.SCP_DISPOSABLE_DOCKER_HOST !== "1"
    ) {
        throw new Error(
            "Docker integration requires a disposable Linux host and SCP_DISPOSABLE_DOCKER_HOST=1"
        );
    }
    const options = parseArgs(argv);
    const workRoot = path.resolve(options.workRoot);
    if (workRoot === path.parse(workRoot).root) {
        throw new Error(
            "Docker integration requires a narrow disposable work root"
        );
    }
    if (fs.existsSync(workRoot) && fs.readdirSync(workRoot).length) {
        throw new Error("Docker integration work root must be new or empty");
    }
    fs.mkdirSync(workRoot, { recursive: true });
    const cleanupToken = crypto.randomUUID();
    const cleanupMarker = path.join(workRoot, ".peer3-disposable-integration");
    fs.writeFileSync(cleanupMarker, cleanupToken, { mode: 0o600 });
    let manager;
    let first;
    let second;
    let stage = "manager setup";
    const results = {};
    try {
        manager = await IsolatedEnvironmentManager.create({
            workRoot,
            runnerImage: options.runnerImage,
            executionBackend: "docker",
            trustedRoot: path.resolve(__dirname, "../../..")
        });
        first = await manager.allocate({
            environmentKey: crypto.randomBytes(32).toString("hex"),
            orchestratorPublicKey: crypto.randomBytes(32).toString("hex"),
            profile
        });
        second = await manager.allocate({
            environmentKey: crypto.randomBytes(32).toString("hex"),
            orchestratorPublicKey: crypto.randomBytes(32).toString("hex"),
            profile
        });
        stage = "first environment start";
        await first.start();
        stage = "first identity marker";
        await manager.backend.operatorIdentityMarker(first.handle, "first");
        stage = "network policy";
        results.network = await manager.backend.operatorNetworkCheck(
            first.handle
        );
        stage = "process limit";
        results.process = await manager.backend.operatorProcessLimitCheck(
            first.handle
        );
        stage = "disk limit";
        results.disk = await manager.backend.operatorDiskLimitCheck(
            first.handle
        );
        await first.stop();

        stage = "second environment start";
        await second.start();
        if (await manager.backend.operatorIdentityMarker(second.handle)) {
            throw new Error(
                "A second identity observed the first identity marker"
            );
        }
        await manager.backend.operatorIdentityMarker(second.handle, "second");
        await second.stop();

        stage = "first environment restart";
        await first.start();
        if (
            (await manager.backend.operatorIdentityMarker(first.handle)) !==
            "first"
        ) {
            throw new Error("A stopped identity did not retain its own cache");
        }
        stage = "memory limit";
        results.memory = await manager.backend.operatorMemoryLimitCheck(
            first.handle
        );
        results.identityVolumeSeparation = true;
        results.stoppedCacheReuse = true;
        results.capabilities = manager.capabilities();
        console.log(JSON.stringify({ result: "pass", ...results }));
    } catch (error) {
        error.message = `Docker integration failed during ${stage}: ${error.message}`;
        throw error;
    } finally {
        await Promise.allSettled(
            [first, second]
                .filter(Boolean)
                .map((environment) => environment.destroy())
        );
        if (
            fs.existsSync(cleanupMarker) &&
            fs.readFileSync(cleanupMarker, "utf8") === cleanupToken
        ) {
            fs.rmSync(workRoot, { recursive: true, force: true });
        }
    }
}

if (require.main === module) {
    main().catch((error) => {
        console.error(error.stack || error);
        process.exitCode = 1;
    });
}

module.exports = { main };
