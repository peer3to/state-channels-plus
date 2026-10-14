// @spec-test-coverage-ignore: child-process parent for the native-handle drain case of RootWorkerDrain.test.ts
import {
    NATIVE_HANDLE_RESULT_PREFIX,
    runNativeHandleDrain
} from "./RootWorkerDrainFixture";

// The test reads one result line; an abort of this process ends it with a
// signal before the line is written.
void runNativeHandleDrain().then((result) => {
    process.stdout.write(
        `${NATIVE_HANDLE_RESULT_PREFIX}${JSON.stringify(result)}\n`
    );
});
