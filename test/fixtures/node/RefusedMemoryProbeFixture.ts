// @spec-test-coverage-ignore: starts the refused-grow probe thread; the declaration lives in ThreadResources.test.ts
import { expect } from "chai";
import { once } from "node:events";
import { Worker } from "node:worker_threads";

/** The error a refused grow throws, as a browser out of address space does. */
export const REFUSED_GROW_MESSAGE =
    "WebAssembly.Memory.grow(): Maximum memory size exceeded";

/**
 * The probe is taken once per thread, and this test thread already has one,
 * so the refused grow runs in a fresh thread.
 */
export async function assertRefusedGrowProbeIsReused(): Promise<void> {
    const entry = require.resolve("./RefusedMemoryProbeEntry");
    const worker = new Worker(entry, {
        // the compiled entry needs no loader; the source one does
        execArgv: entry.endsWith(".ts")
            ? [
                  "-r",
                  "ts-node/register/transpile-only",
                  "-r",
                  "tsconfig-paths/register"
              ]
            : undefined
    });
    const exited = once(worker, "exit");
    const failed = once(worker, "error").then(([error]) => {
        throw error;
    });
    const [message] = await Promise.race([once(worker, "message"), failed]);
    const refused = {
        canCreate: true,
        canGrow16MiB: false,
        error: REFUSED_GROW_MESSAGE
    };
    expect(message.firstProbe).to.deep.equal(refused);
    expect(message.secondProbe).to.deep.equal(refused);
    expect(message.isSameProbe).to.equal(true);
    // The trap module has no memory: the one memory is the single probe's.
    expect(message.memoriesConstructed).to.equal(1);
    expect((await exited)[0]).to.equal(0);
}
