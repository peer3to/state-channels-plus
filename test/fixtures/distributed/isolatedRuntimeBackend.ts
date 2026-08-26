// @spec-test-coverage-ignore: test-only isolated-runtime backend exercised by developer tooling tests
import { EventEmitter } from "events";
import { PassThrough } from "stream";

const {
    EnvironmentFrameParser,
    HOST_KINDS,
    encodeEnvironmentFrame
} = require("../../../scripts/e2e-parallel/distributed/environmentProtocol.js");

export class TestIsolatedRuntimeBackend {
    readonly calls: Array<{ operation: string; value?: unknown }> = [];
    readonly controls: Array<{
        stdin: PassThrough;
        stdout: PassThrough;
        stderr: PassThrough;
        process: EventEmitter & { kill: (signal: string) => void };
    }> = [];
    artifactOutput = { stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) };
    artifactChunks: Array<{ name: "stdout" | "stderr"; body: Buffer }> = [];
    completeArtifactTransfer = true;
    artifactTransferDelayMs = 0;
    creationDelayMs = 0;
    readonly firstCreateStarted: Promise<void>;
    readonly firstStartStarted: Promise<void>;
    readonly firstWorkspaceOfferReceived: Promise<void>;
    preparationDelayMs = 0;
    preparationFailureDelayMs = 0;
    preparationStatusIntervalMs = 0;
    stopDelayMs = 0;
    preparationFailuresRemaining = 0;
    startFailuresRemaining = 0;
    exitClassification: {
        resource: string;
        limit: number;
        phase: string;
        message: string;
    } | null = null;
    readonly preparedFiles = new Map<string, Set<string>>();
    respondToWorkspaceOffer = true;
    startDelayMs = 0;
    private resolveFirstCreateStarted!: () => void;
    private resolveFirstStartStarted!: () => void;
    private resolveFirstWorkspaceOfferReceived!: () => void;

    constructor() {
        this.firstCreateStarted = new Promise(
            (resolve) => (this.resolveFirstCreateStarted = resolve)
        );
        this.firstStartStarted = new Promise(
            (resolve) => (this.resolveFirstStartStarted = resolve)
        );
        this.firstWorkspaceOfferReceived = new Promise(
            (resolve) => (this.resolveFirstWorkspaceOfferReceived = resolve)
        );
    }

    async detect() {
        this.calls.push({ operation: "detect" });
        return { available: true };
    }

    async create(allocation: unknown) {
        this.calls.push({ operation: "create", value: allocation });
        this.resolveFirstCreateStarted();
        if (this.creationDelayMs) {
            await new Promise((resolve) =>
                setTimeout(resolve, this.creationDelayMs)
            );
        }
        const diskBytes =
            allocation &&
            typeof allocation === "object" &&
            "profile" in allocation &&
            allocation.profile &&
            typeof allocation.profile === "object" &&
            "diskBytes" in allocation.profile &&
            typeof allocation.profile.diskBytes === "number"
                ? allocation.profile.diskBytes
                : undefined;
        return {
            container: `test-${this.calls.length}`,
            volume: "test-volume",
            diskBytes
        };
    }

    async start(handle: unknown) {
        this.calls.push({ operation: "start", value: handle });
        this.resolveFirstStartStarted();
        if (this.startDelayMs) {
            await new Promise((resolve) =>
                setTimeout(resolve, this.startDelayMs)
            );
        }
        if (this.startFailuresRemaining > 0) {
            this.startFailuresRemaining -= 1;
            throw new Error("test isolated runtime start failed");
        }
        const stdin = new PassThrough();
        const stdout = new PassThrough();
        const stderr = new PassThrough();
        const processHandle = Object.assign(new EventEmitter(), {
            stdin,
            stdout,
            stderr,
            kill(signal: string) {
                processHandle.emit("exit", null, signal);
            }
        });
        const parser = new EnvironmentFrameParser({ allowedKinds: HOST_KINDS });
        const container =
            handle &&
            typeof handle === "object" &&
            "container" in handle &&
            typeof handle.container === "string"
                ? handle.container
                : "unknown";
        let offeredFiles: string[] = [];
        parser.on(
            "frame",
            (frame: {
                kind: string;
                payload: {
                    manifest?: { files: Array<{ path: string }> };
                    message?: { kind: string };
                    requestId?: number;
                    names?: Array<"stdout" | "stderr">;
                };
            }) => {
                this.calls.push({ operation: "frame", value: frame });
                if (frame.kind === "WORKSPACE_OFFER") {
                    this.resolveFirstWorkspaceOfferReceived();
                    if (!this.respondToWorkspaceOffer) return;
                    const manifest = frame.payload.manifest;
                    if (!manifest)
                        throw new Error("Missing test workspace manifest");
                    offeredFiles = manifest.files.map((entry) => entry.path);
                    const prepared =
                        this.preparedFiles.get(container) || new Set();
                    stdout.write(
                        encodeEnvironmentFrame("WORKSPACE_NEED", {
                            changed: offeredFiles.filter(
                                (entry) => !prepared.has(entry)
                            ),
                            deleted: []
                        })
                    );
                }
                if (frame.kind === "SOURCE_COMPLETE") {
                    if (this.preparationFailuresRemaining > 0) {
                        this.preparationFailuresRemaining -= 1;
                        this.preparedFiles.set(
                            container,
                            new Set(offeredFiles)
                        );
                        const fail = () =>
                            stdout.write(
                                encodeEnvironmentFrame("PREPARATION_FAILED", {
                                    message: "test preparation failed"
                                })
                            );
                        if (this.preparationFailureDelayMs) {
                            setTimeout(fail, this.preparationFailureDelayMs);
                        } else fail();
                    } else {
                        const complete = () => {
                            this.preparedFiles.set(
                                container,
                                new Set(offeredFiles)
                            );
                            stdout.write(encodeEnvironmentFrame("PREPARED"));
                        };
                        if (this.preparationDelayMs > 0) {
                            const activity = this.preparationStatusIntervalMs
                                ? setInterval(
                                      () =>
                                          stdout.write(
                                              encodeEnvironmentFrame("STATUS", {
                                                  status: "preparing"
                                              })
                                          ),
                                      this.preparationStatusIntervalMs
                                  )
                                : null;
                            setTimeout(() => {
                                if (activity) clearInterval(activity);
                                complete();
                            }, this.preparationDelayMs);
                        } else complete();
                    }
                }
                if (frame.kind === "RUN_CONFIG") {
                    stdout.write(
                        encodeEnvironmentFrame("WORKER_EVENT", {
                            message: { kind: "WORKER_READY" }
                        })
                    );
                }
                if (
                    frame.kind === "WORKER_MESSAGE" &&
                    frame.payload.message?.kind === "RUN_COMPLETE"
                ) {
                    stdout.write(
                        encodeEnvironmentFrame("WORKER_EVENT", {
                            message: { kind: "WORKER_COMPLETE", stats: null }
                        })
                    );
                }
                if (frame.kind === "ARTIFACT_REQUEST") {
                    const { names, requestId } = frame.payload;
                    if (!names || requestId === undefined) {
                        throw new Error("Missing test artifact request");
                    }
                    const respond = () => {
                        let sequence = 0;
                        const chunks = this.artifactChunks.length
                            ? this.artifactChunks.filter((entry) =>
                                  names.includes(entry.name)
                              )
                            : names.map((name) => ({
                                  name,
                                  body: this.artifactOutput[name]
                              }));
                        for (const { name, body } of chunks) {
                            if (!body.length) continue;
                            stdout.write(
                                encodeEnvironmentFrame(
                                    "ARTIFACT_CHUNK",
                                    {
                                        requestId,
                                        name,
                                        sequence: sequence++
                                    },
                                    body
                                )
                            );
                        }
                        if (this.completeArtifactTransfer) {
                            stdout.write(
                                encodeEnvironmentFrame("ARTIFACT_COMPLETE", {
                                    requestId,
                                    sequence
                                })
                            );
                        }
                    };
                    if (this.artifactTransferDelayMs) {
                        setTimeout(respond, this.artifactTransferDelayMs);
                    } else respond();
                }
                if (frame.kind === "STOP") {
                    const stop = () =>
                        stdout.write(encodeEnvironmentFrame("STOPPED"));
                    if (this.stopDelayMs) setTimeout(stop, this.stopDelayMs);
                    else stop();
                }
            }
        );
        stdin.on("data", (chunk) => parser.consume(chunk));
        this.controls.push({ stdin, stdout, stderr, process: processHandle });
        queueMicrotask(() => stdout.write(encodeEnvironmentFrame("READY")));
        return processHandle;
    }

    async stop(handle: unknown) {
        this.calls.push({ operation: "stop", value: handle });
    }

    async update(handle: unknown, profile: unknown) {
        this.calls.push({ operation: "update", value: { handle, profile } });
    }

    async destroy(handle: unknown) {
        this.calls.push({ operation: "destroy", value: handle });
    }

    async diagnostics() {
        return "test diagnostics";
    }

    async classifyExit(handle: unknown, profile: unknown) {
        this.calls.push({
            operation: "classifyExit",
            value: { handle, profile }
        });
        return this.exitClassification;
    }

    async listOrphans() {
        this.calls.push({ operation: "listOrphans" });
        return [];
    }

    frameKinds() {
        return this.calls.flatMap((entry) => {
            const value = entry.value;
            return entry.operation === "frame" &&
                value &&
                typeof value === "object" &&
                "kind" in value &&
                typeof value.kind === "string"
                ? [value.kind]
                : [];
        });
    }

    crash(index = this.controls.length - 1) {
        this.controls[index].process.emit("exit", 137, null);
    }

    emitWorkerEvent(message: unknown, artifactManifest: unknown[] = []) {
        const control = this.controls[this.controls.length - 1];
        control.stdout.write(
            encodeEnvironmentFrame("WORKER_EVENT", {
                message,
                artifactManifest
            })
        );
    }

    emitResourceLimit(failure: {
        resource: string;
        limit: number;
        phase: string;
        message: string;
    }) {
        const control = this.controls[this.controls.length - 1];
        control.stdout.write(
            encodeEnvironmentFrame("RESOURCE_LIMIT_EXCEEDED", failure)
        );
    }
}
