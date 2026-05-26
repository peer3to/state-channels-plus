// W7 §1.3 / D-51 - string-keyed deployment registry. shared between the
// single-threaded harness (which can pass closures directly) and the threaded
// harness (which cannot ship closures across worker boundaries -> looks up by
// name in a module the worker entry.ts imports).
//
// design notes:
// - keys are plain strings. built-in deployments self-register at module load
//   via side-effect imports under `bundles/deployments/index.ts`.
// - NF4 collision policy: re-registering the same key with a structurally
//   identical deployer is a no-op (idempotent for pool-reuse). different
//   deployer under the same key throws `DeploymentRegistryConflict`.
// - structural identity check is by-reference for the three callable fields,
//   not by serialized form. closures cannot be deep-compared, but pool-reuse
//   suites share the same module-level deployer constant -> reference equality
//   is the right granularity.
// - "auto:" prefix reserved for the single-threaded harness path where a test
//   constructs a deployer inline. it computes a sha256-derived key so two
//   tests with identical deployer constants don't collide.

import { createHash } from "node:crypto";

import type { HarnessDeploymentConfig } from "./types";
import type { AStateMachine as AStateMachineContract } from "@typechain-types";

export class DeploymentRegistryConflict extends Error {
    readonly key: string;
    constructor(key: string) {
        super(
            `DeploymentRegistry: key "${key}" is already registered with a different deployer. ` +
                `re-registering with the same deployer is a no-op; different deployer is an error. ` +
                `pick a unique key or re-use the existing registration.`
        );
        this.name = "DeploymentRegistryConflict";
        this.key = key;
    }
}

export class DeploymentNotFoundError extends Error {
    readonly key: string;
    readonly known: string[];
    constructor(key: string, known: string[]) {
        super(
            `DeploymentRegistry: no deployment registered under key "${key}". ` +
                `known: ${known.length === 0 ? "<none>" : known.join(", ")}. ` +
                `if you're in a worker, ensure the bootstrap manifest imports the deployment module.`
        );
        this.name = "DeploymentNotFoundError";
        this.key = key;
        this.known = known;
    }
}

const REGISTRY = new Map<string, HarnessDeploymentConfig<any>>();

function structurallyEqual(
    a: HarnessDeploymentConfig<any>,
    b: HarnessDeploymentConfig<any>
): boolean {
    // step 1 - reference equality on the three closure fields. callers register
    // module-scoped constants -> same import path = same reference.
    return (
        a.deployOnChainContracts === b.deployOnChainContracts &&
        a.deployLocalStateMachine === b.deployLocalStateMachine &&
        a.connectSigner === b.connectSigner
    );
}

export function registerDeployment<T extends AStateMachineContract>(
    key: string,
    deployer: HarnessDeploymentConfig<T>
): void {
    const existing = REGISTRY.get(key);
    if (existing) {
        if (structurallyEqual(existing, deployer)) return;
        throw new DeploymentRegistryConflict(key);
    }
    REGISTRY.set(key, deployer);
}

export function resolveDeployment<
    T extends AStateMachineContract = AStateMachineContract
>(key: string): HarnessDeploymentConfig<T> {
    const found = REGISTRY.get(key);
    if (!found) {
        throw new DeploymentNotFoundError(key, [...REGISTRY.keys()]);
    }
    return found as HarnessDeploymentConfig<T>;
}

export function hasDeployment(key: string): boolean {
    return REGISTRY.has(key);
}

export function listDeployments(): string[] {
    return [...REGISTRY.keys()];
}

/**
 * step 1 - "auto:" key derivation. used by `SingleThreadedHarness` when a test
 * passes a closure deployer directly. content-hashes the three function names
 * + arity so two tests with identical module-scoped deployer constants
 * collapse to one entry on registration; throw on the second registration if
 * a different deployer hits the same hash (function rename -> different key).
 */
export function deriveAutoKey(deployer: HarnessDeploymentConfig<any>): string {
    const parts = [
        deployer.deployOnChainContracts.name || "anon",
        String(deployer.deployOnChainContracts.length),
        deployer.deployLocalStateMachine.name || "anon",
        String(deployer.deployLocalStateMachine.length),
        deployer.connectSigner.name || "anon",
        String(deployer.connectSigner.length)
    ];
    const h = createHash("sha256").update(parts.join("|")).digest("hex");
    return `auto:${h.slice(0, 16)}`;
}

/** test-only escape hatch. resets registry; built-in modules re-register on next import. */
export function _resetRegistryForTests(): void {
    REGISTRY.clear();
}
