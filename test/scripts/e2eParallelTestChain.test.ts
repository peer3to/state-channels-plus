// @spec-test-coverage-ignore: developer test-orchestration tooling; not protocol behavior, no specification or implementation IDs apply
import { withIsolatedHardhatNode } from "../fixtures/node/IsolatedHardhatNode";
import {
    Block,
    call,
    DIFF_TRACE,
    expectBothTraces,
    expectRecipientDiff,
    expectStopped,
    expectStoppedSoon,
    launchStandalone,
    answeringServer,
    outOfOrderTransfers,
    Receipt,
    receiptOf,
    StateDiff,
    transferOneWei,
    walletOf
} from "../fixtures/node/TestChainFixture";
import {
    provisionSlots,
    startHardhatNode,
    teardownInfra,
    waitForHardhatNode
} from "@test/utils/nodeInfra";
import { repoRoot } from "@test/utils/repoRoot";
import { expect } from "chai";
import { spawn, spawnSync } from "child_process";
import { HDNodeWallet, Interface, JsonRpcProvider } from "ethers";
import fs from "fs";
import { ethers, network } from "hardhat";
import net from "node:net";
import os from "os";
import path from "path";

// A literal, so a changed launcher mnemonic is caught (the one owner is
// scripts/infra/anvilNode.js; hardhat.config.ts requires it from there).
const HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";
const { pinnedAnvilMismatch } = require("../../scripts/infra/anvilNode.js") as {
    pinnedAnvilMismatch: (
        root: string,
        env: NodeJS.ProcessEnv,
        runnerRoot?: string
    ) => string | null;
};
const { pinnedFoundryMismatch } =
    require("../../scripts/e2e-parallel/shared/forgeConfig.js") as {
        pinnedFoundryMismatch: (
            binary: string,
            root: string,
            env: NodeJS.ProcessEnv
        ) => string | null;
    };

