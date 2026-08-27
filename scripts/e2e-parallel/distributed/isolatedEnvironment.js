const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { EventEmitter } = require("events");
const { spawn } = require("child_process");
const {
    ENVIRONMENT_PROTOCOL_VERSION,
    EnvironmentFrameParser,
    GUEST_KINDS,
    encodeEnvironmentFrame
} = require("./environmentProtocol");
const { DISTRIBUTED_PROTOCOL_VERSION } = require("./protocol");
const {
    buildLinuxEgressRules,
    hostInterfaceCidrs,
    isolationCapability
} = require("./egressPolicy");
const { ResourceAllocationError } = require("./executionProfile");

const RUNTIME_LABEL = "peer3.distributed-environment";
const ENVIRONMENT_NAME_PREFIX = "peer3-test-";
const DOCKER_OPERATION_TIMEOUT_MS = 5 * 60 * 1000;

function assertEnvironmentKey(environmentKey) {
    if (
        typeof environmentKey !== "string" ||
        !/^[a-f0-9]{64}$/.test(environmentKey)
    ) {
        throw new Error("Invalid environment key");
    }
    return environmentKey;
}

function runtimeNames(environmentKey) {
    const key = assertEnvironmentKey(environmentKey);
    const short = key.slice(0, 24);
    return {
        container: `${ENVIRONMENT_NAME_PREFIX}${short}`,
        volume: `${ENVIRONMENT_NAME_PREFIX}${short}-data`,
        network: `${ENVIRONMENT_NAME_PREFIX}${short}-network`,
        bridge: `p3${short.slice(0, 10)}`,
        firewallChain: `P3_${short.slice(0, 20).toUpperCase()}`
    };
}

function mappedNamespaceId(mapping, containerId) {
    const range = mapping
        .trim()
        .split("\n")
        .map((line) => line.trim().split(/\s+/).map(Number))
        .find(
            ([containerStart, _hostStart, length]) =>
                containerId >= containerStart &&
                containerId < containerStart + length
        );
    if (!range) return undefined;
    const [containerStart, hostStart] = range;
    return hostStart + containerId - containerStart;
}

function trustedRunnerManifest(trustedRoot) {
    const files = [];
    const roots = [
        {
            source: path.join(trustedRoot, "scripts/e2e-parallel"),
            destination: "scripts/e2e-parallel"
        },
        {
            source: path.join(trustedRoot, "test/utils/nodeInfra.js"),
            destination: "test/utils/nodeInfra.js"
        },
        {
            source: path.join(
                trustedRoot,
                "scripts/infra/local-discovery-registry.js"
            ),
            destination: "scripts/infra/local-discovery-registry.js"
        }
    ];
    const visit = (source, destination) => {
        const stat = fs.statSync(source);
        if (stat.isDirectory()) {
            for (const name of fs.readdirSync(source).sort()) {
                visit(
                    path.join(source, name),
                    path.posix.join(destination, name)
                );
            }
            return;
        }
        files.push({
            path: destination,
            sha256: crypto
                .createHash("sha256")
                .update(fs.readFileSync(source))
                .digest("hex")
        });
    };
    for (const entry of roots) visit(entry.source, entry.destination);
    return files;
}

function runProcess(command, args, options = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: [options.input ? "pipe" : "ignore", "pipe", "pipe"]
        });
        const stdout = [];
        const stderr = [];
        let settled = false;
        const finish = (action, value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            action(value);
        };
        const timeout = options.timeoutMs
            ? setTimeout(() => {
                  child.kill("SIGKILL");
                  finish(
                      reject,
                      new Error(
                          `${command} timed out after ${options.timeoutMs}ms`
                      )
                  );
              }, options.timeoutMs)
            : null;
        timeout?.unref();
        child.stdout.on("data", (chunk) => stdout.push(chunk));
        child.stderr.on("data", (chunk) => stderr.push(chunk));
        child.once("error", (error) => finish(reject, error));
        child.once("exit", (code, signal) => {
            const output = Buffer.concat(stdout);
            const errorOutput = Buffer.concat(stderr);
            if (code === 0)
                finish(resolve, { stdout: output, stderr: errorOutput });
            else {
                const error = new Error(
                    `${command} failed (${code ?? signal}): ${errorOutput.toString("utf8").trim()}`
                );
                error.code = code;
                error.signal = signal;
                error.stdout = output;
                error.stderr = errorOutput;
                finish(reject, error);
            }
        });
        if (options.input) child.stdin.end(options.input);
    });
}

class DockerBackend {
    constructor(options = {}) {
        const run = options.run || runProcess;
        const operationTimeoutMs =
            options.operationTimeoutMs || DOCKER_OPERATION_TIMEOUT_MS;
        this.run = (command, args, runOptions = {}) =>
            run(command, args, {
                timeoutMs: operationTimeoutMs,
                ...runOptions
            });
        this.image = options.image;
        this.trustedRoot =
            options.trustedRoot || path.resolve(__dirname, "../../..");
        this.platform = options.platform || process.platform;
        this.processFactory = options.processFactory || spawn;
        this.deniedPrivateCidrs = options.deniedPrivateCidrs || [];
        this.hostCidrs =
            options.hostCidrs || hostInterfaceCidrs(os.networkInterfaces());
        this.volumeDriver = options.volumeDriver || "local";
        this.securityOptions = [];
        this.usernsHostRunnerUid = undefined;
        this.usernsHostRunnerGid = undefined;
    }

