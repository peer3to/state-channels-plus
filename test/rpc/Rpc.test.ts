import { expect } from "chai";

import { deserializeRpc, serializeRpc, MAX_RPC_FRAME_BYTES } from "@/rpc/Rpc";

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

    for (const [label, params] of [
        ["string", '"not-an-array"'],
        ["object", "{}"],
        ["number", "5"],
        ["boolean", "true"],
        ["null", "null"]
    ] as const) {
        it(`rejects params that are a ${label}`, function () {
            const rpc = deserializeRpc(
                `{"service":"s","method":"m","params":${params}}`
            );
            expect(rpc).to.equal(undefined);
        });
    }

    it("rejects when params is missing entirely", function () {
        expect(deserializeRpc('{"service":"s","method":"m"}')).to.equal(
            undefined
        );
    });

    it("rejects a non-string service or method", function () {
        expect(
            deserializeRpc('{"service":1,"method":"m","params":[]}')
        ).to.equal(undefined);
        expect(
            deserializeRpc('{"service":"s","method":2,"params":[]}')
        ).to.equal(undefined);
    });

    it("returns undefined on invalid JSON", function () {
        expect(deserializeRpc("not json")).to.equal(undefined);
    });

    it("exposes a positive frame-size bound", function () {
        expect(MAX_RPC_FRAME_BYTES).to.be.greaterThan(0);
    });
});
