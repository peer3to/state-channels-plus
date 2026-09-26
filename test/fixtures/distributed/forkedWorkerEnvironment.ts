// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import crypto from "crypto";
import { EventEmitter } from "events";
import fs from "fs";
import { spawn } from "node:child_process";
import os from "os";
import path from "path";
import * as tar from "tar";

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");
const { waitForEnvironmentFrame } =
    require("../../scripts/fixtures/environmentFrameWait.js") as {
        waitForEnvironmentFrame: (
            received: Frame[],
            notifications: EventEmitter,
            child: ReturnType<typeof spawn>,
            kind: string,
            timeoutMs?: number
        ) => Promise<Frame>;
    };
const { DISTRIBUTED_PROTOCOL_VERSION } =
    require("../../../scripts/e2e-parallel/distributed/protocol.js") as {
        DISTRIBUTED_PROTOCOL_VERSION: number;
    };
const {
    ENVIRONMENT_PROTOCOL_VERSION,
    EnvironmentFrameParser,
    GUEST_KINDS,
    encodeEnvironmentFrame
} =
    require("../../../scripts/e2e-parallel/distributed/environmentProtocol.js") as {
        ENVIRONMENT_PROTOCOL_VERSION: number;
        EnvironmentFrameParser: new (options: { allowedKinds: unknown }) => {
            on: (event: "frame", listener: (frame: Frame) => void) => void;
            consume: (chunk: Buffer) => void;
        };
        GUEST_KINDS: unknown;
        encodeEnvironmentFrame: (
            kind: string,
            payload: Record<string, unknown>,
            body?: Buffer
        ) => Buffer;
    };

type Frame = { kind: string; payload: Record<string, unknown> };

/**
 * The environment the real `isolatedGuest.js` forks its worker with. The guest
 * is driven through setup, a one-file workspace and RUN_CONFIG, with `extraEnv`
 * added to its own environment. `fork()` passes the guest's `execArgv` on, so a
 * `--require` probe runs first inside the forked worker, records its
 * `process.env` and exits before the worker does anything. Dependency
 * installation meets a `pnpm` that succeeds without installing anything.
 */