    async detect() {
        if (
            !this.image ||
            (!/^sha256:[a-f0-9]{64}$/.test(this.image) &&
                !/@sha256:[a-f0-9]{64}$/.test(this.image))
        ) {
            return {
                available: false,
                reason: "A digest-pinned repository image or immutable local image ID is required"
            };
        }
        try {
            const info = await this.run("docker", [
                "info",
                "--format",
                "{{json .SecurityOptions}}"
            ]);
            this.securityOptions = JSON.parse(
                info.stdout.toString("utf8").trim() || "[]"
            );
            if (
                this.platform === "linux" &&
                !this.securityOptions.some(
                    (entry) =>
                        entry.includes("userns") || entry.includes("rootless")
                )
            ) {
                return {
                    available: false,
                    reason: "Docker user namespaces or rootless mode are required"
                };
            }
            if (this.platform === "linux") {
                await this.run("iptables", ["-S", "DOCKER-USER"]);
            }
            await this.run("docker", ["image", "inspect", this.image]);
            if (
                this.securityOptions.some((entry) => entry.includes("userns"))
            ) {
                const mappingResult = await this.run("docker", [
                    "run",
                    "--rm",
                    "--network=none",
                    "--read-only",
                    "--cap-drop=ALL",
                    "--security-opt=no-new-privileges:true",
                    "--user",
                    "0:0",
                    this.image,
                    "node",
                    "-e",
                    "const f=require('fs');process.stdout.write(JSON.stringify({uid:f.readFileSync('/proc/self/uid_map','utf8'),gid:f.readFileSync('/proc/self/gid_map','utf8')}))"
                ]);
                const mappings = JSON.parse(
                    mappingResult.stdout.toString("utf8")
                );
                this.usernsHostRunnerUid = mappedNamespaceId(
                    mappings.uid,
                    10001
                );
                this.usernsHostRunnerGid = mappedNamespaceId(
                    mappings.gid,
                    10001
                );
                if (
                    !Number.isSafeInteger(this.usernsHostRunnerUid) ||
                    !Number.isSafeInteger(this.usernsHostRunnerGid)
                ) {
                    return {
                        available: false,
                        reason: "Docker user namespace mapping is unavailable"
                    };
                }
            }
            return { available: true };
        } catch (error) {
            return { available: false, reason: error.message };
        }
    }

    async create(allocation) {
        const names = runtimeNames(allocation.environmentKey);
        const handle = {
            ...names,
            environmentKey: allocation.environmentKey,
            diskBytes: allocation.profile.diskBytes
        };
        try {
            await this.run("docker", [
                "volume",
                "create",
                "--driver",
                this.volumeDriver,
                "--opt",
                `size=${allocation.profile.diskBytes}`,
                "--label",
                `${RUNTIME_LABEL}=true`,
                "--label",
                `peer3.environment-key=${allocation.environmentKey}`,
                names.volume
            ]);
            await this.initializeVolume(names.volume);
            await this.run("docker", [
                "network",
                "create",
                "--driver",
                "bridge",
                "--ipv6=false",
                "--opt",
                `com.docker.network.bridge.name=${names.bridge}`,
                "--label",
                `${RUNTIME_LABEL}=true`,
                names.network
            ]);
            const args = [
                "create",
                "--name",
                names.container,
                "--label",
                `${RUNTIME_LABEL}=true`,
                "--label",
                `peer3.environment-key=${allocation.environmentKey}`,
                "--read-only",
                "--init",
                "--cap-drop=ALL",
                "--security-opt=no-new-privileges:true",
                "--pids-limit",
                String(allocation.profile.pidsLimit),
                "--cpus",
                String(allocation.profile.cpu),
                "--memory",
                String(allocation.profile.memoryBytes),
                "--memory-swap",
                String(allocation.profile.memoryBytes),
                "--env",
                "HOME=/environment/home",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,nodev,size=256m",
                "--mount",
                `type=volume,source=${names.volume},target=/environment`,
                "--user",
                "10001:10001",
                "--network",
                names.network,
                this.image,
                "node",
                "-e",
                "process.on('SIGTERM',()=>process.exit(0));setInterval(()=>{},2147483647)"
            ];
            if (
                this.securityOptions?.some((entry) =>
                    entry.includes("apparmor")
                )
            ) {
                args.splice(
                    args.indexOf("--pids-limit"),
                    0,
                    "--security-opt=apparmor=docker-default"
                );
            }
            await this.run("docker", args);
            return handle;
        } catch (error) {
            await this.destroy(handle);
            throw error;
        }
    }

