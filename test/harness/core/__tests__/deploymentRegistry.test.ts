// W7 §1.3 / D-51 - deployment registry semantics.

import { expect } from "chai";
import { describe, it, beforeEach } from "mocha";

import {
    registerDeployment,
    resolveDeployment,
    hasDeployment,
    listDeployments,
    deriveAutoKey,
    DeploymentRegistryConflict,
    DeploymentNotFoundError,
    _resetRegistryForTests
} from "@test/harness/core/deploymentRegistry";

import type { HarnessDeploymentConfig } from "@test/harness/core/types";

// shared module-scoped deployer so two registrations under the same key
// reuse the SAME function references -> structurallyEqual returns true.
const A_DEPLOYER: HarnessDeploymentConfig<any> = {
    deployOnChainContracts: async () => "0xA",
    deployLocalStateMachine: async () => "0xLocalA",
    connectSigner: ((addr: string) => ({ addr }) as any) as any
};

const B_DEPLOYER: HarnessDeploymentConfig<any> = {
    deployOnChainContracts: async () => "0xB",
    deployLocalStateMachine: async () => "0xLocalB",
    connectSigner: ((addr: string) => ({ addr }) as any) as any
};

describe("DeploymentRegistry", () => {
    beforeEach(() => {
        _resetRegistryForTests();
    });

    it("registerDeployment + resolveDeployment round-trip", () => {
        registerDeployment("test:a", A_DEPLOYER);
        expect(hasDeployment("test:a")).to.equal(true);
        const resolved = resolveDeployment("test:a");
        expect(resolved).to.equal(A_DEPLOYER);
    });

    it("listDeployments returns the registered keys", () => {
        registerDeployment("test:a", A_DEPLOYER);
        registerDeployment("test:b", B_DEPLOYER);
        const keys = listDeployments().sort();
        expect(keys).to.deep.equal(["test:a", "test:b"]);
    });

    it("re-registering the same key + same deployer is a no-op (idempotent)", () => {
        registerDeployment("test:a", A_DEPLOYER);
        // second registration with the SAME deployer reference -> no throw.
        expect(() => registerDeployment("test:a", A_DEPLOYER)).to.not.throw();
        expect(resolveDeployment("test:a")).to.equal(A_DEPLOYER);
    });

    it("re-registering the same key with a different deployer throws DeploymentRegistryConflict", () => {
        registerDeployment("test:a", A_DEPLOYER);
        let thrown: unknown;
        try {
            registerDeployment("test:a", B_DEPLOYER);
        } catch (e) {
            thrown = e;
        }
        expect(thrown).to.be.instanceOf(DeploymentRegistryConflict);
        expect((thrown as DeploymentRegistryConflict).key).to.equal("test:a");
    });

    it("resolveDeployment on an unknown key throws DeploymentNotFoundError", () => {
        registerDeployment("test:a", A_DEPLOYER);
        let thrown: unknown;
        try {
            resolveDeployment("test:does-not-exist");
        } catch (e) {
            thrown = e;
        }
        expect(thrown).to.be.instanceOf(DeploymentNotFoundError);
        const err = thrown as DeploymentNotFoundError;
        expect(err.key).to.equal("test:does-not-exist");
        expect(err.known).to.deep.equal(["test:a"]);
    });

    it("deriveAutoKey is stable + content-keyed", () => {
        const k1 = deriveAutoKey(A_DEPLOYER);
        const k2 = deriveAutoKey(A_DEPLOYER);
        expect(k1).to.equal(k2);
        expect(k1.startsWith("auto:")).to.equal(true);
    });
});
