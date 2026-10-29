// @spec-test-coverage-ignore: type declarations for the shared polling fixture
export function waitForPlain(
    condition: () => boolean | Promise<boolean>,
    timeoutMs: number,
    pollIntervalMs: number
): Promise<void>;