    async initializeVolume(volume) {
        const runnerUid = 10001;
        const mappedRunnerUid = this.usernsHostRunnerUid ?? runnerUid;
        const mappedRunnerGid = this.usernsHostRunnerGid ?? runnerUid;
        const args = [
            "run",
            "--rm",
            "--network=none",
            "--read-only",
            "--cap-drop=ALL",
            "--cap-add=CHOWN",
            "--security-opt=no-new-privileges:true"
        ];
        if (this.usernsHostRunnerUid !== undefined) {
            args.push("--userns=host");
        }
        args.push(
            "--user",
            "0:0",
            "--mount",
            `type=volume,source=${volume},target=/environment`,
            this.image,
            "chown",
            `${mappedRunnerUid}:${mappedRunnerGid}`,
            "/environment"
        );
        await this.run("docker", args);
    }

    async start(handle) {
        await this.run("docker", ["start", handle.container]);
        if (this.platform === "linux") await this.applyEgressPolicy(handle);
        await this.refreshTrustedRunner(handle);
        handle.resourceEvents = await this.readResourceEvents(handle);
        return this.openControl(handle);
    }

    async update(handle, profile) {
        await this.run("docker", [
            "update",
            "--cpus",
            String(profile.cpu),
            "--memory",
            String(profile.memoryBytes),
            "--memory-swap",
            String(profile.memoryBytes),
            "--pids-limit",
            String(profile.pidsLimit),
            handle.container
        ]);
    }

    async readResourceEvents(handle) {
        const read = async (file) => {
            const result = await this.run("docker", [
                "exec",
                "--user",
                "10001:10001",
                handle.container,
                "cat",
                `/sys/fs/cgroup/${file}.events`
            ]).catch(() => ({ stdout: Buffer.alloc(0) }));
            return Object.fromEntries(
                result.stdout
                    .toString("utf8")
                    .trim()
                    .split("\n")
                    .filter(Boolean)
                    .map((line) => {
                        const [key, value] = line.split(/\s+/, 2);
                        return [key, Number(value)];
                    })
            );
        };
        return {
            memory: await read("memory"),
            pids: await read("pids")
        };
    }

    async applyEgressPolicy(handle) {
        const inspected = await this.run("docker", [
            "inspect",
            "--format",
            `{{(index .NetworkSettings.Networks \"${handle.network}\").IPAddress}}`,
            handle.container
        ]);
        const address = inspected.stdout.toString("utf8").trim();
        await this.run("iptables", [
            "-D",
            "DOCKER-USER",
            "-i",
            handle.bridge,
            "-s",
            address,
            "-j",
            handle.firewallChain
        ]).catch(() => {});
        await this.run("iptables", ["-F", handle.firewallChain]).catch(
            () => {}
        );
        await this.run("iptables", ["-X", handle.firewallChain]).catch(
            () => {}
        );
        handle.containerAddress = address;
        const rules = buildLinuxEgressRules(
            handle.bridge,
            address,
            [...this.deniedPrivateCidrs, ...this.hostCidrs],
            handle.firewallChain
        );
        for (const rule of rules) await this.run("iptables", rule);
    }

