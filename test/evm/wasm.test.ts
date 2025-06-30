import { expect } from "chai";
import { Wasm } from "@/evm/wasm";
import fs from "fs";
import path from "path";

describe("Wasm", () => {
    const mathWasmPath = path.resolve(
        __dirname,
        "../../src/evm/precompiles/math.wasm"
    );
    let wasmBytes: Uint8Array;

    before(async () => {
        wasmBytes = fs.readFileSync(mathWasmPath);
    });

    beforeEach(async () => {
        Wasm.reset();
    });

    describe("init", () => {
        it("should initialize WASM module successfully", async () => {
            await expect(Wasm.init(wasmBytes)).to.not.be.rejected;
        });

        it("should not reinitialize if already initialized", async () => {
            await Wasm.init(wasmBytes);
            await Wasm.init(wasmBytes); // Should not throw
        });
    });

    describe("getExport", () => {
        beforeEach(async () => {
            await Wasm.init(wasmBytes);
        });

        it("should get exported function successfully", () => {
            const add = Wasm.getExport<(a: number, b: number) => number>("add");
            expect(add).to.be.a("function");
            expect(add(2, 3)).to.equal(5);
        });

        it("should throw error if module not initialized", () => {
            Wasm.reset();
            expect(() => Wasm.getExport("add")).to.throw(
                "WASM module not initialized"
            );
        });

        it("should throw error for non-existent export", () => {
            expect(() => Wasm.getExport("nonexistent")).to.throw(
                "Export 'nonexistent' not found"
            );
        });
    });

    describe("hasExport", () => {
        it("should return false if module not initialized", () => {
            expect(Wasm.hasExport("add")).to.be.false;
        });

        it("should return true for existing export", async () => {
            await Wasm.init(wasmBytes);
            expect(Wasm.hasExport("add")).to.be.true;
        });

        it("should return false for non-existent export", async () => {
            await Wasm.init(wasmBytes);
            expect(Wasm.hasExport("nonexistent")).to.be.false;
        });
    });

    describe("getExports", () => {
        it("should throw error if module not initialized", () => {
            expect(() => Wasm.getExports()).to.throw(
                "WASM module not initialized"
            );
        });

        it("should return list of exports", async () => {
            await Wasm.init(wasmBytes);
            const exports = Wasm.getExports();
            expect(exports).to.be.an("array");
            expect(exports).to.eq("add");
            expect(exports).to.include("multiply");
            expect(exports).to.include("divide");
        });
    });

    describe("reset", () => {
        it("should reset WASM instance", async () => {
            await Wasm.init(wasmBytes);
            expect(Wasm.hasExport("add")).to.be.true;

            Wasm.reset();
            expect(Wasm.hasExport("add")).to.be.false;
        });
    });
});
