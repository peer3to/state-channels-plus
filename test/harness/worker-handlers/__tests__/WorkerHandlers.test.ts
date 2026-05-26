// W1 §6 bucket (iii) - smoke tests for the named-handler registries.
// asserts the registries enforce uniqueness, return registered fns, throw on
// missing ids, and that the temporary-handler escape hatch round-trips.

import { expect } from "chai";

import {
    _resetRpcStubHandlerRegistryForTests,
    getRpcStubHandler,
    hasRpcStubHandler,
    listRpcStubHandlers,
    registerRpcStubHandler,
    registerTemporaryRpcStubHandler,
    RpcStubHandlerAlreadyRegisteredError,
    RpcStubHandlerNotFoundError
} from "../rpc-stub-handlers";

import {
    _resetDisconnectFilterRegistryForTests,
    DisconnectFilterAlreadyRegisteredError,
    DisconnectFilterNotFoundError,
    getDisconnectFilter,
    hasDisconnectFilter,
    listDisconnectFilters,
    registerDisconnectFilter,
    registerTemporaryDisconnectFilter
} from "../disconnect-filters";

describe("W1 worker-handlers - rpc-stub registry", () => {
    beforeEach(() => {
        _resetRpcStubHandlerRegistryForTests();
    });

    it("register + get round-trips a handler", () => {
        registerRpcStubHandler("t.id", async () => "ok");
        expect(hasRpcStubHandler("t.id")).to.equal(true);
        expect(listRpcStubHandlers()).to.include("t.id");
    });

    it("duplicate register throws", () => {
        registerRpcStubHandler("t.id", async () => "a");
        expect(() => registerRpcStubHandler("t.id", async () => "b")).to.throw(
            RpcStubHandlerAlreadyRegisteredError
        );
    });

    it("get on missing id throws", () => {
        expect(() => getRpcStubHandler("nope")).to.throw(
            RpcStubHandlerNotFoundError
        );
    });

    it("temporary handler registers and unregisters", async () => {
        const id = "t.local-toggle";
        let hit = false;
        const undo = registerTemporaryRpcStubHandler(id, () => {
            hit = true;
            return "ok";
        });
        const fn = getRpcStubHandler(id);
        await fn({ thisCtx: undefined, args: [], handlerArgs: undefined });
        expect(hit).to.equal(true);
        undo();
        expect(hasRpcStubHandler(id)).to.equal(false);
    });
});

describe("W1 worker-handlers - disconnect-filter registry", () => {
    beforeEach(() => {
        _resetDisconnectFilterRegistryForTests();
    });

    it("register + get round-trips a filter", () => {
        registerDisconnectFilter("f.id", () => true);
        expect(hasDisconnectFilter("f.id")).to.equal(true);
        expect(listDisconnectFilters()).to.include("f.id");
    });

    it("duplicate register throws", () => {
        registerDisconnectFilter("f.id", () => true);
        expect(() => registerDisconnectFilter("f.id", () => false)).to.throw(
            DisconnectFilterAlreadyRegisteredError
        );
    });

    it("get on missing id throws", () => {
        expect(() => getDisconnectFilter("nope")).to.throw(
            DisconnectFilterNotFoundError
        );
    });

    it("temporary filter registers and unregisters", async () => {
        const id = "f.local";
        const undo = registerTemporaryDisconnectFilter(
            id,
            (ctx) => ctx.address !== "0xskip"
        );
        const fn = getDisconnectFilter(id);
        expect(await fn({ address: "0xskip", filterArgs: undefined })).to.equal(
            false
        );
        expect(
            await fn({ address: "0xother", filterArgs: undefined })
        ).to.equal(true);
        undo();
        expect(hasDisconnectFilter(id)).to.equal(false);
    });
});
