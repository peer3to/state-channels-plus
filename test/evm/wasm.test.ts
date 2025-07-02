import { expect } from "chai";
import { Wasm } from "@/evm/wasm";
import { wasmBase64 } from "@/evm/precompiles/math";

describe("Wasm", () => {
    let wasm: Wasm;

    before(async () => {
        wasm = await Wasm.fromBase64(wasmBase64);
    });

    describe("initialization", () => {
        it("should initialize WASM module successfully", () => {
            expect(wasm.hasExport("math")).to.be.true;
        });

        it("should allow multiple instances with same source", async () => {
            const wasm1 = await Wasm.fromBase64(wasmBase64);
            const wasm2 = await Wasm.fromBase64(wasmBase64);

            expect(wasm1.hasExport("math")).to.be.true;
            expect(wasm2.hasExport("math")).to.be.true;
        });
    });

    describe("getExport", () => {
        it("should get exported function successfully", () => {
            const math =
                wasm.getExport<(a: number, b: number) => number>("math");
            expect(math).to.be.a("function");
        });

        it("should throw error for non-existent export", () => {
            expect(() => wasm.getExport("nonexistent")).to.throw(
                "Export 'nonexistent' not found"
            );
        });
    });

    describe("hasExport", () => {
        it("should return true for existing export", () => {
            expect(wasm.hasExport("math")).to.be.true;
        });

        it("should return false for non-existent export", () => {
            expect(wasm.hasExport("nonexistent")).to.be.false;
        });
    });

    describe("getExports", () => {
        it("should return list of exports", () => {
            const exports = wasm.exports;
            expect(exports).to.be.an("object");
            expect(exports).to.have.property("math");
        });
    });
});
