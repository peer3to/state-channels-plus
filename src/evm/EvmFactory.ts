import { EVM, EVMOpts } from "@ethereumjs/evm";
import { maybeGetLogs } from "@ganache/console.log";
import { Buffer } from "buffer";
import { createLogger } from "@/utils";

const solidityLogger = createLogger("Solidity");

export interface EvmFactoryOptions extends EVMOpts {
    enableConsoleLog?: boolean;
}

export async function createEvm(options: EvmFactoryOptions = {}): Promise<EVM> {
    const { enableConsoleLog = true } = options;

    const evm = await EVM.create(options);

    if (enableConsoleLog) {
        setupConsoleLogHook(evm);
    }

    return evm;
}

export function setupConsoleLogHook(evm: EVM): void {
    const log = solidityLogger;

    evm.events.on("step", (event) => {
        // Convert Uint8Array to Buffer for @ganache/console.log compatibility
        const adaptedEvent = {
            opcode: event.opcode,
            stack: event.stack,
            memory: Buffer.from(event.memory)
        };
        const logs = maybeGetLogs(adaptedEvent);
        if (logs) {
            // Format logs as a single message string
            const message = logs
                .map((v) => (typeof v === "bigint" ? v.toString() : String(v)))
                .join(" ");
            log.info(message);
        }
    });
}

export default createEvm;
