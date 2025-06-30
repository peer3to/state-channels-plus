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
    let wasm: Wasm;

    before(async () => {
        wasmBytes = fs.readFileSync(mathWasmPath);
        wasm = await Wasm.init(wasmBytes);
    });

    describe("initialization", () => {
        it("should initialize WASM module successfully", () => {
            expect(wasm.hasExport("add")).to.be.true;
        });

        it("should allow multiple instances with same source", async () => {
            const wasm1 = await Wasm.init(wasmBytes);
            const wasm2 = await Wasm.init(wasmBytes);

            expect(wasm1.hasExport("add")).to.be.true;
            expect(wasm2.hasExport("add")).to.be.true;
        });
    });

    describe("getExport", () => {
        it("should get exported function successfully", () => {
            const add = wasm.getExport<(a: number, b: number) => number>("add");
            expect(add).to.be.a("function");
            expect(add(2, 3)).to.equal(5);
        });

        it("should throw error for non-existent export", () => {
            expect(() => wasm.getExport("nonexistent")).to.throw(
                "Export 'nonexistent' not found"
            );
        });
    });

    describe("hasExport", () => {
        it("should return true for existing export", () => {
            expect(wasm.hasExport("add")).to.be.true;
        });

        it("should return false for non-existent export", () => {
            expect(wasm.hasExport("nonexistent")).to.be.false;
        });
    });

    describe("getExports", () => {
        it("should return list of exports", () => {
            const exports = wasm.getExports();
            expect(exports).to.be.an("array");
            expect(exports).to.include("add");
            expect(exports).to.include("multiply");
            expect(exports).to.include("divide");
        });
    });
});
