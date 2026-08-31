// @spec-test-coverage-ignore: developer diagnostics tooling; not protocol behavior, no specification or implementation IDs apply
/**
 * the one definition of the crash-log config a test run needs. browser-safe on
 * purpose: the browser cases import it too, so a key rename is one edit.
 */

import { config, createConfig } from "@/utils/config";

/**
 * applies overrides and returns the restore. createConfig rebuilds the whole
 * config from defaults + file + env, so a suite that does not put back what it
 * found leaves every later test pointing at a closed receiver.
 */
export function applyCrashLogConfig(
    overrides: Parameters<typeof createConfig>[0]
): () => void {
    const snapshot = { ...config };
    createConfig(overrides);
    return () => {
        createConfig(snapshot);
    };
}

/** a real endpoint with jitter pinned, so a round is not racing a 0-3s sleep */
export function crashLogUploadOverrides(uploadEndpoint: string) {
    return {
        CRASH_LOG_UPLOAD_ENDPOINT: uploadEndpoint,
        CRASH_LOG_UPLOAD_JITTER_MAX_MS: 0
    };
}

/** the upload overrides plus a thread topology. reaches worker realms through
 *  the setup payload. */
export function crashLogConfigOverrides(
    uploadEndpoint: string,
    threads: { runSdkInThread: boolean; vmDedicatedThread: boolean }
) {
    return {
        ...crashLogUploadOverrides(uploadEndpoint),
        RUN_SDK_IN_THREAD: threads.runSdkInThread,
        VM_DEDICATED_THREAD: threads.vmDedicatedThread
    };
}
