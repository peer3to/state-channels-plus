// @spec-test-coverage-ignore: shared test-support promise helper; contains no test declarations
import { expect } from "chai";

/** The rejection of `pending`; fails the test when it resolves. */
export async function rejectionOf(pending: Promise<unknown>): Promise<unknown> {
    try {
        await pending;
    } catch (error) {
        return error;
    }
    return expect.fail("the promise was expected to reject");
}

/** The error `pending` rejects with; fails the test when it resolves or rejects with no Error. */
export async function errorRejectionOf(
    pending: Promise<unknown>
): Promise<Error> {
    const rejection = await rejectionOf(pending);
    if (!(rejection instanceof Error))
        return expect.fail(`expected an Error, got ${String(rejection)}`);
    return rejection;
}