    async refreshTrustedRunner(handle) {
        await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "rm",
            "-rf",
            "/environment/trusted-runner"
        ]);
        await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "mkdir",
            "-p",
            "/environment/trusted-runner"
        ]);
        const archive = await this.run("tar", [
            "-C",
            this.trustedRoot,
            "-cf",
            "-",
            "scripts/e2e-parallel",
            "scripts/infra/local-discovery-registry.js",
            "test/utils/nodeInfra.js"
        ]);
        await this.run(
            "docker",
            [
                "exec",
                "-i",
                "--user",
                "10001:10001",
                handle.container,
                "tar",
                "-xf",
                "-",
                "-C",
                "/environment/trusted-runner"
            ],
            { input: archive.stdout }
        );
        await this.run(
            "docker",
            [
                "exec",
                "-i",
                "--user",
                "10001:10001",
                handle.container,
                "node",
                "-e",
                "const f=require('fs'),c=[];process.stdin.on('data',d=>c.push(d));process.stdin.on('end',()=>f.writeFileSync('/environment/trusted-runner/manifest.json',Buffer.concat(c),{mode:0o600}))"
            ],
            {
                input: Buffer.from(
                    JSON.stringify(trustedRunnerManifest(this.trustedRoot))
                )
            }
        );
        await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "node",
            "-e",
            "const c=require('crypto'),f=require('fs'),p=require('path'),r='/environment/trusted-runner';for(const e of JSON.parse(f.readFileSync(p.join(r,'manifest.json')))){const h=c.createHash('sha256').update(f.readFileSync(p.join(r,e.path))).digest('hex');if(h!==e.sha256)throw Error('trusted runner verification failed')}"
        ]);
    }

    openControl(handle) {
        const child = this.processFactory(
            "docker",
            [
                "exec",
                "-i",
                "--user",
                "10001:10001",
                "--env",
                "NODE_PATH=/usr/local/lib/node_modules",
                handle.container,
                "node",
                "/environment/trusted-runner/scripts/e2e-parallel/distributed/isolatedGuest.js"
            ],
            { stdio: ["pipe", "pipe", "pipe"] }
        );
        return child;
    }

    async operatorSelfCheck(handle, hostSentinelPath) {
        const script = [
            "const fs=require('fs'),http=require('http'),path=require('path');",
            "try{fs.mkdirSync(path.dirname(process.env.PEER3_HOST_SENTINEL),{recursive:true});",
            "fs.writeFileSync(process.env.PEER3_HOST_SENTINEL,'guest-copy');}",
            "catch(error){if(!['EROFS','ENOENT','EACCES'].includes(error.code))throw error;}",
            "const server=http.createServer((request,response)=>response.end('loopback-ok'));",
            "server.listen(0,'127.0.0.1',()=>{",
            "const port=server.address().port;",
            "http.get({host:'127.0.0.1',port},response=>{",
            "const chunks=[];response.on('data',chunk=>chunks.push(chunk));",
            "response.on('end',()=>{fs.mkdirSync('/environment/transient',{recursive:true});",
            "fs.writeFileSync('/environment/transient/self-check-artifact',Buffer.concat(chunks));server.close();});",
            "}).on('error',error=>{throw error});",
            "});"
        ].join("");
        await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            "--env",
            `PEER3_HOST_SENTINEL=${hostSentinelPath}`,
            handle.container,
            "node",
            "-e",
            script
        ]);
        const artifact = await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "node",
            "-e",
            "process.stdout.write(require('fs').readFileSync('/environment/transient/self-check-artifact'))"
        ]);
        return artifact.stdout;
    }

    async operatorResourceSnapshot(handle) {
        const stats = await this.run("docker", [
            "stats",
            "--no-stream",
            "--format",
            "{{json .}}",
            handle.container
        ]);
        const disk = await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "du",
            "-sb",
            "/environment"
        ]);
        return {
            ...JSON.parse(stats.stdout.toString("utf8")),
            environmentDiskBytes: Number(
                disk.stdout.toString("utf8").split(/\s+/, 1)[0]
            )
        };
    }

    async operatorConfiguredLimits(handle) {
        const result = await this.run("docker", [
            "inspect",
            "--format",
            "{{json .HostConfig}}",
            handle.container
        ]);
        const config = JSON.parse(result.stdout.toString("utf8"));
        return {
            cpu: config.NanoCpus / 1e9,
            memoryBytes: config.Memory,
            memorySwapBytes: config.MemorySwap,
            pidsLimit: config.PidsLimit
        };
    }

    async operatorIdentityMarker(handle, marker) {
        if (marker !== undefined) {
            await this.run("docker", [
                "exec",
                "--user",
                "10001:10001",
                handle.container,
                "node",
                "-e",
                "require('fs').writeFileSync('/environment/identity-marker',process.argv[1])",
                marker
            ]);
        }
        const result = await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "node",
            "-e",
            "const f=require('fs');process.stdout.write(f.existsSync('/environment/identity-marker')?f.readFileSync('/environment/identity-marker'):'')"
        ]);
        return result.stdout.toString("utf8");
    }

    async operatorNetworkCheck(handle) {
        const inspected = await this.run("docker", [
            "inspect",
            "--format",
            `{{(index .NetworkSettings.Networks "${handle.network}").Gateway}}`,
            handle.container
        ]);
        const gateway = inspected.stdout.toString("utf8").trim();
        const script = [
            "const http=require('http'),https=require('https'),net=require('net');",
            "const local=new Promise((resolve,reject)=>{const s=http.createServer((q,r)=>r.end('ok'));",
            "s.listen(0,'127.0.0.1',()=>http.get({host:'127.0.0.1',port:s.address().port},r=>{",
            "r.resume();r.on('end',()=>s.close(()=>resolve(true)));}).on('error',reject));});",
            "const publicRequest=new Promise((resolve,reject)=>{const q=https.get('https://example.com',r=>{r.resume();r.on('end',()=>resolve(true));});",
            "q.setTimeout(10000,()=>q.destroy(Error('public egress timeout')));q.on('error',reject);});",
            "const privateBlocked=new Promise((resolve,reject)=>{const s=net.connect({host:process.argv[1],port:80});",
            "s.setTimeout(2000);s.on('connect',()=>{s.destroy();reject(Error('worker gateway reachable'));});",
            "s.on('timeout',()=>{s.destroy();resolve(true);});s.on('error',()=>resolve(true));});",
            "Promise.all([local,publicRequest,privateBlocked]).then(()=>process.stdout.write('network-ok'));"
        ].join("");
        const result = await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "node",
            "-e",
            script,
            gateway
        ]);
        return result.stdout.toString("utf8");
    }

    async operatorProcessLimitCheck(handle) {
        const before = await this.readResourceEvents(handle);
        const script = [
            "const {spawn}=require('child_process');const children=[];let done=false;",
            "const finish=denied=>{if(done)return;done=true;for(const child of children)child.kill('SIGKILL');",
            "setTimeout(()=>{if(!denied)process.exitCode=2;else process.stdout.write('process-limit-ok');},100);};",
            "const launch=()=>{if(children.length>=10000)return finish(false);const child=spawn('sleep',['10'],{stdio:'ignore'});",
            "child.once('spawn',()=>{children.push(child);setImmediate(launch);});",
            "child.once('error',error=>{if(error.code==='EAGAIN')finish(true);else{process.stderr.write(error.message);process.exit(3);}});};",
            "setTimeout(()=>finish(false),5000);launch();"
        ].join("");
        const result = await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "node",
            "-e",
            script
        ]);
        const after = await this.readResourceEvents(handle);
        if ((after.pids.max || 0) <= (before.pids.max || 0)) {
            throw new Error("Process cgroup did not record a limit event");
        }
        return result.stdout.toString("utf8");
    }

    async operatorMemoryLimitCheck(handle) {
        const before = await this.readResourceEvents(handle);
        await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "node",
            "-e",
            "const allocations=[];while(true)allocations.push(Buffer.alloc(16*1024*1024,1))"
        ]).then(
            () => {
                throw new Error("Memory limit was not enforced");
            },
            () => {}
        );
        const after = await this.readResourceEvents(handle);
        if ((after.memory.oom_kill || 0) <= (before.memory.oom_kill || 0)) {
            throw new Error("Memory cgroup did not record an OOM kill");
        }
        return "memory-limit-ok";
    }

    async operatorDiskLimitCheck(handle) {
        const script = [
            "const fs=require('fs');const file='/environment/transient/disk-limit-check';",
            "fs.mkdirSync('/environment/transient',{recursive:true});const fd=fs.openSync(file,'w');",
            "const chunk=Buffer.alloc(8*1024*1024,1);let limited=false;try{while(true)fs.writeSync(fd,chunk);}catch(error){limited=error.code==='ENOSPC';}",
            "fs.closeSync(fd);fs.rmSync(file,{force:true});if(!limited)process.exitCode=2;else process.stdout.write('disk-limit-ok');"
        ].join("");
        const result = await this.run("docker", [
            "exec",
            "--user",
            "10001:10001",
            handle.container,
            "node",
            "-e",
            script
        ]);
        return result.stdout.toString("utf8");
    }

    async stop(handle) {
        await this.run("docker", ["stop", "--time", "10", handle.container], {
            timeoutMs: 15000
        });
        await this.removeEgressPolicy(handle);
    }

    async removeEgressPolicy(handle) {
        if (
            this.platform === "linux" &&
            handle.firewallChain &&
            handle.containerAddress
        ) {
            await this.run("iptables", [
                "-D",
                "DOCKER-USER",
                "-i",
                handle.bridge,
                "-s",
                handle.containerAddress,
                "-j",
                handle.firewallChain
            ]).catch(() => {});
            await this.run("iptables", ["-F", handle.firewallChain]).catch(
                () => {}
            );
            await this.run("iptables", ["-X", handle.firewallChain]).catch(
                () => {}
            );
            delete handle.containerAddress;
        }
    }

    async destroy(handle) {
        await this.removeEgressPolicy(handle);
        await this.run("docker", ["rm", "--force", handle.container]).catch(
            () => {}
        );
        await this.run("docker", ["network", "rm", handle.network]).catch(
            () => {}
        );
        await this.run("docker", [
            "volume",
            "rm",
            "--force",
            handle.volume
        ]).catch(() => {});
    }

    async diagnostics(handle) {
        const inspect = await this.run("docker", [
            "inspect",
            "--format",
            "{{json .State}}",
            handle.container
        ]).catch(() => null);
        if (!inspect) return "Container state is unavailable";
        const state = JSON.parse(inspect.stdout.toString("utf8"));
        return JSON.stringify({
            status: state.Status,
            exitCode: state.ExitCode,
            oomKilled: state.OOMKilled,
            startedAt: state.StartedAt,
            finishedAt: state.FinishedAt
        });
    }

    async classifyExit(handle, profile) {
        const result = await this.run("docker", [
            "inspect",
            "--format",
            "{{json .State}}",
            handle.container
        ]).catch(() => null);
        if (!result) return null;
        const state = JSON.parse(result.stdout.toString("utf8"));
        const events = await this.readResourceEvents(handle);
        if (
            state.OOMKilled ||
            (events.memory.oom_kill || 0) >
                (handle.resourceEvents?.memory?.oom_kill || 0)
        ) {
            return {
                resource: "memory",
                limit: profile.memoryBytes,
                phase: "execution",
                message: "Container was killed by its memory cgroup"
            };
        }
        if ((events.pids.max || 0) > (handle.resourceEvents?.pids?.max || 0)) {
            return {
                resource: "process",
                limit: profile.pidsLimit,
                phase: "execution",
                message: "Container reached its cgroup process limit"
            };
        }
        return null;
    }

    async listOrphans() {
        const result = await this.run("docker", [
            "ps",
            "-a",
            "--filter",
            `label=${RUNTIME_LABEL}=true`,
            "--format",
            '{{.Names}} {{.Label "peer3.environment-key"}}'
        ]).catch(() => ({ stdout: Buffer.alloc(0) }));
        return result.stdout
            .toString("utf8")
            .split("\n")
            .map((entry) => entry.trim())
            .filter(Boolean)
            .map((entry) => {
                const [container, environmentKey] = entry.split(/\s+/, 2);
                if (!/^[a-f0-9]{64}$/.test(environmentKey || "")) {
                    return { container };
                }
                return { ...runtimeNames(environmentKey), environmentKey };
            });
    }
}