export async function forkedWorkerEnvironment(
    extraEnv: Record<string, string>
) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "forked-worker-env-"));
    const record = path.join(root, "worker-env.json");
    const probe = path.join(root, "probe.js");
    fs.writeFileSync(
        probe,
        `if (/[\\\\/]worker\\.js$/.test(process.argv[1] || "")) {\n` +
            `    require("fs").writeFileSync(${JSON.stringify(record)}, JSON.stringify(process.env));\n` +
            `    process.exit(0);\n` +
            `}\n`
    );
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "pnpm"), "#!/bin/sh\nexit 0\n");
    fs.chmodSync(path.join(bin, "pnpm"), 0o755);

    // A project and a separate runner repository, so the worker's module path
    // order (runner, then project) is observable.
    const archiveRoot = path.join(root, "archive");
    const members = ["project", "runner"];
    const packages = members.map((member) => {
        fs.mkdirSync(path.join(archiveRoot, member), { recursive: true });
        const body = Buffer.from(
            JSON.stringify({
                name: `forked-worker-${member}`,
                version: "1.0.0"
            })
        );
        fs.writeFileSync(path.join(archiveRoot, member, "package.json"), body);
        return { path: `${member}/package.json`, body };
    });
    const archivePath = path.join(root, "source.tgz");
    await tar.c(
        { cwd: archiveRoot, file: archivePath, gzip: true, portable: true },
        packages.map((entry) => entry.path)
    );
    const archive = fs.readFileSync(archivePath);
    const sha256 = (data: Buffer) =>
        crypto.createHash("sha256").update(data).digest("hex");
    const expandedBytes = packages.reduce(
        (total, entry) => total + entry.body.length,
        0
    );
    const repositories = members.map((member) => ({
        path: member,
        name: `forked-worker-${member}`,
        prepareScript: null,
        cachedPrepareScript: null,
        contractCompileInputs: [],
        verifyNativeModules: [],
        hasPnpmLock: false,
        hasYarnLock: false
    }));

    const child = spawn(
        process.execPath,
        [
            "--require",
            probe,
            path.join(
                REPO_ROOT,
                "scripts",
                "e2e-parallel",
                "distributed",
                "isolatedGuest.js"
            )
        ],
        {
            env: {
                ...process.env,
                ...extraEnv,
                PATH: `${bin}${path.delimiter}${process.env.PATH}`,
                SCP_ISOLATED_ROOT: path.join(root, "guest")
            },
            stdio: ["pipe", "pipe", "pipe"]
        }
    );
    const parser = new EnvironmentFrameParser({ allowedKinds: GUEST_KINDS });
    const received: Frame[] = [];
    const notifications = new EventEmitter();
    parser.on("frame", (frame) => {
        received.push(frame);
        notifications.emit("frame", frame);
    });
    child.stdout!.on("data", (chunk: Buffer) => parser.consume(chunk));
    const waitFrame = (kind: string) =>
        waitForEnvironmentFrame(received, notifications, child, kind);
    try {
        await waitFrame("READY");
        child.stdin!.write(
            encodeEnvironmentFrame("TRUSTED_RUNNER", {
                version: ENVIRONMENT_PROTOCOL_VERSION
            })
        );
        child.stdin!.write(
            encodeEnvironmentFrame("ENVIRONMENT_SETUP", {
                environmentKey: "a".repeat(64),
                orchestratorPublicKey: "b".repeat(64),
                profile: { diskBytes: 1024 ** 2, pidsLimit: 64 },
                limits: {
                    maxCompressedBytes: 1024 ** 2,
                    maxExpandedBytes: 1024 ** 2,
                    maxAttemptSpoolBytes: 1024
                }
            })
        );
        child.stdin!.write(
            encodeEnvironmentFrame("WORKSPACE_OFFER", {
                manifest: {
                    version: 3,
                    packageManager: "pnpm",
                    distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
                    workspaceId: "c".repeat(64),
                    sourceDigest: "d".repeat(64),
                    rootProjectPath: "project",
                    runnerEntry:
                        "runner/scripts/e2e-parallel/distributed/worker.js",
                    repositories,
                    files: packages.map((entry) => ({
                        path: entry.path,
                        bytes: entry.body.length,
                        sha256: sha256(entry.body),
                        mode: 420
                    })),
                    fileCount: packages.length,
                    expandedBytes
                }
            })
        );
        await waitFrame("WORKSPACE_NEED");
        child.stdin!.write(
            encodeEnvironmentFrame("SOURCE_BEGIN", {
                manifest: {
                    version: 3,
                    packageManager: "pnpm",
                    distributedProtocol: DISTRIBUTED_PROTOCOL_VERSION,
                    archiveBytes: archive.length,
                    archiveSha256: sha256(archive),
                    expandedBytes,
                    fileCount: packages.length,
                    repositories
                }
            })
        );
        child.stdin!.write(
            encodeEnvironmentFrame("SOURCE_CHUNK", { sequence: 0 }, archive)
        );
        child.stdin!.write(
            encodeEnvironmentFrame("SOURCE_COMPLETE", {
                byteCount: archive.length,
                sha256: sha256(archive)
            })
        );
        await waitFrame("PREPARED");
        child.stdin!.write(
            encodeEnvironmentFrame("RUN_CONFIG", { config: {} })
        );
        const deadline = Date.now() + 10000;
        while (!fs.existsSync(record)) {
            if (Date.now() > deadline)
                throw new Error(
                    "The forked worker never recorded its environment"
                );
            await new Promise((resolve) => setTimeout(resolve, 50));
        }
        return {
            env: JSON.parse(fs.readFileSync(record, "utf8")) as Record<
                string,
                string
            >,
            guestRoot: path.join(root, "guest")
        };
    } finally {
        child.kill("SIGKILL");
        fs.rmSync(root, { recursive: true, force: true });
    }
}
