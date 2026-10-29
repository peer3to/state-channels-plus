// @spec-test-coverage-ignore: scoped environment inputs to the real worker policy
import { resolveWorkerResourceLimits } from "@/evm/node/workerResourceLimits";
import { expect } from "chai";

export function assertWorkerLimit(
    raw: string | undefined,
    expected: number | undefined
): void {
    const previous = process.env.SCP_WORKER_MAX_OLD_SPACE_MB;
    try {
        if (raw === undefined) delete process.env.SCP_WORKER_MAX_OLD_SPACE_MB;
        else process.env.SCP_WORKER_MAX_OLD_SPACE_MB = raw;
        expect(resolveWorkerResourceLimits()).to.deep.equal(
            expected === undefined
                ? undefined
                : { maxOldGenerationSizeMb: expected }
        );
    } finally {
        if (previous === undefined)
            delete process.env.SCP_WORKER_MAX_OLD_SPACE_MB;
        else process.env.SCP_WORKER_MAX_OLD_SPACE_MB = previous;
    }
}
