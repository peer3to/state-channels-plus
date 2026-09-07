import { deserializeRpcFrame } from "@/rpc/Rpc";
import {
    deserializeRpc,
    deserializeRpcResponse,
    MAX_RPC_FRAME_BYTES,
    serializeRpc,
    serializeRpcResponse
} from "@/rpc/Rpc";
import { expect } from "chai";

/**
 * Regression: deserializeRpc must require `params` to be an array. The
 * dispatcher spreads it (`method(...rpc.params)`), so a non-array (string,
 * object, number) would mis-dispatch or amplify work. Previously only
 * truthiness was checked.
 */
describe("deserializeRpc - params schema", function () {
    it("accepts a well-formed RPC with array params", function () {
        const rpc = deserializeRpc(
            serializeRpc({ service: "s", method: "m", params: [1, "a"] })
        );
        expect(rpc).to.not.equal(undefined);
        expect(rpc!.params).to.deep.equal([1, "a"]);
    });

    it("preserves requestId for request-style RPCs", function () {
        const rpc = deserializeRpc(
            JSON.stringify({
                service: "s",
                method: "m",
                params: [],
                requestId: "abc"
            })
        );
        expect(rpc?.requestId).to.equal("abc");
    });

    it("accepts omitted, non-empty, and empty request ids by presence", function () {
        const omitted = deserializeRpc(
            JSON.stringify({ service: "svc", method: "call", params: [] })
        );
        const nonEmpty = deserializeRpc(
            JSON.stringify({
                service: "svc",
                method: "call",
                params: [],
                requestId: "request-1"
            })
        );
        const empty = deserializeRpc(
            JSON.stringify({
                service: "svc",
                method: "call",
                params: [],
                requestId: ""
            })
        );

        expect(omitted).to.not.have.property("requestId");
        expect(nonEmpty?.requestId).to.equal("request-1");
        expect(empty?.requestId).to.equal("");
    });

    it("rejects every present non-string request id", function () {
        const values = [null, false, 0, {}, []];

        for (const requestId of values) {
            expect(
                deserializeRpc(
                    JSON.stringify({
                        service: "svc",
                        method: "call",
                        params: [],
                        requestId
                    })
                )
            ).to.equal(undefined);
        }
    });

    it("rejects every non-array params value", function () {
        expect(
            deserializeRpc(
                '{"service":"s","method":"m","params":"not-an-array"}'
            )
        ).to.equal(undefined);
        expect(
            deserializeRpc('{"service":"s","method":"m","params":{}}')
        ).to.equal(undefined);
        expect(
            deserializeRpc('{"service":"s","method":"m","params":5}')
        ).to.equal(undefined);
        expect(
            deserializeRpc('{"service":"s","method":"m","params":true}')
        ).to.equal(undefined);
        expect(
            deserializeRpc('{"service":"s","method":"m","params":null}')
        ).to.equal(undefined);
    });

    it("rejects when params is missing entirely", function () {
        expect(deserializeRpc('{"service":"s","method":"m"}')).to.equal(
            undefined
        );
        expect(
            deserializeRpcResponse('{"rpcResponse":true,"ok":true}')
        ).to.equal(undefined);
    });

    it("returns undefined on invalid JSON", function () {
        expect(deserializeRpc("not json")).to.equal(undefined);
    });

    it("round-trips a valid RPC response", function () {
        const response = {
            rpcResponse: true as const,
            requestId: "request-1",
            ok: true,
            result: { accepted: true }
        };

        expect(
            deserializeRpcResponse(serializeRpcResponse(response))
        ).to.deep.equal(response);
    });

    it("rejects wrong-typed request and response fields", function () {
        expect(
            deserializeRpc('{"service":1,"method":"m","params":[]}')
        ).to.equal(undefined);
        expect(
            deserializeRpc('{"service":"s","method":2,"params":[]}')
        ).to.equal(undefined);
        expect(deserializeRpcResponse("not json")).to.equal(undefined);
        expect(
            deserializeRpcResponse(
                '{"rpcResponse":false,"requestId":"1","ok":true}'
            )
        ).to.equal(undefined);
        expect(
            deserializeRpcResponse(
                '{"rpcResponse":true,"requestId":1,"ok":true}'
            )
        ).to.equal(undefined);
        expect(
            deserializeRpcResponse(
                '{"rpcResponse":true,"requestId":"1","ok":"true"}'
            )
        ).to.equal(undefined);
    });

    it("throws when a request param or response result contains a raw BigInt", function () {
        expect(() =>
            serializeRpc({
                service: "s",
                method: "m",
                params: [1n]
            })
        ).to.throw(TypeError);
        expect(() =>
            serializeRpcResponse({
                rpcResponse: true,
                requestId: "1",
                ok: true,
                result: { value: 1n }
            })
        ).to.throw(TypeError);
    });

    it("defines the exact 16 MiB frame limit", function () {
        expect(MAX_RPC_FRAME_BYTES).to.equal(16 * 1024 * 1024);
    });
    it("classifies request with response-first precedence", function () {
        const serialized = JSON.stringify({
            service: "",
            method: "",
            params: [],
            requestId: ""
        });
        const frame = deserializeRpcFrame(serialized);
        expect(frame?.kind).to.equal("request");
        expect(deserializeRpc(serialized) !== undefined).to.equal(true);
        expect(deserializeRpcResponse(serialized) !== undefined).to.equal(
            false
        );
    });
    it("classifies response with response-first precedence", function () {
        const serialized = JSON.stringify({
            rpcResponse: true,
            requestId: "",
            ok: true,
            result: { accepted: true }
        });
        const frame = deserializeRpcFrame(serialized);
        expect(frame?.kind).to.equal("response");
        expect(deserializeRpc(serialized) !== undefined).to.equal(false);
        expect(deserializeRpcResponse(serialized) !== undefined).to.equal(true);
    });
    it("classifies dual shape with response-first precedence", function () {
        const serialized = JSON.stringify({
            service: "svc",
            method: "call",
            params: [],
            rpcResponse: true,
            requestId: "id",
            ok: true
        });
        const frame = deserializeRpcFrame(serialized);
        expect(frame?.kind).to.equal("response");
        expect(deserializeRpc(serialized) !== undefined).to.equal(true);
        expect(deserializeRpcResponse(serialized) !== undefined).to.equal(true);
    });
    it("classifies invalid response with valid request with response-first precedence", function () {
        const serialized = JSON.stringify({
            service: "svc",
            method: "call",
            params: [],
            rpcResponse: true,
            requestId: "id",
            ok: "true"
        });
        const frame = deserializeRpcFrame(serialized);
        expect(frame?.kind).to.equal("request");
        expect(deserializeRpc(serialized) !== undefined).to.equal(true);
        expect(deserializeRpcResponse(serialized) !== undefined).to.equal(
            false
        );
    });
    it("rejects invalid JSON during frame classification", function () {
        expect(deserializeRpcFrame("not json")).to.equal(undefined);
    });
    it("rejects null during frame classification", function () {
        expect(deserializeRpcFrame("null")).to.equal(undefined);
    });
    it("rejects primitive during frame classification", function () {
        expect(deserializeRpcFrame("42")).to.equal(undefined);
    });
    it("rejects array during frame classification", function () {
        expect(deserializeRpcFrame("[]")).to.equal(undefined);
    });
    it("rejects missing fields during frame classification", function () {
        expect(deserializeRpcFrame("{}")).to.equal(undefined);
    });
});