class UnsafeHostBackend {
    constructor(options = {}) {
        this.processFactory = options.processFactory || spawn;
        this.workRoot = options.workRoot;
    }

    async detect() {
        return { available: true };
    }

    async create(allocation) {
        const root = path.join(
            this.workRoot,
            "environments",
            assertEnvironmentKey(allocation.environmentKey),
            "unsafe-host"
        );
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        return { environmentKey: allocation.environmentKey, root };
    }

    async update() {}

    async start(handle) {
        const home = path.join(handle.root, "home");
        fs.mkdirSync(home, { recursive: true, mode: 0o700 });
        return this.processFactory(
            process.execPath,
            [path.join(__dirname, "isolatedGuest.js")],
            {
                env: {
                    ...process.env,
                    HOME: home,
                    SCP_ISOLATED_ROOT: handle.root
                },
                stdio: ["pipe", "pipe", "pipe", "ipc"]
            }
        );
    }

    async stop(handle, control) {
        control?.kill("SIGTERM");
        await new Promise((resolve) => setTimeout(resolve, 25));
    }

    async destroy(handle) {
        fs.rmSync(handle.root, { recursive: true, force: true });
    }

    async diagnostics() {
        return "unsafe host execution enabled";
    }

    async listOrphans() {
        return [];
    }
}

