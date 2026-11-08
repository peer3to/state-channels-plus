import { isAxiosError } from "@/utils/logging/axiosErrorUtils";
import { loadedModules } from "@test/utils/loadedModules";
import axios, { AxiosError } from "axios";
import { expect } from "chai";

const isEvm = (file: string) => file.includes("/node_modules/@ethereumjs/evm/");
const isAxios = (file: string) => file.includes("/node_modules/axios/");

describe("package index lazy modules", function () {
    it("loads no EVM until an EVM is created", function () {
        expect(
            loadedModules("@peer3/state-channels-plus").some(isEvm)
        ).to.equal(false);
        const created = loadedModules(
            "./dist/src/evm/EvmFactory.js",
            "const logger = { debug() {}, log() {}, child: () => logger }; await entry.createEvm({}, logger)"
        );
        expect(created.some(isEvm)).to.equal(true);
    });

    it("loads no axios", function () {
        expect(
            loadedModules("@peer3/state-channels-plus").some(isAxios)
        ).to.equal(false);
    });

    it("recognizes an axios error exactly as axios does", function () {
        const values = [
            new AxiosError("failed", "ECONNRESET"),
            { isAxiosError: true },
            { isAxiosError: "true" },
            new Error("failed"),
            null,
            "failed"
        ];
        for (const value of values) {
            expect(isAxiosError(value), String(value)).to.equal(
                axios.isAxiosError(value)
            );
        }
    });
});
