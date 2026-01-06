import { EVM, EVMOpts } from "@ethereumjs/evm";
import { Buffer } from "buffer";
import { createLogger } from "@/utils";

export interface EvmFactoryOptions extends EVMOpts {
    enableConsoleLog?: boolean;
}

export function isNodeRuntime(): boolean {
    return typeof process !== "undefined" && !!(process as any).versions?.node;
}

export async function createEvm(options: EvmFactoryOptions = {}): Promise<EVM> {
    // Console.log decoding depends on Node-oriented deps; default it off in browsers.
    const { enableConsoleLog = isNodeRuntime() } = options;

    const evm = await EVM.create(options);

    if (enableConsoleLog) {
        setupGanacheConsoleLogHook(evm);
    }

    return evm;
}

/**
 * Sets up Ganache's console.log hook for Node runtime.
 * This intercepts console.log at the EVM opcode level during execution,
 * analyzing stack/memory to decode Hardhat console.log calls.
 *
 * Note: This only works in Node runtime because @ganache/console.log
 * requires Node.js-specific dependencies (Buffer, etc.)
 *
 * For browser runtime, console.log is handled via log event parsing
 * in EvmDiamondStateMachine.processLogs()
 */
export function setupGanacheConsoleLogHook(evm: EVM): void {
    if (!isNodeRuntime()) {
        // Browser runtime should use processLogs() instead
        return;
    }

    const log = createLogger({ component: "Solidity" });

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
