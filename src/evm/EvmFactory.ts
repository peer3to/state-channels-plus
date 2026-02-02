import { EVM, EVMOpts } from "@ethereumjs/evm";
import { Buffer } from "buffer";
import { isNodeRuntime } from "@/utils";
import type { Logger } from "@/utils";

export interface EvmFactoryOptions extends EVMOpts {
    logger?: Logger;
}

export async function createEvm(options: EvmFactoryOptions = {}): Promise<EVM> {
    const evm = await EVM.create(options);
    setupConsoleLogHook(evm, options.logger);

    return evm;
}

export function setupConsoleLogHook(evm: EVM, _logger?: Logger): void {
    const logger = _logger?.child({ component: "Solidity" });
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
                    logger?.info(message);
                }
            });
        })
        .catch(() => {
            // If the dependency isn't available, just skip the hook.
        });
}

export default createEvm;
