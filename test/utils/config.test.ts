import { expect } from "chai";
import fs from "fs";
import path from "path";
import os from "os";
import { loadConfigFromFile } from "@/utils/config";

describe("Config - JSON file loading", () => {
    const tempConfigPath = path.join(os.tmpdir(), "test-peer3.config.json");

    afterEach(() => {
        // Clean up temp file after each test
        if (fs.existsSync(tempConfigPath)) {
            fs.unlinkSync(tempConfigPath);
        }
        // Clear require cache to force re-reading
        delete require.cache[require.resolve("@/utils/config")];
    });

    it("should use defaults when config file doesn't exist", () => {
        const config = loadConfigFromFile("/tmp/non-existent.json");
        expect(config).to.be.an("object");
        expect(Object.keys(config)).to.have.length(0);
    });

    it("should load configuration from JSON file", () => {
        const testConfig = {
            PROVIDER_URL: "http://test:9999",
            DEBUG_P2P_MANAGER: true,
            DEBUG_RPC: false
        };

        fs.writeFileSync(tempConfigPath, JSON.stringify(testConfig));
        const config = loadConfigFromFile(tempConfigPath);

        expect(config.PROVIDER_URL).to.equal("http://test:9999");
        expect(config.DEBUG_P2P_MANAGER).to.be.true;
        expect(config.DEBUG_RPC).to.be.false;
    });

    it("should handle malformed JSON gracefully", () => {
        fs.writeFileSync(tempConfigPath, "{ invalid json }");
        const config = loadConfigFromFile(tempConfigPath);

        expect(config).to.be.an("object");
        expect(Object.keys(config)).to.have.length(0);
    });

    it("should export individual config values with defaults", () => {
        const { PROVIDER_URL, DEBUG_P2P_MANAGER } = require("@/utils/config");

        expect(PROVIDER_URL).to.equal("http://localhost:8545");
        expect(DEBUG_P2P_MANAGER).to.be.false;
    });
});
