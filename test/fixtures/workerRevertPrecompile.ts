// @spec-test-coverage-ignore: request-boundary failure fixture loaded by the real executor worker
import { maybeStampErrorWithPeerAddress } from "@/utils/errorPeerAddress";

export default function createWorkerRevertPrecompile(options: {
    data: string;
    peer: string;
}) {
    const error = Object.assign(new Error("request precompile failure"), {
        name: "PrecompileInitializationError",
        code: "CALL_EXCEPTION",
        info: { error: { data: options.data } }
    });
    maybeStampErrorWithPeerAddress(error, options.peer);
    return () => {
        throw error;
    };
}
