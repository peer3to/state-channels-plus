import { expect } from "chai";

import { applyNodeGlobalsShim } from "@/evm/p2pRuntime/worker/nodeGlobalsShim";

type ProcessShim = {
    env?: Record<string, string | undefined>;
    nextTick?: (
        callback: (...args: unknown[]) => void,
        ...args: unknown[]
    ) => void;
    browser?: boolean;
    versions?: { node?: string };
};
type Scope = { global?: unknown; process?: ProcessShim };

describe("applyNodeGlobalsShim", () => {
    it("fills in a full process shim when none exists", () => {
        const scope: Scope = {};

        applyNodeGlobalsShim(scope);

        expect(scope.global).to.not.be.undefined;
        expect(scope.process).to.be.an("object");
        expect(scope.process!.env).to.be.an("object");
        expect(scope.process!.nextTick).to.be.a("function");
        expect(scope.process!.browser).to.equal(true);
    });

    it("patches missing fields on a partial process without clobbering existing ones", () => {
        // The regression this guards: a bundler injects `process` with `env`
        // but no `nextTick`, and the old whole-object `??=` left `nextTick`
        // undefined (crashing the EVM stack).
        const existingEnv = { DEBUG: "some-scope" };
        const scope: Scope = { process: { env: existingEnv } };

        applyNodeGlobalsShim(scope);

        expect(scope.process!.env).to.equal(existingEnv);
        expect(scope.process!.nextTick).to.be.a("function");
        expect(scope.process!.browser).to.equal(true);
    });

    it("does not overwrite an existing nextTick", () => {
        const nextTick = () => {};
        const scope: Scope = { process: { nextTick } };

        applyNodeGlobalsShim(scope);

        expect(scope.process!.nextTick).to.equal(nextTick);
    });

    it("does not identify a real Node process as a browser", () => {
        const scope: Scope = {
            process: { versions: { node: "22.0.0" } }
        };

        applyNodeGlobalsShim(scope);

        expect(scope.process!.browser).to.equal(false);
    });

    it("schedules the callback asynchronously via the shimmed nextTick", async () => {
        const scope: Scope = {};
        applyNodeGlobalsShim(scope);

        const received = await new Promise<string>((resolve) => {
            scope.process!.nextTick!(
                (value: unknown) => resolve(value as string),
                "ok"
            );
        });

        expect(received).to.equal("ok");
    });
});
