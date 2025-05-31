import { expect } from "chai";

describe("Config Integration - Real Usage", () => {
    const originalEnv = process.env;

    before(() => {
        // Set test environment variables before any imports
        process.env.PROVIDER_URL = "http://test-provider:8545";
        process.env.DEBUG_P2P_MANAGER = "true";
        process.env.DEBUG_RPC = "false";
        process.env.DEBUG_LOCAL_TRANSPORT = "true";
    });

    after(() => {
        // Restore original environment
        process.env = originalEnv;
    });

    it("should load config through main entry point", async () => {
        // Import the main entry point (this calls dotenv.config())
        const mainModule = await import("@/index");
        expect(mainModule).to.exist;

        // Import config module (should have environment variables loaded)
        const {
            PROVIDER_URL,
            DEBUG_P2P_MANAGER,
            DEBUG_RPC,
            DEBUG_LOCAL_TRANSPORT
        } = await import("@/utils/config");

        expect(PROVIDER_URL).to.equal("http://test-provider:8545");
        expect(DEBUG_P2P_MANAGER).to.be.true;
        expect(DEBUG_RPC).to.be.false;
        expect(DEBUG_LOCAL_TRANSPORT).to.be.true;
    });

    it("should work when importing P2PManager", async () => {
        // This should not throw errors and should use the config
        const P2PManagerModule = await import("@/P2PManager");
        expect(P2PManagerModule.default).to.exist;

        const { DEBUG_P2P_MANAGER, DEBUG_LOCAL_TRANSPORT } = await import(
            "@/utils/config"
        );
        expect(DEBUG_P2P_MANAGER).to.be.true;
        expect(DEBUG_LOCAL_TRANSPORT).to.be.true;
    });

    it("should work when importing MainRpcService", async () => {
        // This should not throw errors and should use the config
        const MainRpcServiceModule = await import("@/rpc/MainRpcService");
        expect(MainRpcServiceModule.default).to.exist;

        const { DEBUG_RPC } = await import("@/utils/config");
        expect(DEBUG_RPC).to.be.false;
    });
});
