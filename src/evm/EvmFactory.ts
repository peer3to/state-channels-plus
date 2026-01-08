import { EVM, EVMOpts } from "@ethereumjs/evm";
import { Buffer } from "buffer";
import { createLogger, isNodeRuntime } from "@/utils";

export interface EvmFactoryOptions extends EVMOpts {
    enableConsoleLog?: boolean;
}

export async function createEvm(options: EvmFactoryOptions = {}): Promise<EVM> {
    // Console.log decoding depends on Node-oriented deps; default it off in browsers.
    const { enableConsoleLog = isNodeRuntime() } = options;

    const evm = await EVM.create(options);

    if (enableConsoleLog) {
        setupConsoleLogHook(evm);
    }

    return evm;
}

export function setupConsoleLogHook(evm: EVM): void {
    const log = createLogger({ component: "Solidity" });

    if (!isNodeRuntime()) return;

    // Lazy-load to avoid pulling Node-only deps into browser runtime evaluation.
    void import("@ganache/console.log")
        .then(({ maybeGetLogs }) => {
            evm.events.on("step", (event) => {
                // Convert Uint8Array to Buffer for @ganache/console.log compatibility
                const adaptedEvent = {
                    opcode: event.opcode,
                    stack: event.stack,
                    memory: Buffer.from(event.memory)
                };
                const logs = maybeGetLogs(adaptedEvent);
                if (logs) {
                    const message = logs
                        .map((v) =>
                            typeof v === "bigint" ? v.toString() : String(v)
                        )
                        .join(" ");
                    log.info(message);
                }
            });
        })
        .catch(() => {
            // If the dependency isn't available, just skip the hook.
        });
}

export default createEvm;