describe("e2e parallel test chain", function () {
    it("a runner slot node serves prestateTracer diffMode for a transaction and for its block", async function () {
        const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-slot-"));
        const { slots, infra } = await provisionSlots(1, logDir);
        const node = infra.nodes[0];
        try {
            const rpc = call(slots[0].nodeUrl);
            const block = await rpc<Block>("eth_getBlockByNumber", [
                "latest",
                false
            ]);
            expect(BigInt(block.gasLimit)).to.equal(1_000_000_000n);
            await expectBothTraces(rpc, await transferOneWei(rpc));
        } finally {
            teardownInfra(infra);
            await node.exited;
            fs.rmSync(logDir, { recursive: true, force: true });
        }
        await expectStopped(slots[0].nodeUrl);
    });

    // Mutation: the --block-time argument dropped from anvilArgs -> the slot node automines.
    it("a runner slot node mines a block a second with automine off, and mines a later nonce sent first after the earlier one", async function () {
        const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-slot-"));
        const { slots, infra } = await provisionSlots(1, logDir);
        const node = infra.nodes[0];
        const provider = new JsonRpcProvider(slots[0].nodeUrl);
        try {
            const rpc = call(slots[0].nodeUrl);
            expect(await rpc("anvil_getAutomine")).to.equal(false);
            const [sender, recipient] = await rpc<string[]>("eth_accounts");
            const { later, earlier } = await outOfOrderTransfers(
                walletOf(HARDHAT_MNEMONIC, sender),
                provider,
                recipient
            );
            const laterHash = await rpc<string>("eth_sendRawTransaction", [
                later
            ]);
            const earlierHash = await rpc<string>("eth_sendRawTransaction", [
                earlier
            ]);
            const first = await receiptOf(rpc, earlierHash);
            const second = await receiptOf(rpc, laterHash);
            expect([first.status, second.status]).to.deep.equal(["0x1", "0x1"]);
            expect(Number(second.blockNumber)).to.be.at.least(
                Number(first.blockNumber)
            );
            const start = BigInt(await rpc<string>("eth_blockNumber"));
            await new Promise((resolve) => setTimeout(resolve, 2500));
            const mined = BigInt(await rpc<string>("eth_blockNumber")) - start;
            expect(Number(mined)).to.be.within(2, 3);
        } finally {
            provider.destroy();
            teardownInfra(infra);
            await node.exited;
            fs.rmSync(logDir, { recursive: true, force: true });
        }
    });

    // Mutation: startHardhatNode hands back the first live node -> the second node is the paused one and its transfer never mines.
    it("an isolated node serves prestateTracer diffMode and pauses mining only on itself", async function () {
        let url = "";
        await withIsolatedHardhatNode(
            async (provider) => {
                url = provider._getConnection().url;
                const rpc = call(url);
                expect(await rpc("eth_chainId")).to.equal("0x7a6a");
                await expectBothTraces(rpc, await transferOneWei(rpc));

                await rpc("evm_setAutomine", [false]);
                const [sender, recipient] = await rpc<string[]>("eth_accounts");
                const pending = await rpc<string>("eth_sendTransaction", [
                    { from: sender, to: recipient, value: "0x1", gas: "0x5208" }
                ]);
                expect(
                    await rpc("eth_getTransactionReceipt", [pending])
                ).to.equal(null);
                const other = await startHardhatNode({ port: 0 });
                try {
                    const transfer = await transferOneWei(call(other.url));
                    expect(transfer.receipt.status).to.equal("0x1");
                } finally {
                    other.stop();
                    await other.exited;
                }
                expect(
                    await rpc("eth_getTransactionReceipt", [pending])
                ).to.equal(null);
                await rpc("hardhat_mine", ["0x1"]);
                expect(
                    (await rpc<Receipt>("eth_getTransactionReceipt", [pending]))
                        .status
                ).to.equal("0x1");
            },
            { chainId: 31338 }
        );
        await expectStopped(url);
    });

    // Mutation: the launcher mnemonic changed to another phrase -> addresses differ.
    it("the infra:hardhat-node launcher funds the 400 hardhat.config.ts accounts in order on the chain id it is given", async function () {
        const node = await launchStandalone({ HARDHAT_CHAIN_ID: "31338" });
        try {
            const accounts = await node.rpc<string[]>("eth_accounts");
            const root = HDNodeWallet.fromPhrase(
                HARDHAT_MNEMONIC,
                undefined,
                "m/44'/60'/0'/0"
            );
            expect(
                accounts.map((account) => account.toLowerCase())
            ).to.deep.equal(
                Array.from({ length: 400 }, (_, index) =>
                    root.deriveChild(index).address.toLowerCase()
                )
            );
            for (const account of accounts) {
                expect(
                    BigInt(
                        await node.rpc<string>("eth_getBalance", [
                            account,
                            "latest"
                        ])
                    )
                ).to.equal(10000n * 10n ** 18n);
            }
            expect(await node.rpc("eth_chainId")).to.equal("0x7a6a");
        } finally {
            await node.stop();
        }
    });

    it("the launcher deploys code above the 24576-byte contract size limit", async function () {
        const node = await launchStandalone({});
        try {
            const [deployer] = await node.rpc<string[]>("eth_accounts");
            // init code returning 24577 zero bytes: PUSH2 0x6001 PUSH1 0 RETURN
            const deployment = await node.rpc<string>("eth_sendTransaction", [
                { from: deployer, data: "0x6160016000f3", gas: "0x989680" }
            ]);
            const deployed = await receiptOf(node.rpc, deployment);
            const code = await node.rpc<string>("eth_getCode", [
                deployed.contractAddress,
                "latest"
            ]);
            expect((code.length - 2) / 2).to.equal(24577);
        } finally {
            await node.stop();
        }
    });

    it("an automined node on the default chain id mines each transaction in its own block with a 30M gas limit", async function () {
        const node = await startHardhatNode({
            port: 0,
            env: { E2E_INTERVAL_MINING: undefined, HARDHAT_CHAIN_ID: undefined }
        });
        try {
            const rpc = call(node.url);
            expect(await rpc("eth_chainId")).to.equal("0x7a69");
            const block = await rpc<Block>("eth_getBlockByNumber", [
                "latest",
                false
            ]);
            expect(BigInt(block.gasLimit)).to.equal(30_000_000n);
            const before = BigInt(await rpc<string>("eth_blockNumber"));
            const transfer = await transferOneWei(rpc);
            expect(BigInt(transfer.receipt.blockNumber)).to.equal(before + 1n);
        } finally {
            node.stop();
            await node.exited;
        }
    });

    it("an interval-mined node honours hardhat_mine and the automine switch", async function () {
        const node = await startHardhatNode({
            port: 0,
            env: { E2E_INTERVAL_MINING: "1" }
        });
        try {
            const rpc = call(node.url);
            await rpc("evm_setIntervalMining", [0]);
            const before = BigInt(await rpc<string>("eth_blockNumber"));
            await rpc("hardhat_mine", ["0x2"]);
            expect(BigInt(await rpc<string>("eth_blockNumber"))).to.equal(
                before + 2n
            );

            await rpc("evm_setAutomine", [true]);
            const mined = BigInt(await rpc<string>("eth_blockNumber"));
            await transferOneWei(rpc);
            expect(BigInt(await rpc<string>("eth_blockNumber"))).to.equal(
                mined + 1n
            );
        } finally {
            node.stop();
            await node.exited;
        }
    });

    it("a node started on an explicit port binds it and keeps its log until it exits", async function () {
        const logDir = fs.mkdtempSync(path.join(os.tmpdir(), "chain-log-"));
        const logPath = path.join(logDir, "node.log");
        const probe = await startHardhatNode({ port: 0 });
        const port = Number(new URL(probe.url).port);
        probe.stop();
        await probe.exited;
        const node = await startHardhatNode({ port, logPath });
        try {
            expect(node.url).to.equal(`http://127.0.0.1:${port}`);
        } finally {
            node.stop();
            await node.exited;
            await node.logClosed;
        }
        expect(fs.readFileSync(logPath, "utf8")).to.include(
            `Listening on 127.0.0.1:${port}`
        );
        fs.rmSync(logDir, { recursive: true, force: true });
    });

    // Mutation: the project branch dropped from startHardhatNode -> the project chain answers as anvil.
    it("a node on the project test chain is the project's own hardhat node, on the port it binds itself", async function () {
        const project = await startHardhatNode({
            port: 0,
            env: { E2E_TEST_CHAIN: "project" }
        });
        try {
            expect(await call(project.url)("web3_clientVersion")).to.match(
                /^HardhatNetwork\//
            );
        } finally {
            project.stop();
            await project.exited;
        }
        const anvil = await startHardhatNode({ port: 0 });
        try {
            expect(await call(anvil.url)("web3_clientVersion")).to.match(
                /^anvil\//
            );
        } finally {
            anvil.stop();
            await anvil.exited;
        }
    });

    // Mutation: testChain accepts any value -> the geth chain starts as anvil.
    it("a test chain other than anvil or project is refused before a node starts", async function () {
        let failure: Error | undefined;
        try {
            const node = await startHardhatNode({
                port: 0,
                env: { E2E_TEST_CHAIN: "geth" }
            });
            node.stop();
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.message).to.equal(
            "E2E_TEST_CHAIN must be anvil or project, not geth"
        );
    });

    it("starting a node with no anvil on PATH rejects naming the missing anvil", async function () {
        let failure: Error | undefined;
        try {
            await startHardhatNode({ port: 0, env: { PATH: "" } });
        } catch (error) {
            failure = error as Error;
        }
        expect(failure?.message).to.include("hardhat node cannot start");
        expect(failure?.message).to.include("Failed to start anvil");
    });

    // Mutation: pinnedFoundryMismatch returns null for a differing version -> the 0.0.1 pin accepts this anvil.
    // Mutation: the version regex no longer matches `--version` output -> the repository's own pin refuses its anvil.
    // Mutation: an unreadable version accepted, as the forge check once did -> node's version passes.
    // Mutation: no fallback to the runner's pin -> the unpinned project accepts the anvil the 0.0.1 runner refuses.
    // Mutation: the runner's pin read before the project's -> the 0.0.1 project accepts this anvil.
    // Mutation: no pin anywhere accepted -> the unpinned project and runner pass.
    it("the pinned-anvil check refuses another or an unreadable version, falls back to the runner's pin, and refuses no pin", function () {
        const project = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-pin-"));
        const runner = fs.mkdtempSync(path.join(os.tmpdir(), "anvil-runner-"));
        try {
            expect(pinnedAnvilMismatch(project, process.env, runner)).to.equal(
                `No .forge-version pins anvil in ${project} or in the runner (${runner})`
            );
            expect(pinnedAnvilMismatch(project, process.env)).to.equal(null);
            fs.writeFileSync(path.join(runner, ".forge-version"), "v0.0.1\n");
            expect(
                pinnedAnvilMismatch(project, process.env, runner)
            ).to.include("does not match .forge-version (0.0.1)");
            fs.writeFileSync(path.join(project, ".forge-version"), "v0.0.1\n");
            expect(pinnedAnvilMismatch(project, process.env)).to.include(
                "does not match .forge-version (0.0.1)"
            );
            expect(
                pinnedFoundryMismatch("node", project, process.env)
            ).to.include("node (unknown version) does not match");
            expect(pinnedAnvilMismatch(repoRoot(), process.env)).to.equal(null);
        } finally {
            fs.rmSync(project, { recursive: true, force: true });
            fs.rmSync(runner, { recursive: true, force: true });
        }
    });

    // Mutation: the exit handler before ready removed -> the start waits out its 30 s budget instead.
    it("starting a node on a port already in use rejects with anvil's exit and its address-in-use error", async function () {
        const holder = net.createServer();
        await new Promise<void>((resolve) =>
            holder.listen(0, "127.0.0.1", resolve)
        );
        const address = holder.address();
        try {
            if (!address || typeof address === "string")
                throw new Error("holder has no port");
            let failure: Error | undefined;
            try {
                await startHardhatNode({ port: address.port });
            } catch (error) {
                failure = error as Error;
            }
            expect(failure?.message).to.include(
                "exited with code 1 before ready"
            );
            expect(failure?.message).to.include("Address already in use");
        } finally {
            holder.close();
        }
    });

    // Mutation: probeRpc counts any HTTP answer as ready -> both servers that are not nodes pass.
    // Mutation: the cancelled check dropped -> the cancelled wait runs its whole timeout and rejects.
    it("waitForHardhatNode waits for a hex JSON-RPC result, not any HTTP answer, and stops once cancelled", async function () {
        const notJson = await answeringServer("ok");
        const rpcError = await answeringServer(
            JSON.stringify({
                jsonrpc: "2.0",
                id: 1,
                error: { code: -32601, message: "method not found" }
            })
        );
        const node = await startHardhatNode({ port: 0 });
        try {
            for (const server of [notJson, rpcError]) {
                let refusal: Error | undefined;
                try {
                    await waitForHardhatNode(server.url, 1000);
                } catch (error) {
                    refusal = error as Error;
                }
                expect(refusal?.message).to.include("not ready");
            }
            await waitForHardhatNode(node.url, 1000);
            const started = Date.now();
            await waitForHardhatNode(notJson.url, 5000, () => true);
            expect(Date.now() - started).to.be.below(1000);
        } finally {
            node.stop();
            await node.exited;
            await notJson.close();
            await rpcError.close();
        }
    });

    it("a node's anvil exits when the process that started it is SIGKILLed", async function () {
        const owner = spawn(
            process.execPath,
            [
                "-e",
                `require(${JSON.stringify(
                    path.join(repoRoot(), "test/utils/nodeInfra.js")
                )}).startHardhatNode({ port: 0 }).then((node) => console.log(node.url))`
            ],
            { cwd: repoRoot(), stdio: ["ignore", "pipe", "inherit"] }
        );
        const url = await new Promise<string>((resolve, reject) => {
            owner.stdout.once("data", (chunk: Buffer) =>
                resolve(chunk.toString().trim())
            );
            owner.once("exit", (code) =>
                reject(new Error(`owner exited with ${code}`))
            );
        });
        expect(await call(url)("eth_chainId")).to.equal("0x7a69");
        owner.kill("SIGKILL");
        await expectStoppedSoon(url);
    });

    it("the infra:hardhat-node launcher's anvil exits when the launcher is SIGKILLed", async function () {
        const node = await launchStandalone({});
        node.child.kill("SIGKILL");
        await expectStoppedSoon(node.url);
    });

    it("hardhat's in-process network runs on a private anvil that serves prestateTracer diffMode", async function () {
        const [sender, recipient] = await ethers.getSigners();
        const before = await ethers.provider.getBalance(recipient.address);
        const sent = await sender.sendTransaction({
            to: recipient.address,
            value: 1n
        });
        const receipt = (await sent.wait())!;
        const diff: StateDiff = await network.provider.send(
            "debug_traceTransaction",
            [sent.hash, DIFF_TRACE]
        );
        expectRecipientDiff(diff, {
            hash: sent.hash,
            receipt: {
                blockNumber: `0x${receipt.blockNumber.toString(16)}`,
                status: "0x1",
                contractAddress: ""
            },
            recipient: recipient.address,
            before,
            after: await ethers.provider.getBalance(recipient.address)
        });
        expect(network.name).to.equal("hardhat");
    });

    // Mutation: the eth_accounts window sliced from initialIndex + 1 -> every address shifts by one.
    it("hardhat's in-process network answers eth_accounts with the hardhat network's own account window", async function () {
        const accounts = network.config.accounts;
        if (typeof accounts === "string" || Array.isArray(accounts))
            throw new Error("the hardhat network has HD accounts");
        const root = HDNodeWallet.fromPhrase(
            HARDHAT_MNEMONIC,
            undefined,
            "m/44'/60'/0'/0"
        );
        const expected = Array.from({ length: accounts.count }, (_, index) =>
            root
                .deriveChild(accounts.initialIndex + index)
                .address.toLowerCase()
        );
        const answered: string[] = await network.provider.send("eth_accounts");
        expect(answered.map((address) => address.toLowerCase())).to.deep.equal(
            expected
        );
        expect(
            (await ethers.getSigners()).map((signer) =>
                signer.address.toLowerCase()
            )
        ).to.deep.equal(expected);
    });

    // Mutation: sends forwarded without the queue -> concurrent sends read one nonce and some are refused.
    it("hardhat's in-process network gives eight concurrent sends from one account eight consecutive nonces", async function () {
        const [sender, recipient] = await ethers.getSigners();
        const nonce = await ethers.provider.getTransactionCount(sender.address);
        const hashes: string[] = await Promise.all(
            Array.from({ length: 8 }, () =>
                network.provider.send("eth_sendTransaction", [
                    {
                        from: sender.address,
                        to: recipient.address,
                        value: "0x1",
                        gas: "0x5208"
                    }
                ])
            )
        );
        const nonces = await Promise.all(
            hashes.map(
                async (hash) =>
                    (await ethers.provider.getTransaction(hash))!.nonce
            )
        );
        expect(nonces.sort((a, b) => a - b)).to.deep.equal(
            [0, 1, 2, 3, 4, 5, 6, 7].map((offset) => nonce + offset)
        );
    });

    // Mutation: the automine receipt wait moved back inside the send queue -> the later nonce holds the earlier send for the whole ~2 s wait.
    it("hardhat's in-process network mines a later nonce sent before the earlier one without holding the earlier send", async function () {
        const [sender, recipient] = await ethers.getSigners();
        const { later, earlier } = await outOfOrderTransfers(
            walletOf(HARDHAT_MNEMONIC, sender.address),
            ethers.provider,
            recipient.address
        );
        const started = Date.now();
        const hashes: string[] = await Promise.all([
            network.provider.send("eth_sendRawTransaction", [later]),
            network.provider.send("eth_sendRawTransaction", [earlier])
        ]);
        expect(Date.now() - started).to.be.below(1000);
        for (const hash of hashes) {
            const receipt = await network.provider.send(
                "eth_getTransactionReceipt",
                [hash]
            );
            expect(receipt?.status).to.equal("0x1");
        }
    });

    // Mutation: useAnvilForInProcessNetwork ignores E2E_TEST_CHAIN -> the send asks the project's hardhat node for anvil_getAutomine and fails.
    it("hardhat's in-process network stays EDR on the project test chain and runs on anvil otherwise", function () {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "in-process-chain-"));
        try {
            const probe = path.join(dir, "client.test.js");
            fs.writeFileSync(
                probe,
                `const { network } = require("hardhat");
describe("probe", function () {
    it("sends and prints the in-process client", async function () {
        const [from, to] = await network.provider.send("eth_accounts");
        await network.provider.send("eth_sendTransaction", [{ from, to, value: "0x1" }]);
        console.log("client:", await network.provider.send("web3_clientVersion"));
    });
});
`
            );
            const clientOn = (chain: string | undefined) => {
                const run = spawnSync(
                    process.execPath,
                    [
                        require.resolve("hardhat/internal/cli/cli.js"),
                        "test",
                        "--no-compile",
                        probe
                    ],
                    {
                        cwd: repoRoot(),
                        encoding: "utf8",
                        env: {
                            ...process.env,
                            NODE_PATH: path.join(repoRoot(), "node_modules"),
                            E2E_TEST_CHAIN: chain
                        }
                    }
                );
                return (
                    /client: (\S+)/.exec(run.stdout)?.[1] ??
                    `${run.stdout}${run.stderr}`
                );
            };
            expect(clientOn("project")).to.match(/^HardhatNetwork\//);
            expect(clientOn(undefined)).to.match(/^anvil\//);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    // Mutation: the in-process chain started without forwardOutput -> the markers never reach this process.
    // Mutation: forwardChainOutput copies every line -> anvil's method, transaction, block and failure lines reach it too.
    // Mutation: only method-name lines dropped, as first written -> the transaction and block summaries reach it.
    it("contract console.log on hardhat's in-process network reaches the test process's output without anvil's own log lines", async function () {
        // console.sol's log(string) is this call to the console address
        const log = (text: string) => ({
            to: "0x000000000000000000636F6e736F6c652e6c6f67",
            data: new Interface(["function log(string)"]).encodeFunctionData(
                "log",
                [text]
            )
        });
        const [sender] = await ethers.getSigners();
        const written: string[] = [];
        const write = process.stdout.write;
        process.stdout.write = ((
            chunk: string | Uint8Array,
            ...rest: never[]
        ) => {
            written.push(chunk.toString());
            return write.call(process.stdout, chunk, ...rest);
        }) as typeof process.stdout.write;
        try {
            // a failed request: anvil prints its header and request details
            await network.provider
                .send("eth_call", [{ data: "0x60006000fd" }, "latest"])
                .catch(() => undefined);
            // a mined transaction: anvil prints its and its block's summary
            const sent = await sender.sendTransaction({
                ...log("in-process console.log marker"),
                gasLimit: 100000
            });
            await sent.wait();
            // printed after everything above
            await network.provider.send("eth_call", [
                log("in-process console.log end"),
                "latest"
            ]);
            const deadline = Date.now() + 5000;
            while (
                !written.join("").includes("in-process console.log end") &&
                Date.now() < deadline
            )
                await new Promise((resolve) => setTimeout(resolve, 50));
        } finally {
            process.stdout.write = write;
        }
        const lines = written.join("").split("\n");
        expect(lines).to.include("in-process console.log marker");
        expect(lines).to.include("in-process console.log end");
        for (const anvilLine of [
            /^eth_(call|sendTransaction|getTransactionReceipt)$/,
            /^RPC request failed:$/,
            /^\s+(Request|Error|Transaction|Gas used|Block Number|Block Hash|Block Time):/
        ])
            expect(lines.filter((line) => anvilLine.test(line))).to.deep.equal(
                []
            );
    });

    it("the browser runtime server's node interval-mines and stops when the server closes", async function () {
        const {
            startSdkRuntimeServer
        } = require("../browser/sdkRuntimeServer.mjs");
        const server = await startSdkRuntimeServer({ miningIntervalMs: 100 });
        try {
            const rpc = call(server.url);
            const before = BigInt(await rpc<string>("eth_blockNumber"));
            await new Promise((resolve) => setTimeout(resolve, 1000));
            expect(
                BigInt(await rpc<string>("eth_blockNumber")) - before
            ).to.be.greaterThan(3n);
            await expectBothTraces(rpc, await transferOneWei(rpc));
            expect(server.proxy["/rpc"].target).to.equal(server.url);
        } finally {
            await server.close();
        }
        await expectStopped(server.url);
    });
});
