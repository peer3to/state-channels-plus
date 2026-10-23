// @spec-test-coverage-ignore: shared test-support promise helper; contains no test declarations

/** A promise and the function that resolves it, for a test to hold work until it releases it. */
export function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
