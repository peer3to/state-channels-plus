import { Buffer } from "buffer";
import ContractExecutor from "./ContractExecutor";
import { createEvm } from "../EvmFactory";
import noOpLogger from "./NoOpLogger";
import type {
    WorkerRequest,
    WorkerRequestPayload,
    WorkerResponse
} from "./types";

const workerGlobal = globalThis as unknown as {
    Buffer?: typeof Buffer;
    global?: typeof globalThis;
    window?: typeof globalThis;
};

workerGlobal.Buffer ||= Buffer;
workerGlobal.global ||= globalThis;
workerGlobal.window ||= globalThis;

let evm: Awaited<ReturnType<typeof createEvm>> | undefined;
let executor: ContractExecutor | undefined;

async function init(request: Extract<WorkerRequestPayload, { type: "init" }>) {
    evm = await createEvm(
        {
            allowUnlimitedContractSize: true,
            customPrecompiles: request.customPrecompiles.map(
                ({ address, module, exportName, options }) => ({
                    address,
                    module,
                    exportName,
                    options
                })
            )
        },
        noOpLogger
    );
    executor = new ContractExecutor(evm, noOpLogger);
    return null;
}

function getExecutor(): ContractExecutor {
    if (!executor) {
        throw new Error("Contract executor worker has not been initialized");
    }
    return executor;
}

async function call(request: Extract<WorkerRequestPayload, { type: "call" }>) {
    const executor = getExecutor();
    const result =
        request.method === "deploy"
            ? await executor.deploy(request.data)
            : request.method === "executeCall"
              ? await executor.executeCall(
                    request.data,
                    request.contractAddress
                )
              : await executor.simulateCall(
                    request.data,
                    request.contractAddress
                );

    return result;
}

async function handleRequest(request: WorkerRequest): Promise<WorkerResponse> {
    const { requestId, workerRequestPayload } = request;
    try {
        const result =
            workerRequestPayload.type === "init"
                ? await init(workerRequestPayload)
                : await call(workerRequestPayload);

        return {
            requestId,
            ok: true,
            result
        };
    } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        return {
            requestId,
            ok: false,
            error: {
                message: err.message,
                data: (err as any).data,
                name: err.name,
                stack: err.stack
            }
        };
    }
}

export function startContractExecutorWorkerHost(
    post: (response: WorkerResponse) => void,
    onMessage: (handler: (message: WorkerRequest) => void) => void
): void {
    onMessage((request) => {
        void handleRequest(request).then(post);
    });

    post({ type: "ready" });
}
