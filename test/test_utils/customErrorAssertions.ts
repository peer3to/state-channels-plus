// @spec-test-coverage-ignore: shared assertion helper for test files; declares no runnable case, so no specification or implementation IDs apply
import { expect } from "chai";
import { CustomEvmError, tryDecodeCustomError } from "@/utils";

// Asserts the revert decoded to `name`, then hands the decoded error back so
// the caller can assert the arguments the contract populated.
export function expectDecodedError(
    error: unknown,
    name: string,
    failMessage: string
): CustomEvmError {
    const customError = tryDecodeCustomError(error);
    expect(customError, failMessage).to.not.be.null;
    expect(customError!.errorDescription.name, failMessage).to.equal(name);
    return customError!;
}