class IsolatedEnvironment extends EventEmitter {
    constructor(manager, allocation, handle) {
        super();
        this.manager = manager;
        this.allocation = allocation;
        this.handle = handle;
        this.state = "created";
        this.control = null;
        this.parser = null;
        this.pending = [];
        this.resourceFailureReported = false;
    }

    async start() {
        if (this.state !== "created" && this.state !== "stopped") {
            throw new Error(`Cannot start environment from ${this.state}`);
        }
        this.state = "starting";
        this.resourceFailureReported = false;
        this.control = await this.manager.backend.start(this.handle);
        this.parser = new EnvironmentFrameParser({
            allowedKinds: GUEST_KINDS,
            direction: "guest"
        });
        this.control.stdout.on("data", (chunk) => this.parser.consume(chunk));
        this.control.stderr.on("data", (chunk) =>
            this.emit("diagnostic", chunk)
        );
        this.control.stdin.on("error", (error) => {
            if (
                this.state !== "stopping" &&
                this.state !== "stopped" &&
                this.state !== "destroyed"
            ) {
                error.code ||= "ISOLATED_CONTROL_WRITE";
                this.fail(error);
            }
        });
        this.parser.on("frame", (frame) => this.receive(frame));
        this.parser.on("error", (error) => {
            error.code = "ISOLATED_CONTROL_PROTOCOL";
            this.fail(error);
        });
        this.control.once("exit", (code, signal) => {
            if (this.state !== "stopping" && this.state !== "stopped") {
                Promise.resolve(this.classifyExit()).then((classification) => {
                    if (classification && this.claimResourceFailureReport()) {
                        this.emit("resourceLimit", classification);
                    } else if (!this.resourceFailureReported) {
                        const error = new Error(
                            `Isolated environment exited (${code ?? signal})`
                        );
                        error.code = "ISOLATED_ENVIRONMENT_EXIT";
                        this.fail(error);
                    }
                });
            }
        });
        const ready = await this.waitFor("READY", 10000);
        if (
            ready.payload.distributedProtocol !== DISTRIBUTED_PROTOCOL_VERSION
        ) {
            const error = new Error(
                `Distributed guest protocol mismatch: worker host requires ${DISTRIBUTED_PROTOCOL_VERSION}, cached guest provides ${ready.payload.distributedProtocol ?? "none"}. Restart the worker server to rebuild the environment.`
            );
            error.code = "ISOLATED_PROTOCOL_MISMATCH";
            throw error;
        }
        this.state = "ready";
        await this.send("TRUSTED_RUNNER", {
            version: ENVIRONMENT_PROTOCOL_VERSION
        });
        return this;
    }

    send(kind, payload = {}, body = Buffer.alloc(0)) {
        if (!this.control?.stdin?.writable) {
            throw new Error("Isolated environment control channel is closed");
        }
        const frame = encodeEnvironmentFrame(kind, payload, body);
        return new Promise((resolve, reject) => {
            this.control.stdin.write(frame, (error) =>
                error ? reject(error) : resolve()
            );
        });
    }

