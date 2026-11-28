import { NotLocalError } from "@/evm/p2pRuntime/rpcNodes/lightClient/LightClientUnavailableError";
import {
    callAnswer,
    parseCall,
    parseLocalRead,
    REVERT_ERROR_CODE
} from "@/evm/p2pRuntime/rpcNodes/lightClient/LocalReadParser";
import { expect } from "chai";

const CONTRACT = "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const SENDER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const CALL_DATA = "0x06661abd";
const SLOT = "0x0";

describe("LocalReadParser", function () {
    it("answers a call at the latest block locally, with or without a sender, value and tag", function () {
        expect(parseCall([{ to: CONTRACT, data: CALL_DATA }])).to.deep.equal({
            from: undefined,
            to: CONTRACT,
            data: CALL_DATA,
            value: undefined
        });
        expect(
            parseCall([
                { from: SENDER, to: CONTRACT, data: CALL_DATA, value: "0x1f" },
                "latest"
            ])
        ).to.deep.equal({
            from: SENDER,
            to: CONTRACT,
            data: CALL_DATA,
            value: 31n
        });
        expect(
            parseCall([
                {
                    to: CONTRACT,
                    data: CALL_DATA,
                    type: "0x2",
                    chainId: "0x668ea"
                },
                "latest"
            ])
        ).to.deep.include({ to: CONTRACT, data: CALL_DATA });
        expect(parseCall([{ to: CONTRACT }, "latest"])).to.deep.include({
            data: "0x"
        });
        expect(
            parseLocalRead({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [{ to: CONTRACT, data: CALL_DATA }, "latest"]
            })
        ).to.be.a("function");
    });

    it("answers a call that carries its data as input locally", function () {
        expect(
            parseCall([{ to: CONTRACT, input: CALL_DATA }, "latest"])
        ).to.deep.include({ data: CALL_DATA });
        expect(
            parseLocalRead({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [{ to: CONTRACT, input: CALL_DATA }, "latest"]
            })
        ).to.be.a("function");
    });

    it("answers a returned call with its data, and a reverted one with the node's revert error and data", function () {
        expect(callAnswer({ kind: "return", data: "0x2a" })).to.deep.equal({
            result: "0x2a"
        });
        expect(
            callAnswer({ kind: "revert", data: "0x08c379a0" })
        ).to.deep.equal({
            error: {
                code: REVERT_ERROR_CODE,
                message: "execution reverted",
                data: "0x08c379a0"
            }
        });
    });

    it("leaves a call that failed locally without reverting to the node", function () {
        expect(() =>
            callAnswer({ kind: "failure", message: "out of gas" })
        ).to.throw(NotLocalError, /out of gas/);
    });

    it("answers storage, balance, code and transaction count at the latest block locally", function () {
        const reads = [
            { method: "eth_getStorageAt", params: [CONTRACT, SLOT, "latest"] },
            {
                method: "eth_getStorageAt",
                params: [CONTRACT, `0x${"f".repeat(64)}`]
            },
            { method: "eth_getBalance", params: [SENDER, "latest"] },
            { method: "eth_getCode", params: [CONTRACT] },
            { method: "eth_getTransactionCount", params: [SENDER, "latest"] }
        ];
        for (const { method, params } of reads)
            expect(
                parseLocalRead({ jsonrpc: "2.0", id: 1, method, params }),
                method
            ).to.be.a("function");
    });

    it("leaves every pending read to the node", function () {
        const reads = [
            {
                method: "eth_call",
                params: [{ to: CONTRACT, data: CALL_DATA }, "pending"]
            },
            { method: "eth_getStorageAt", params: [CONTRACT, SLOT, "pending"] },
            { method: "eth_getBalance", params: [SENDER, "pending"] },
            { method: "eth_getCode", params: [CONTRACT, "pending"] },
            { method: "eth_getTransactionCount", params: [SENDER, "pending"] }
        ];
        for (const { method, params } of reads)
            expect(
                parseLocalRead({ jsonrpc: "2.0", id: 1, method, params }),
                method
            ).to.equal(undefined);
    });

    it("leaves a read at any block other than the latest to the node", function () {
        const tags = [
            "earliest",
            "safe",
            "finalized",
            "0x10",
            { blockNumber: "0x10" },
            { blockHash: `0x${"ab".repeat(32)}` }
        ];
        for (const tag of tags) {
            expect(
                parseLocalRead({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_call",
                    params: [{ to: CONTRACT, data: CALL_DATA }, tag]
                }),
                `call at ${JSON.stringify(tag)}`
            ).to.equal(undefined);
            expect(
                parseLocalRead({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_getStorageAt",
                    params: [CONTRACT, SLOT, tag]
                }),
                `storage at ${JSON.stringify(tag)}`
            ).to.equal(undefined);
            expect(
                parseLocalRead({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_getBalance",
                    params: [SENDER, tag]
                }),
                `balance at ${JSON.stringify(tag)}`
            ).to.equal(undefined);
        }
    });

    it("leaves a call with a gas limit to the node", function () {
        expect(
            parseLocalRead({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [
                    { to: CONTRACT, data: CALL_DATA, gas: "0x5208" },
                    "latest"
                ]
            })
        ).to.equal(undefined);
    });

    it("leaves a call with a fee field to the node", function () {
        const fees = [
            { gasPrice: "0x1" },
            { gasPrice: "0x0" },
            { maxFeePerGas: "0x1" },
            { maxPriorityFeePerGas: "0x1" }
        ];
        for (const fee of fees)
            expect(
                parseLocalRead({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_call",
                    params: [
                        { to: CONTRACT, data: CALL_DATA, ...fee },
                        "latest"
                    ]
                }),
                JSON.stringify(fee)
            ).to.equal(undefined);
    });

    it("leaves a call with a field the local run does not honour to the node", function () {
        const fields = [
            { nonce: "0x0" },
            { accessList: [] },
            { blobVersionedHashes: [] },
            { authorizationList: [] }
        ];
        for (const field of fields)
            expect(
                parseLocalRead({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_call",
                    params: [
                        { to: CONTRACT, data: CALL_DATA, ...field },
                        "latest"
                    ]
                }),
                JSON.stringify(field)
            ).to.equal(undefined);
    });

    it("leaves a call with state overrides to the node", function () {
        expect(
            parseLocalRead({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [
                    { to: CONTRACT, data: CALL_DATA },
                    "latest",
                    { [CONTRACT]: { balance: "0x1" } }
                ]
            })
        ).to.equal(undefined);
    });

    it("leaves a creation, a call without a target, to the node", function () {
        expect(
            parseLocalRead({
                jsonrpc: "2.0",
                id: 1,
                method: "eth_call",
                params: [{ from: SENDER, data: CALL_DATA }, "latest"]
            })
        ).to.equal(undefined);
    });

    it("leaves a call with a malformed field to the node", function () {
        const calls = [
            { to: CONTRACT.slice(0, 40), data: CALL_DATA },
            { to: `0x${"zz".repeat(20)}`, data: CALL_DATA },
            { to: CONTRACT, from: "0x1234", data: CALL_DATA },
            { to: CONTRACT, data: "0x123" },
            { to: CONTRACT, data: "06661abd" },
            { to: CONTRACT, data: 7 },
            { to: CONTRACT, data: CALL_DATA, value: "0x01" },
            { to: CONTRACT, data: CALL_DATA, value: "1" },
            null,
            "0x"
        ];
        for (const call of calls)
            expect(
                parseLocalRead({
                    jsonrpc: "2.0",
                    id: 1,
                    method: "eth_call",
                    params: [call, "latest"]
                }),
                JSON.stringify(call)
            ).to.equal(undefined);
    });

    it("leaves an account or storage read with a malformed parameter to the node", function () {
        const reads = [
            {
                method: "eth_getStorageAt",
                params: [CONTRACT, `0x${"1".repeat(65)}`, "latest"]
            },
            { method: "eth_getStorageAt", params: [CONTRACT, "0x", "latest"] },
            { method: "eth_getStorageAt", params: [CONTRACT, 0, "latest"] },
            { method: "eth_getStorageAt", params: ["0x1234", SLOT, "latest"] },
            { method: "eth_getBalance", params: ["0x1234", "latest"] },
            { method: "eth_getCode", params: [42, "latest"] },
            {
                method: "eth_getTransactionCount",
                params: [`0x${"zz".repeat(20)}`, "latest"]
            }
        ];
        for (const { method, params } of reads)
            expect(
                parseLocalRead({ jsonrpc: "2.0", id: 1, method, params }),
                `${method} ${JSON.stringify(params)}`
            ).to.equal(undefined);
    });

    it("leaves a read with more parameters than its method takes to the node", function () {
        const reads = [
            {
                method: "eth_getStorageAt",
                params: [CONTRACT, SLOT, "latest", "latest"]
            },
            { method: "eth_getBalance", params: [SENDER, "latest", "latest"] },
            { method: "eth_getCode", params: [CONTRACT, "latest", "latest"] },
            {
                method: "eth_getTransactionCount",
                params: [SENDER, "latest", "latest"]
            }
        ];
        for (const { method, params } of reads)
            expect(
                parseLocalRead({ jsonrpc: "2.0", id: 1, method, params }),
                method
            ).to.equal(undefined);
    });

    it("leaves every other method to the node", function () {
        const requests = [
            { method: "eth_blockNumber", params: [] },
            { method: "eth_getLogs", params: [{ address: CONTRACT }] },
            {
                method: "eth_estimateGas",
                params: [{ to: CONTRACT, data: CALL_DATA }]
            },
            { method: "eth_getProof", params: [CONTRACT, [SLOT], "latest"] },
            { method: "chain_getHeader", params: [] }
        ];
        for (const { method, params } of requests)
            expect(
                parseLocalRead({ jsonrpc: "2.0", id: 1, method, params }),
                method
            ).to.equal(undefined);
    });
});
