import { expect } from "chai";

import {
    hasMethod,
    hasProperty,
    hasRpcService,
    isEthersResult
} from "@/utils/ObjectChecks";
import {
    createCallableAccessorValue,
    createResultShape,
    createRpcRoot,
    createRpcServiceShape,
    createThrowingHasProxy,
    createThrowingMethodAccessor,
    StructuralMethodsValue
} from "@test/fixtures/ObjectChecksFixtures";

describe("ObjectChecks", function () {
    it("recognizes own and inherited properties on object values", function () {
        const value = new StructuralMethodsValue();

        expect(hasProperty(value, "ownCallable")).to.equal(true);
        expect(hasProperty(value, "callable")).to.equal(true);
    });

    it("rejects missing properties and non-object values", function () {
        expect(hasProperty({}, "missing")).to.equal(false);
        expect(hasProperty(null, "missing")).to.equal(false);
        expect(hasProperty(undefined, "missing")).to.equal(false);
        expect(hasProperty("value", "length")).to.equal(false);
        expect(hasProperty(1, "toString")).to.equal(false);
        expect(hasProperty(() => undefined, "call")).to.equal(false);
    });

    it("recognizes callable own properties", function () {
        expect(hasMethod(new StructuralMethodsValue(), "ownCallable")).to.equal(
            true
        );
    });

    it("recognizes callable inherited properties", function () {
        expect(hasMethod(new StructuralMethodsValue(), "callable")).to.equal(
            true
        );
    });

    it("recognizes Object prototype methods as structural methods", function () {
        expect(hasMethod({}, "toString")).to.equal(true);
        expect(hasMethod({}, "hasOwnProperty")).to.equal(true);
    });

    it("evaluates callable accessors during method checks", function () {
        let accessorReads = 0;
        const value = createCallableAccessorValue(() => {
            accessorReads += 1;
        });

        expect(hasMethod(value, "callable")).to.equal(true);
        expect(accessorReads).to.equal(1);
    });

    it("propagates accessor and proxy trap failures", function () {
        expect(() =>
            hasMethod(createThrowingMethodAccessor(), "callable")
        ).to.throw("method accessor failed");
        expect(() =>
            hasProperty(createThrowingHasProxy(), "property")
        ).to.throw("property trap failed");
    });

    it("rejects non-functions, missing methods, and non-object values", function () {
        const value = new StructuralMethodsValue();

        expect(hasMethod(value, "nonCallable")).to.equal(false);
        expect(hasMethod(value, "missing")).to.equal(false);
        expect(hasMethod(null, "missing")).to.equal(false);
        expect(hasMethod(undefined, "missing")).to.equal(false);
        expect(hasMethod("value", "toString")).to.equal(false);
    });

    it("accepts a complete RPC service shape", function () {
        expect(
            hasRpcService(createRpcRoot(createRpcServiceShape()), "service")
        ).to.equal(true);
    });

    it("rejects a missing, null, primitive, or function-valued RPC service", function () {
        expect(hasRpcService({}, "service")).to.equal(false);
        expect(hasRpcService(createRpcRoot(null), "service")).to.equal(false);
        expect(hasRpcService(createRpcRoot("service"), "service")).to.equal(
            false
        );
        expect(
            hasRpcService(
                createRpcRoot(() => undefined),
                "service"
            )
        ).to.equal(false);
    });

    it("rejects missing and non-callable createRPCMethods members", function () {
        const missing = createRpcServiceShape();
        const nonCallable = createRpcServiceShape();
        delete missing.createRPCMethods;
        nonCallable.createRPCMethods = "create";

        expect(hasRpcService(createRpcRoot(missing), "service")).to.equal(
            false
        );
        expect(hasRpcService(createRpcRoot(nonCallable), "service")).to.equal(
            false
        );
    });

    it("rejects missing, null, primitive, and function p2pManager members", function () {
        const missing = createRpcServiceShape();
        const nullManager = createRpcServiceShape();
        const primitiveManager = createRpcServiceShape();
        const functionManager = createRpcServiceShape();
        delete missing.p2pManager;
        nullManager.p2pManager = null;
        primitiveManager.p2pManager = "manager";
        functionManager.p2pManager = () => undefined;

        expect(hasRpcService(createRpcRoot(missing), "service")).to.equal(
            false
        );
        expect(hasRpcService(createRpcRoot(nullManager), "service")).to.equal(
            false
        );
        expect(
            hasRpcService(createRpcRoot(primitiveManager), "service")
        ).to.equal(false);
        expect(
            hasRpcService(createRpcRoot(functionManager), "service")
        ).to.equal(false);
    });

    it("rejects missing and non-callable runRPC members", function () {
        const missing = createRpcServiceShape();
        const nonCallable = createRpcServiceShape();
        delete missing.runRPC;
        nonCallable.runRPC = "run";

        expect(hasRpcService(createRpcRoot(missing), "service")).to.equal(
            false
        );
        expect(hasRpcService(createRpcRoot(nonCallable), "service")).to.equal(
            false
        );
    });

    it("accepts an array with the complete ethers Result API", function () {
        expect(isEthersResult(createResultShape())).to.equal(true);
    });

    it("rejects non-array values even when they expose Result methods", function () {
        const resultMethods = createResultShape();
        const nonArray = {
            getValue: resultMethods.getValue!,
            toArray: resultMethods.toArray!,
            toObject: resultMethods.toObject!
        };

        expect(isEthersResult(nonArray)).to.equal(false);
        expect(isEthersResult(null)).to.equal(false);
        expect(isEthersResult("result")).to.equal(false);
    });

    it("rejects arrays missing each required Result method", function () {
        const missingGetValue = createResultShape();
        const missingToArray = createResultShape();
        const missingToObject = createResultShape();
        delete missingGetValue.getValue;
        delete missingToArray.toArray;
        delete missingToObject.toObject;

        expect(isEthersResult(missingGetValue)).to.equal(false);
        expect(isEthersResult(missingToArray)).to.equal(false);
        expect(isEthersResult(missingToObject)).to.equal(false);
    });

    it("rejects arrays with non-callable Result methods", function () {
        const nonCallableGetValue = createResultShape();
        const nonCallableToArray = createResultShape();
        const nonCallableToObject = createResultShape();
        Object.assign(nonCallableGetValue, { getValue: "get" });
        Object.assign(nonCallableToArray, { toArray: "array" });
        Object.assign(nonCallableToObject, { toObject: "object" });

        expect(isEthersResult(nonCallableGetValue)).to.equal(false);
        expect(isEthersResult(nonCallableToArray)).to.equal(false);
        expect(isEthersResult(nonCallableToObject)).to.equal(false);
    });
});