    waitFor(kind, timeoutMs, signal) {
        const buffered = this.pending.findIndex((frame) => frame.kind === kind);
        if (buffered >= 0)
            return Promise.resolve(this.pending.splice(buffered, 1)[0]);
        return new Promise((resolve, reject) => {
            let timer;
            const onAbort = () => {
                cleanup();
                const error = new Error(
                    `Cancelled waiting for isolated ${kind}`
                );
                error.code = "ISOLATED_WAIT_ABORTED";
                reject(error);
            };
            const onFrame = (frame) => {
                if (frame.kind !== kind) return;
                cleanup();
                resolve(frame);
            };
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.off("frame", onFrame);
                this.off("failure", onError);
                signal?.removeEventListener("abort", onAbort);
            };
            this.on("frame", onFrame);
            this.on("failure", onError);
            signal?.addEventListener("abort", onAbort, { once: true });
            if (signal?.aborted) {
                onAbort();
                return;
            }
            timer = setTimeout(() => {
                cleanup();
                reject(new Error(`Timed out waiting for isolated ${kind}`));
            }, timeoutMs);
        });
    }

    waitForActivity(kind, inactivityTimeoutMs) {
        const buffered = this.pending.findIndex((frame) => frame.kind === kind);
        if (buffered >= 0)
            return Promise.resolve(this.pending.splice(buffered, 1)[0]);
        return new Promise((resolve, reject) => {
            let timer;
            const arm = () => {
                clearTimeout(timer);
                timer = setTimeout(() => {
                    cleanup();
                    const error = new Error(
                        `Timed out waiting for isolated ${kind} after ${inactivityTimeoutMs}ms of inactivity`
                    );
                    error.code = "ISOLATED_INACTIVITY_TIMEOUT";
                    reject(error);
                }, inactivityTimeoutMs);
            };
            const onFrame = (frame) => {
                if (frame.kind === "PREPARATION_FAILED") {
                    const error = new Error(frame.payload.message);
                    error.code = "RECOVERABLE_PREPARATION_FAILURE";
                    cleanup();
                    reject(error);
                    return;
                }
                if (frame.kind !== kind) {
                    arm();
                    return;
                }
                cleanup();
                resolve(frame);
            };
            const onError = (error) => {
                cleanup();
                reject(error);
            };
            const cleanup = () => {
                clearTimeout(timer);
                this.off("frame", onFrame);
                this.off("failure", onError);
            };
            this.on("frame", onFrame);
            this.on("failure", onError);
            arm();
        });
    }

    receive(frame) {
        const observed = this.listenerCount("frame") > 0;
        this.emit("frame", frame);
        if (!observed) this.pending.push(frame);
    }

    fail(error) {
        this.state = "failed";
        this.emit("failure", error);
    }

    async stop() {
        if (this.state === "stopped") return;
        const previousState = this.state;
        this.state = "stopping";
        if (previousState === "ready" && this.control?.stdin?.writable) {
            const stopped = this.waitFor("STOPPED", 5000);
            await Promise.resolve()
                .then(() => this.send("STOP"))
                .catch(() => {});
            await stopped.catch(() => {});
        }
        await this.manager.backend.stop(this.handle, this.control);
        this.state = "stopped";
    }

    async destroy() {
        if (
            this.state === "ready" ||
            this.state === "starting" ||
            this.state === "stopping"
        ) {
            await this.stop();
        }
        await this.manager.backend.destroy(this.handle);
        this.state = "destroyed";
        this.manager.forget(this.allocation.environmentKey);
    }

    async classifyExit() {
        return this.manager.backend.classifyExit?.(
            this.handle,
            this.allocation.profile
        );
    }

    claimResourceFailureReport() {
        if (this.resourceFailureReported) return false;
        this.resourceFailureReported = true;
        return true;
    }

    diagnostics() {
        return this.manager.backend.diagnostics(this.handle);
    }
}

class IsolatedEnvironmentManager {
    constructor(options) {
        this.workRoot = path.resolve(options.workRoot);
        this.backend = options.backend;
        this.backendName = options.backendName || "docker";
        this.isolation = options.isolation || isolationCapability();
        this.generation = crypto.randomUUID();
        this.metadataRoot = path.join(
            this.workRoot,
            "host-state",
            "environments"
        );
        this.environments = new Map();
        this.blockedEnvironments = new Map();
        fs.mkdirSync(this.metadataRoot, { recursive: true, mode: 0o700 });
    }

    static async create(options) {
        const requestedBackend = options.executionBackend || "docker";
        if (!["docker", "unsafe-host"].includes(requestedBackend)) {
            throw new Error(
                `Unsupported execution backend: ${requestedBackend}`
            );
        }
        const selected = options.backend
            ? options.backend
            : requestedBackend === "unsafe-host"
              ? new UnsafeHostBackend({ workRoot: options.workRoot })
              : new DockerBackend({
                    image: options.runnerImage,
                    trustedRoot: options.trustedRoot,
                    deniedPrivateCidrs: options.deniedPrivateCidrs,
                    volumeDriver: options.volumeDriver
                });
        const backendName = options.backendName || requestedBackend;
        const capability = await selected.detect();
        if (!capability.available) {
            throw new Error(
                `${backendName} execution backend is unavailable: ${capability.reason}`
            );
        }
        return new IsolatedEnvironmentManager({
            ...options,
            backend: selected,
            backendName,
            isolation:
                backendName === "docker"
                    ? isolationCapability(options.platform)
                    : {
                          backend: "unsafe-host",
                          kernelIsolation: "none",
                          filesystem: "none",
                          network: "host",
                          hardenedSharedWorker: false
                      }
        });
    }

    metadataPath(environmentKey) {
        return path.join(
            this.metadataRoot,
            `${assertEnvironmentKey(environmentKey)}.json`
        );
    }

    writeMetadata(environment, dirty) {
        const file = this.metadataPath(environment.allocation.environmentKey);
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(
            temporary,
            JSON.stringify({
                version: 1,
                environmentKey: environment.allocation.environmentKey,
                backend: this.backendName,
                runtimeHandle: environment.handle,
                allocation: environment.allocation,
                workerGeneration: this.generation,
                dirty,
                updatedAt: Date.now()
            }),
            { mode: 0o600 }
        );
        fs.renameSync(temporary, file);
        fs.chmodSync(file, 0o600);
    }

