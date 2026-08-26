// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { expect } from "chai";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { setImmediate } from "node:timers";
import { TestIsolatedRuntimeBackend } from "../fixtures/distributed/isolatedRuntimeBackend";

const {
    DOCKER_OPERATION_TIMEOUT_MS,
    DockerBackend,
    IsolatedEnvironmentManager,
    runProcess,
    runtimeNames,
    trustedRunnerManifest
} = require("../../scripts/e2e-parallel/distributed/isolatedEnvironment.js");
const {
    shouldTransferAttemptEvidence
} = require("../../scripts/e2e-parallel/distributed/artifactSelection.js");
const {
    BoundedArtifactAssembler
} = require("../../scripts/e2e-parallel/distributed/failureArtifacts.js");

const profile = {
    schedulerTickMs: 1000,
    workers: 2,
    slots: 1,
    cpu: 2,
    memoryBytes: 1024 ** 3,
    diskBytes: 2 * 1024 ** 3,
    pidsLimit: 128,
    targetLoad: 0.8
};

describe("distributed isolated environment", function () {
    it("packages the worker, workspace receiver, and test-infrastructure entry as trusted glue", function () {
        const manifest = trustedRunnerManifest(
            path.resolve(__dirname, "../..")
        );
        const paths = manifest.map((entry: { path: string }) => entry.path);
        expect(paths).to.include(
            "scripts/e2e-parallel/distributed/isolatedGuest.js"
        );
        expect(paths).to.include("scripts/e2e-parallel/distributed/worker.js");
        expect(paths).to.include("test/utils/nodeInfra.js");
        expect(paths).to.include("scripts/infra/local-discovery-registry.js");
    });

    it("starts, stops, and restarts one retained identity environment", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-manager-")
        );
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const manager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const allocation = {
                environmentKey: "a".repeat(64),
                orchestratorPublicKey: "b".repeat(64),
                profile
            };
            const environment = await manager.allocate(allocation);
            await environment.start();
            expect(environment.pending).to.deep.equal([]);
            await environment.send("ENVIRONMENT_SETUP", {
                ...allocation,
                limits: {}
            });
            await environment.stop();
            manager.markClean(environment);
            const reused = await manager.allocate(allocation);
            await reused.start();
            await reused.stop();

            expect(reused).to.equal(environment);
            expect(
                backend.calls.filter((entry) => entry.operation === "create")
            ).to.have.length(1);
            expect(
                backend.calls.filter((entry) => entry.operation === "start")
            ).to.have.length(2);
            const metadata = JSON.parse(
                fs.readFileSync(
                    path.join(
                        root,
                        "host-state",
                        "environments",
                        `${allocation.environmentKey}.json`
                    ),
                    "utf8"
                )
            );
            expect(metadata.dirty).to.equal(true);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("contains a broken control pipe inside the failed environment", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-control-pipe-")
        );
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const manager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const environment = await manager.allocate({
                environmentKey: "e".repeat(64),
                orchestratorPublicKey: "f".repeat(64),
                profile
            });
            await environment.start();
            const failure = new Promise<Error>((resolve) =>
                environment.once("failure", resolve)
            );
            const brokenPipe = Object.assign(new Error("write EPIPE"), {
                code: "EPIPE"
            });
            backend.controls[0].stdin.emit("error", brokenPipe);

            expect(await failure).to.equal(brokenPipe);
            expect(environment.state).to.equal("failed");
            await environment.destroy();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("ignores a control pipe error after the environment stops", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-stopped-control-pipe-")
        );
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const manager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const environment = await manager.allocate({
                environmentKey: "1".repeat(64),
                orchestratorPublicKey: "2".repeat(64),
                profile
            });
            await environment.start();
            await environment.stop();
            let failed = false;
            environment.once("failure", () => (failed = true));
            backend.controls[0].stdin.emit(
                "error",
                Object.assign(new Error("write EPIPE"), { code: "EPIPE" })
            );
            await new Promise((resolve) => setImmediate(resolve));

            expect(failed).to.equal(false);
            expect(environment.state).to.equal("stopped");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("updates retained runtime limits and rejects growth beyond its fixed disk quota", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-profile-update-")
        );
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const manager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const allocation = {
                environmentKey: "9".repeat(64),
                orchestratorPublicKey: "8".repeat(64),
                profile
            };
            const environment = await manager.allocate(allocation);
            const changedProfile = {
                ...profile,
                cpu: 1,
                memoryBytes: profile.memoryBytes / 2,
                diskBytes: profile.diskBytes / 2,
                pidsLimit: 64
            };
            const reused = await manager.allocate({
                ...allocation,
                profile: changedProfile
            });
            expect(reused).to.equal(environment);
            expect(
                backend.calls.filter((entry) => entry.operation === "update")
            ).to.deep.equal([
                {
                    operation: "update",
                    value: {
                        handle: environment.handle,
                        profile: changedProfile
                    }
                }
            ]);

            let refusal: Error & {
                code?: string;
                resource?: string;
            };
            try {
                await manager.allocate({
                    ...allocation,
                    profile: { ...profile, diskBytes: profile.diskBytes + 1 }
                });
            } catch (error) {
                refusal = error as typeof refusal;
            }
            expect(refusal!.code).to.equal("RESOURCE_ALLOCATION_REJECTED");
            expect(refusal!.resource).to.equal("diskBytes");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("maps a retained Docker profile update to cgroup limit flags", async function () {
        const calls: Array<{
            args: string[];
            options: { timeoutMs?: number };
        }> = [];
        const backend = new DockerBackend({
            image: `runner@sha256:${"f".repeat(64)}`,
            run: async (
                _command: string,
                args: string[],
                options: { timeoutMs?: number }
            ) => {
                calls.push({ args, options });
                return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
            }
        });
        await backend.update({ container: "retained" }, profile);
        expect(calls).to.deep.equal([
            {
                args: [
                    "update",
                    "--cpus",
                    String(profile.cpu),
                    "--memory",
                    String(profile.memoryBytes),
                    "--memory-swap",
                    String(profile.memoryBytes),
                    "--pids-limit",
                    String(profile.pidsLimit),
                    "retained"
                ],
                options: { timeoutMs: DOCKER_OPERATION_TIMEOUT_MS }
            }
        ]);
    });

    it("bounds Docker startup commands", async function () {
        const calls: Array<{
            command: string;
            options: { timeoutMs?: number };
        }> = [];
        const backend = new DockerBackend({
            image: `runner@sha256:${"f".repeat(64)}`,
            platform: "darwin",
            processFactory: () => ({}),
            run: async (
                command: string,
                _args: string[],
                options: { timeoutMs?: number }
            ) => {
                calls.push({ command, options });
                return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
            }
        });
        await backend.start({ container: "retained" });

        expect(calls).not.to.be.empty;
        expect(
            calls.every(
                (entry) =>
                    entry.options.timeoutMs === DOCKER_OPERATION_TIMEOUT_MS
            )
        ).to.equal(true);
    });

    it("kills a process that exceeds its operation timeout", async function () {
        let failure: Error | undefined;
        try {
            await runProcess(
                process.execPath,
                ["-e", "setInterval(()=>{},1000)"],
                { timeoutMs: 25 }
            );
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.message).to.include("timed out after 25ms");
    });

    it("does not poll Docker exit classification while an environment is running", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-no-resource-poll-")
        );
        class ClassificationBackend extends TestIsolatedRuntimeBackend {
            classificationCalls = 0;

            async classifyExit() {
                this.classificationCalls += 1;
                return null;
            }
        }
        const backend = new ClassificationBackend();
        try {
            const manager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const environment = await manager.allocate({
                environmentKey: "5".repeat(64),
                orchestratorPublicKey: "4".repeat(64),
                profile
            });
            await environment.start();
            await new Promise((resolve) => setTimeout(resolve, 1100));
            expect(backend.classificationCalls).to.equal(0);
            await environment.stop();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("destroys only the failed identity allocation", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-manager-")
        );
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const manager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const first = await manager.allocate({
                environmentKey: "1".repeat(64),
                orchestratorPublicKey: "a".repeat(64),
                profile
            });
            const second = await manager.allocate({
                environmentKey: "2".repeat(64),
                orchestratorPublicKey: "b".repeat(64),
                profile
            });
            await first.destroy();

            expect(first.state).to.equal("destroyed");
            expect(second.state).to.equal("created");
            expect(
                backend.calls.filter((entry) => entry.operation === "destroy")
            ).to.have.length(1);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("recovers a clean stopped cache and destroys only a dirty crash cache", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-manager-")
        );
        const backend = new TestIsolatedRuntimeBackend();
        try {
            const firstManager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const cleanAllocation = {
                environmentKey: "3".repeat(64),
                orchestratorPublicKey: "c".repeat(64),
                profile
            };
            const dirtyAllocation = {
                environmentKey: "4".repeat(64),
                orchestratorPublicKey: "d".repeat(64),
                profile
            };
            const clean = await firstManager.allocate(cleanAllocation);
            firstManager.markClean(clean);
            await firstManager.allocate(dirtyAllocation);

            const restarted = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            await restarted.recoverOrphans();
            const recovered = await restarted.allocate(cleanAllocation);

            expect(recovered.state).to.equal("stopped");
            expect(
                backend.calls.filter((entry) => entry.operation === "create")
            ).to.have.length(2);
            expect(
                backend.calls.filter((entry) => entry.operation === "destroy")
            ).to.have.length(1);
            expect(
                fs.existsSync(
                    path.join(
                        root,
                        "host-state",
                        "environments",
                        `${dirtyAllocation.environmentKey}.json`
                    )
                )
            ).to.equal(false);
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("blocks reuse when orphan stop and detach cannot be confirmed", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-manager-")
        );
        class UnstoppableBackend extends TestIsolatedRuntimeBackend {
            async stop() {
                throw new Error("stop confirmation timed out");
            }
        }
        const backend = new UnstoppableBackend();
        const allocation = {
            environmentKey: "5".repeat(64),
            orchestratorPublicKey: "e".repeat(64),
            profile
        };
        try {
            const firstManager = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            const environment = await firstManager.allocate(allocation);
            firstManager.markClean(environment);

            const restarted = await IsolatedEnvironmentManager.create({
                workRoot: root,
                backend,
                backendName: "test"
            });
            await restarted.recoverOrphans();

            let failure: Error | undefined;
            try {
                await restarted.allocate(allocation);
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.include("cleanup is unconfirmed");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("builds a hardened Docker create request without host mounts or Docker control", async function () {
        const calls: Array<{
            command: string;
            args: string[];
            options: { timeoutMs?: number };
        }> = [];
        const backend = new DockerBackend({
            image: `runner@sha256:${"f".repeat(64)}`,
            run: async (
                command: string,
                args: string[],
                options: { timeoutMs?: number }
            ) => {
                calls.push({ command, args, options });
                return { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
            }
        });
        backend.securityOptions = ["name=apparmor"];
        backend.usernsHostRunnerUid = 110001;
        backend.usernsHostRunnerGid = 210001;
        await backend.create({ environmentKey: "c".repeat(64), profile });
        const create = calls.find((entry) => entry.args[0] === "create")!;
        const volume = calls.find((entry) => entry.args[0] === "volume")!;
        const initialize = calls.find(
            (entry) =>
                entry.args[0] === "run" && entry.args.includes("--userns=host")
        )!;

        expect(create.args).to.include("--read-only");
        expect(create.args).to.include("--init");
        expect(create.args).to.include("--cap-drop=ALL");
        expect(create.args).to.include("--security-opt=no-new-privileges:true");
        expect(create.args).to.include(
            "--security-opt=apparmor=docker-default"
        );
        expect(create.args).to.include("--user");
        expect(create.args).to.include("HOME=/environment/home");
        expect(create.args.join(" ")).not.to.include("/var/run/docker.sock");
        expect(create.args.join(" ")).not.to.include("type=bind");
        expect(create.args.at(-1)).to.include("SIGTERM");
        expect(initialize.args).to.include("--cap-add=CHOWN");
        expect(initialize.args).to.include("110001:210001");
        expect(volume.args).to.include(`size=${profile.diskBytes}`);
        expect(
            calls.every(
                (entry) =>
                    entry.options.timeoutMs === DOCKER_OPERATION_TIMEOUT_MS
            )
        ).to.equal(true);
        expect(runtimeNames("c".repeat(64)).container).to.match(/^peer3-test-/);
    });

    it("fails closed when the runner image is not digest pinned", async function () {
        const backend = new DockerBackend({ image: "runner:latest" });
        const detected = await backend.detect();
        expect(detected.available).to.equal(false);
        expect(detected.reason).to.include("digest-pinned");
    });

    it("accepts an immutable local Docker image ID", async function () {
        const backend = new DockerBackend({
            image: `sha256:${"f".repeat(64)}`,
            platform: "darwin",
            hostCidrs: [],
            run: async () => ({
                stdout: Buffer.from("[]"),
                stderr: Buffer.alloc(0)
            })
        });
        expect(await backend.detect()).to.deep.equal({ available: true });
    });

    it("classifies cgroup memory and process exhaustion without exposing host state", async function () {
        let memoryEvents = "oom_kill 1\n";
        let processEvents = "max 0\n";
        const backend = new DockerBackend({
            image: `runner@sha256:${"f".repeat(64)}`,
            run: async (_command: string, args: string[]) => {
                if (args[0] === "inspect") {
                    return {
                        stdout: Buffer.from('{"OOMKilled":false}'),
                        stderr: Buffer.alloc(0)
                    };
                }
                const output = args.some((arg) => arg.endsWith("memory.events"))
                    ? memoryEvents
                    : processEvents;
                return {
                    stdout: Buffer.from(output),
                    stderr: Buffer.alloc(0)
                };
            }
        });
        const handle = {
            container: "isolated",
            resourceEvents: {
                memory: { oom_kill: 0 },
                pids: { max: 0 }
            }
        };
        expect(await backend.classifyExit(handle, profile)).to.deep.include({
            resource: "memory",
            limit: profile.memoryBytes
        });

        memoryEvents = "oom_kill 0\n";
        processEvents = "max 1\n";
        expect(await backend.classifyExit(handle, profile)).to.deep.include({
            resource: "process",
            limit: profile.pidsLimit
        });
    });

    it("fails closed when the selected Docker backend is unavailable", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "isolated-manager-")
        );
        const unavailable = {
            async detect() {
                return { available: false, reason: "docker missing" };
            }
        };
        try {
            let failure: Error | undefined;
            try {
                await IsolatedEnvironmentManager.create({
                    workRoot: root,
                    executionBackend: "docker",
                    backend: unavailable
                });
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.include(
                "docker execution backend is unavailable"
            );
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("selects unsafe host execution without probing Docker", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "unsafe-host-manager-")
        );
        try {
            const unsafe = await IsolatedEnvironmentManager.create({
                workRoot: root,
                executionBackend: "unsafe-host"
            });
            expect(unsafe.capabilities()).to.deep.equal({
                backend: "unsafe-host",
                isolation: {
                    backend: "unsafe-host",
                    kernelIsolation: "none",
                    filesystem: "none",
                    network: "host",
                    hardenedSharedWorker: false
                }
            });
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("recovers a clean unsafe-host workspace under the worker work root", async function () {
        const root = fs.mkdtempSync(
            path.join(os.tmpdir(), "unsafe-host-recovery-")
        );
        const allocation = {
            environmentKey: "7".repeat(64),
            orchestratorPublicKey: "6".repeat(64),
            profile
        };
        try {
            const first = await IsolatedEnvironmentManager.create({
                workRoot: root,
                executionBackend: "unsafe-host"
            });
            const environment = await first.allocate(allocation);
            fs.writeFileSync(
                path.join(environment.handle.root, "cached"),
                "ok"
            );
            first.markClean(environment);

            const restarted = await IsolatedEnvironmentManager.create({
                workRoot: root,
                executionBackend: "unsafe-host"
            });
            await restarted.recoverOrphans();
            const recovered = await restarted.allocate(allocation);
            expect(recovered.handle.root).to.equal(environment.handle.root);
            expect(
                fs.readFileSync(
                    path.join(recovered.handle.root, "cached"),
                    "utf8"
                )
            ).to.equal("ok");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("selects only failed, infrastructure-failed, or starved attempt evidence", function () {
        expect(
            shouldTransferAttemptEvidence({
                code: 0,
                reduced: { starveCount: 0 }
            })
        ).to.equal(false);
        expect(shouldTransferAttemptEvidence({ code: 1 })).to.equal(true);
        expect(
            shouldTransferAttemptEvidence({
                code: 0,
                infrastructureFailure: true
            })
        ).to.equal(true);
        expect(
            shouldTransferAttemptEvidence({
                code: 0,
                reduced: { starveCount: 1 }
            })
        ).to.equal(true);
    });

    it("assembles bounded guest artifacts by logical name and verifies their hashes", function () {
        const stdout = Buffer.from("out");
        const stderr = Buffer.from("err");
        const assembler = new BoundedArtifactAssembler(
            [
                {
                    name: "stdout",
                    bytes: stdout.length,
                    sha256: crypto
                        .createHash("sha256")
                        .update(stdout)
                        .digest("hex")
                },
                {
                    name: "stderr",
                    bytes: stderr.length,
                    sha256: crypto
                        .createHash("sha256")
                        .update(stderr)
                        .digest("hex")
                }
            ],
            10,
            20
        );
        assembler.accept("stdout", 0, stdout);
        assembler.accept("stderr", 1, stderr);
        expect(assembler.complete()).to.deep.include({
            sequence: 2,
            byteCount: 6
        });
    });

    it("rejects oversized, unknown, corrupt, and out-of-order guest artifacts", function () {
        const digest = crypto
            .createHash("sha256")
            .update(Buffer.from("ok"))
            .digest("hex");
        expect(
            () =>
                new BoundedArtifactAssembler(
                    [{ name: "host-path", bytes: 1, sha256: digest }],
                    10,
                    10
                )
        ).to.throw("Invalid guest artifact manifest");
        expect(
            () =>
                new BoundedArtifactAssembler(
                    [{ name: "stdout", bytes: 11, sha256: digest }],
                    10,
                    20
                )
        ).to.throw("Invalid guest artifact manifest");
        const assembler = new BoundedArtifactAssembler(
            [{ name: "stdout", bytes: 2, sha256: digest }],
            10,
            10
        );
        expect(() => assembler.accept("stdout", 1, Buffer.from("ok"))).to.throw(
            "Out-of-order"
        );
        assembler.accept("stdout", 0, Buffer.from("no"));
        expect(() => assembler.complete()).to.throw("verification failed");
    });
});
