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
    Receipt,
    receiptOf,
    StateDiff,
    transferOneWei
} from "../fixtures/node/TestChainFixture";
import {
    provisionSlots,
    startHardhatNode,
    teardownInfra
} from "@test/utils/nodeInfra";
import { repoRoot } from "@test/utils/repoRoot";
import { expect } from "chai";
import { spawn } from "child_process";
import { HDNodeWallet } from "ethers";
import fs from "fs";
import { ethers, network } from "hardhat";
import os from "os";
import path from "path";

// A literal, so a changed launcher mnemonic is caught (the one owner is
// scripts/infra/anvilNode.js; hardhat.config.ts requires it from there).
const HARDHAT_MNEMONIC =
    "test test test test test test test test test test test junk";

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