    async allocate(allocation) {
        assertEnvironmentKey(allocation.environmentKey);
        const recoveryFailure = this.blockedEnvironments.get(
            allocation.environmentKey
        );
        if (recoveryFailure) {
            throw new Error(
                `Environment orphan cleanup is unconfirmed: ${recoveryFailure.message}`
            );
        }
        const existing = this.environments.get(allocation.environmentKey);
        if (
            existing &&
            existing.state !== "destroyed" &&
            existing.state !== "failed"
        ) {
            const currentProfile = existing.allocation.profile;
            const createdDiskBytes =
                existing.handle.diskBytes ?? currentProfile.diskBytes;
            if (allocation.profile.diskBytes > createdDiskBytes) {
                throw new ResourceAllocationError(
                    "diskBytes",
                    allocation.profile.diskBytes,
                    createdDiskBytes
                );
            }
            if (
                allocation.profile.cpu !== currentProfile.cpu ||
                allocation.profile.memoryBytes !== currentProfile.memoryBytes ||
                allocation.profile.pidsLimit !== currentProfile.pidsLimit
            ) {
                await this.backend.update(existing.handle, allocation.profile);
            }
            existing.allocation = allocation;
            this.writeMetadata(existing, true);
            return existing;
        }
        const handle = await this.backend.create(allocation);
        const environment = new IsolatedEnvironment(this, allocation, handle);
        this.environments.set(allocation.environmentKey, environment);
        this.writeMetadata(environment, true);
        return environment;
    }

    markClean(environment) {
        this.writeMetadata(environment, false);
    }

    block(environmentKey, error) {
        this.blockedEnvironments.set(
            assertEnvironmentKey(environmentKey),
            error
        );
    }

    forget(environmentKey) {
        this.environments.delete(environmentKey);
        this.blockedEnvironments.delete(environmentKey);
        fs.rmSync(this.metadataPath(environmentKey), { force: true });
    }

    async evict(environmentKey) {
        const environment = this.environments.get(environmentKey);
        if (environment) {
            await environment.destroy();
        } else {
            const metadataPath = this.metadataPath(environmentKey);
            if (fs.existsSync(metadataPath)) {
                const metadata = JSON.parse(
                    fs.readFileSync(metadataPath, "utf8")
                );
                if (metadata.runtimeHandle) {
                    await this.backend.destroy(metadata.runtimeHandle);
                }
                fs.rmSync(metadataPath, { force: true });
            }
        }
    }

    async recoverOrphans() {
        const orphans = await this.backend.listOrphans();
        const recoveredNames = new Set();
        for (const name of fs.readdirSync(this.metadataRoot)) {
            if (!name.endsWith(".json")) continue;
            const metadataPath = path.join(this.metadataRoot, name);
            let metadata;
            try {
                metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
            } catch {
                continue;
            }
            if (
                metadata.version !== 1 ||
                metadata.backend !== this.backendName ||
                !metadata.runtimeHandle
            ) {
                continue;
            }
            if (metadata.runtimeHandle.container) {
                recoveredNames.add(metadata.runtimeHandle.container);
            }
            try {
                await this.backend.stop(metadata.runtimeHandle);
            } catch (error) {
                this.blockedEnvironments.set(metadata.environmentKey, error);
                continue;
            }
            if (metadata.dirty || !metadata.allocation) {
                await this.backend
                    .destroy(metadata.runtimeHandle)
                    .catch(() => {});
                fs.rmSync(metadataPath, { force: true });
                if (metadata.environmentKey) {
                    fs.rmSync(
                        path.join(
                            this.workRoot,
                            "environments",
                            metadata.environmentKey
                        ),
                        { recursive: true, force: true }
                    );
                }
                continue;
            }
            const environment = new IsolatedEnvironment(
                this,
                metadata.allocation,
                metadata.runtimeHandle
            );
            environment.state = "stopped";
            this.environments.set(metadata.environmentKey, environment);
        }
        for (const orphan of orphans) {
            const handle =
                typeof orphan === "string" ? { container: orphan } : orphan;
            if (recoveredNames.has(handle.container)) continue;
            try {
                await this.backend.stop(handle);
                if (handle.environmentKey) {
                    await this.backend.destroy(handle);
                    fs.rmSync(
                        path.join(
                            this.workRoot,
                            "environments",
                            handle.environmentKey
                        ),
                        { recursive: true, force: true }
                    );
                }
            } catch {
                // An unowned runtime is never attached to a new allocation.
            }
        }
        return orphans;
    }

    capabilities() {
        return { backend: this.backendName, isolation: this.isolation };
    }
}

module.exports = {
    DOCKER_OPERATION_TIMEOUT_MS,
    DockerBackend,
    IsolatedEnvironment,
    IsolatedEnvironmentManager,
    RUNTIME_LABEL,
    UnsafeHostBackend,
    assertEnvironmentKey,
    runProcess,
    runtimeNames,
    trustedRunnerManifest
};
