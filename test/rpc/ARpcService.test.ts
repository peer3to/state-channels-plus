import { expect } from "chai";

import { ARpcServiceFixture } from "@test/fixtures/ARpcServiceFixture";

describe("ARpcService", function () {
    let fixture: ARpcServiceFixture;

    beforeEach(async function () {
        fixture = new ARpcServiceFixture();
        await fixture.setup();
    });

    afterEach(async function () {
        await fixture.cleanup();
    });

    it("settles a guarded request without resolving its endpoint", async function () {
        const result = await fixture.probe("childEndpoint", {
            request: true,
            guardPasses: false
        });

        expect(result.consumed).to.equal(true);
        expect(result.guardChecks).to.equal(1);
        expect(result.guardFailures).to.equal(1);
        expect(result.invocations).to.deep.equal([]);
        expect(result.responses).to.deep.equal([
            {
                rpcResponse: true,
                requestId: "probe-request",
                ok: false,
                error: "RPC request rejected by guard"
            }
        ]);
    });

    it("applies the same guard consequence before existing or missing endpoint resolution", async function () {
        const existing = await fixture.probe("childEndpoint", {
            request: true,
            guardPasses: false
        });
        const missing = await fixture.probe("missingEndpoint", {
            request: true,
            guardPasses: false
        });

        expect(existing).to.deep.equal(missing);
        expect(existing.guardChecks).to.equal(1);
        expect(existing.guardFailures).to.equal(1);
        expect(existing.methodConstructions).to.equal(0);
        expect(existing.invocations).to.deep.equal([]);
        expect(existing.responses).to.deep.equal([
            {
                rpcResponse: true,
                requestId: "probe-request",
                ok: false,
                error: "RPC request rejected by guard"
            }
        ]);
    });

    it("skips guards when the transport reports trusted", async function () {
        const result = await fixture.probe("childEndpoint", {
            request: true,
            trusted: true,
            guardPasses: false
        });

        expect(result.consumed).to.equal(true);
        expect(result.guardChecks).to.equal(0);
        expect(result.guardFailures).to.equal(0);
        expect(result.invocations).to.deep.equal(["childEndpoint"]);
        expect(result.responses[0].result).to.equal("child-result");
    });

    it("bypasses guards through the real loopback transport", async function () {
        const result = await fixture.probeRealLoopbackGuardBypass();

        expect(result).to.deep.equal({
            guardChecks: 0,
            endpointInvocations: 1
        });
    });

    it("consumes a guarded one-way call without constructing or invoking its endpoint", async function () {
        const result = await fixture.probe("childEndpoint", {
            guardPasses: false
        });

        expect(result.consumed).to.equal(true);
        expect(result.guardChecks).to.equal(1);
        expect(result.guardFailures).to.equal(1);
        expect(result.methodConstructions).to.equal(0);
        expect(result.invocations).to.deep.equal([]);
        expect(result.responses).to.deep.equal([]);
    });

    it("returns false for a missing endpoint", async function () {
        const result = await fixture.probe("missingEndpoint");

        expect(result.consumed).to.equal(false);
        expect(result.guardChecks).to.equal(1);
        expect(result.invocations).to.deep.equal([]);
        expect(result.responses).to.deep.equal([]);
    });

    it("rejects ARpcMethods and Object prototype names", async function () {
        const remoteRpc = await fixture.probe("remoteRpc");
        const toString = await fixture.probe("toString");
        const hasOwnProperty = await fixture.probe("hasOwnProperty");
        const constructor = await fixture.probe("constructor");
        const proto = await fixture.probe("__proto__");

        expect(remoteRpc.consumed).to.equal(false);
        expect(toString.consumed).to.equal(false);
        expect(hasOwnProperty.consumed).to.equal(false);
        expect(constructor.consumed).to.equal(false);
        expect(proto.consumed).to.equal(false);
        expect(remoteRpc.accessorReads).to.equal(0);
    });

    it("invokes a method declared on the concrete class", async function () {
        const result = await fixture.probe("childEndpoint", { request: true });

        expect(result.consumed).to.equal(true);
        expect(result.invocations).to.deep.equal(["childEndpoint"]);
        expect(result.responses[0].result).to.equal("child-result");
    });

    it("invokes an endpoint inherited from an application methods class", async function () {
        const result = await fixture.probe("parentEndpoint", { request: true });

        expect(result.consumed).to.equal(true);
        expect(result.invocations).to.deep.equal(["parentEndpoint"]);
        expect(result.responses[0].result).to.equal("parent-result");
    });

    it("invokes a function-valued own field", async function () {
        const result = await fixture.probe("ownEndpoint", { request: true });

        expect(result.consumed).to.equal(true);
        expect(result.invocations).to.deep.equal(["ownEndpoint"]);
        expect(result.responses[0].result).to.equal("own-result");
    });

    it("stops before Object.prototype when the methods object has no local RPC base", async function () {
        const ownEndpoint = await fixture.probe("ownEndpoint", {
            request: true,
            withoutRpcMethodsPrototype: true
        });
        const toString = await fixture.probe("toString", {
            withoutRpcMethodsPrototype: true
        });
        const hasOwnProperty = await fixture.probe("hasOwnProperty", {
            withoutRpcMethodsPrototype: true
        });
        const valueOf = await fixture.probe("valueOf", {
            withoutRpcMethodsPrototype: true
        });

        expect(ownEndpoint.consumed).to.equal(true);
        expect(ownEndpoint.invocations).to.deep.equal(["ownEndpoint"]);
        expect(ownEndpoint.responses[0].result).to.equal("own-result");
        expect(toString.consumed).to.equal(false);
        expect(hasOwnProperty.consumed).to.equal(false);
        expect(valueOf.consumed).to.equal(false);
    });

    it("rejects accessors without invoking them", async function () {
        const result = await fixture.probe("accessorEndpoint", {
            request: true
        });

        expect(result.consumed).to.equal(false);
        expect(result.accessorReads).to.equal(0);
        expect(result.responses).to.deep.equal([]);
    });

    it("rejects non-function own properties", async function () {
        const result = await fixture.probe("nonFunction", { request: true });

        expect(result.consumed).to.equal(false);
        expect(result.invocations).to.deep.equal([]);
        expect(result.responses).to.deep.equal([]);
    });

    it("returns a request handler failure to the caller", async function () {
        const result = await fixture.probe("requestThrows", { request: true });

        expect(result.consumed).to.equal(true);
        expect(result.disconnectCalls).to.equal(0);
        expect(result.responses[0].ok).to.equal(false);
        expect(result.responses[0].error).to.equal("request endpoint failed");
    });

    it("runs guards for an untrusted network transport", async function () {
        const result = await fixture.probe("childEndpoint", {
            request: true,
            trusted: false,
            guardPasses: true
        });

        expect(result.consumed).to.equal(true);
        expect(result.guardChecks).to.equal(1);
        expect(result.guardFailures).to.equal(0);
    });

    it("disconnects after a one-way handler rejection", async function () {
        const result = await fixture.probe("oneWayRejects");

        expect(result.consumed).to.equal(true);
        expect(result.disconnectCalls).to.equal(1);
        expect(result.responses).to.deep.equal([]);
    });

    it("returns false after a synchronous one-way handler throw", async function () {
        const result = await fixture.probe("oneWayThrows");

        expect(result.consumed).to.equal(false);
        expect(result.disconnectCalls).to.equal(0);
        expect(result.responses).to.deep.equal([]);
    });

    it("invokes the endpoint captured during authorization", async function () {
        const result = await fixture.probe("captureEndpoint", {
            request: true
        });

        expect(result.consumed).to.equal(true);
        expect(result.invocations).to.deep.equal(["captured-original"]);
        expect(result.responses[0].result).to.equal("captured-original-result");
    });

    it("invokes the captured endpoint for one-way delivery", async function () {
        const result = await fixture.probe("captureEndpoint");

        expect(result.consumed).to.equal(true);
        expect(result.invocations).to.deep.equal(["captured-original"]);
        expect(result.responses).to.deep.equal([]);
    });

    it("uses the same endpoint rule for one-way delivery", async function () {
        const result = await fixture.probe("parentEndpoint");

        expect(result.consumed).to.equal(true);
        expect(result.invocations).to.deep.equal(["parentEndpoint"]);
        expect(result.responses).to.deep.equal([]);
    });

    it("allows an unguarded service over an untrusted transport", async function () {
        const result = await fixture.probe("childEndpoint", {
            request: true,
            guarded: false,
            trusted: false,
            guardPasses: false
        });

        expect(result.guardChecks).to.equal(0);
        expect(result.guardFailures).to.equal(0);
        expect(result.invocations).to.deep.equal(["childEndpoint"]);
        expect(result.responses[0].result).to.equal("child-result");
    });

    it("spreads params and binds this to the methods instance", async function () {
        const result = await fixture.probe("paramsAndThis", {
            request: true,
            params: ["first", 2]
        });

        expect(result.thisMatchesMethodsInstance).to.equal(true);
        expect(result.responses[0].result).to.equal("first:2");
    });

    it("lets a child accessor shadow an inherited endpoint without evaluating it", async function () {
        const result = await fixture.probe("shadowedEndpoint", {
            request: true,
            shadowMode: "accessor"
        });

        expect(result.consumed).to.equal(false);
        expect(result.accessorReads).to.equal(0);
        expect(result.invocations).to.deep.equal([]);
    });

    it("lets a child non-function shadow an inherited endpoint", async function () {
        const result = await fixture.probe("shadowedEndpoint", {
            request: true,
            shadowMode: "nonFunction"
        });

        expect(result.consumed).to.equal(false);
        expect(result.invocations).to.deep.equal([]);
    });

    it("treats an empty request id as a request", async function () {
        const result = await fixture.probe("childEndpoint", {
            request: true,
            requestId: ""
        });

        expect(result.consumed).to.equal(true);
        expect(result.responses).to.deep.equal([
            {
                rpcResponse: true,
                requestId: "",
                ok: true,
                result: "child-result"
            }
        ]);
    });

    it("disconnects after one failed handler-response send without retrying", async function () {
        const result = await fixture.probe("childEndpoint", {
            request: true,
            responseSendThrows: true
        });

        expect(result.consumed).to.equal(true);
        expect(result.responseSendAttempts).to.equal(1);
        expect(result.disconnectCalls).to.equal(1);
        expect(result.responses).to.deep.equal([]);
        expect(result.unhandledRejections).to.deep.equal([]);
    });

    it("disconnects after one failed guard-response send without retrying", async function () {
        const result = await fixture.probe("childEndpoint", {
            request: true,
            guardPasses: false,
            responseSendThrows: true
        });

        expect(result.consumed).to.equal(true);
        expect(result.responseSendAttempts).to.equal(1);
        expect(result.disconnectCalls).to.equal(1);
        expect(result.methodConstructions).to.equal(0);
        expect(result.responses).to.deep.equal([]);
        expect(result.unhandledRejections).to.deep.equal([]);
    });
});
