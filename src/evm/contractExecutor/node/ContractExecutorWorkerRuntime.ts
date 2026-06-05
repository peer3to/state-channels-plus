import { createWorkerClientTransport } from "@platform/workerTransport";
import type { WorkerClientTransport } from "@/utils/worker/types";

export function createContractExecutorTransport(): WorkerClientTransport {
    return createWorkerClientTransport({
        dir: __dirname,
        basename: "ContractExecutorWorkerHost"
    });
}
