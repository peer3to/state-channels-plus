import { PrecompileInput } from "@ethereumjs/evm";
import { ethers } from "ethers";
import { Logger } from "@/utils";

/**
 * Hardhat's console.log contract address.
 * This is the well-known address that Hardhat's console.sol makes STATICCALLs to.
 *
 * https://github.com/NomicFoundation/hardhat/blob/52dc79ed1ded6c99f90874dfd4c9e9b82fce5c66/v-next/hardhat/console.sol#L5
 *
 * The address literal "0x000000000000000000636F6e736F6c652e6c6f67" encodes "console.log" in hex.
 */
export const CONSOLE_ADDRESS = "0x000000000000000000636F6e736F6c652e6c6f67";

const abiCoder = ethers.AbiCoder.defaultAbiCoder();

type PrecompileResult = {
    executionGasUsed: bigint;
    returnValue: Uint8Array;
};

const SUCCESS = {
    executionGasUsed: 0n,
    returnValue: new Uint8Array(0)
};

function selector(sig: string): string {
    return ethers.id(sig).slice(0, 10); // 0x + 8 hex chars
}

/**
 * Precomputed selectors for all supported console.log functions
 */
const CONSOLE_SELECTORS: Record<
    string,
    {
        types: string[];
        format: (args: any[]) => string;
    }
> = {
    // Single parameter functions
    [selector("log(string)")]: {
        types: ["string"],
        format: ([msg]) => String(msg)
    },
    [selector("log(bool)")]: {
        types: ["bool"],
        format: ([val]) => (val ? "true" : "false")
    },
    [selector("log(address)")]: {
        types: ["address"],
        format: ([addr]) => ethers.getAddress(addr)
    },
    [selector("log(uint256)")]: {
        types: ["uint256"],
        format: ([val]) => val.toString()
    },
    [selector("log(int256)")]: {
        types: ["int256"],
        format: ([val]) => val.toString()
    },
    [selector("logBytes32(bytes32)")]: {
        types: ["bytes32"],
        format: ([val]) => ethers.hexlify(val)
    },
    [selector("logBytes(bytes)")]: {
        types: ["bytes"],
        format: ([val]) => ethers.hexlify(val)
    },
    // Two parameter functions
    [selector("log(string,uint256)")]: {
        types: ["string", "uint256"],
        format: ([msg, val]) => `${msg} ${val.toString()}`
    },
    [selector("log(string,string)")]: {
        types: ["string", "string"],
        format: ([msg1, msg2]) => `${msg1} ${msg2}`
    },
    [selector("log(string,bool)")]: {
        types: ["string", "bool"],
        format: ([msg, val]) => `${msg} ${val ? "true" : "false"}`
    },
    [selector("log(string,address)")]: {
        types: ["string", "address"],
        format: ([msg, addr]) => `${msg} ${ethers.getAddress(addr)}`
    },
    [selector("log(uint256,string)")]: {
        types: ["uint256", "string"],
        format: ([val, msg]) => `${val.toString()} ${msg}`
    },
    [selector("log(bool,string)")]: {
        types: ["bool", "string"],
        format: ([val, msg]) => `${val ? "true" : "false"} ${msg}`
    },
    [selector("log(address,string)")]: {
        types: ["address", "string"],
        format: ([addr, msg]) => `${ethers.getAddress(addr)} ${msg}`
    },
    [selector("log(string,bytes32)")]: {
        types: ["string", "bytes32"],
        format: ([msg, val]) => `${msg} ${ethers.hexlify(val)}`
    },
    // Three parameter functions
    [selector("log(string,uint256,string)")]: {
        types: ["string", "uint256", "string"],
        format: ([msg1, val, msg2]) => `${msg1} ${val.toString()} ${msg2}`
    },
    [selector("log(string,address,uint256)")]: {
        types: ["string", "address", "uint256"],
        format: ([msg, addr, val]) =>
            `${msg} ${ethers.getAddress(addr)} ${val.toString()}`
    },
    // Four parameter functions
    [selector("log(string,uint256,string,uint256)")]: {
        types: ["string", "uint256", "string", "uint256"],
        format: ([msg1, val1, msg2, val2]) =>
            `${msg1} ${val1.toString()} ${msg2} ${val2.toString()}`
    },
    [selector("log(string,address,string,address)")]: {
        types: ["string", "address", "string", "address"],
        format: ([msg1, addr1, msg2, addr2]) =>
            `${msg1} ${ethers.getAddress(addr1)} ${msg2} ${ethers.getAddress(addr2)}`
    }
};

export function createConsolePrecompile(logger: Logger) {
    const solidityLogger = logger.child({ component: "Solidity" });
    /**
     * Precompile implementation for console.log functionality.
     *
     * This intercepts STATICCALLs to the console address and decodes the ABI-encoded
     * function calls, then logs them using PeerLogger. This allows console.log() to
     * work in view functions without state modification errors.
     *
     * @param input Precompile input containing the calldata
     * @returns ExecResult (always succeeds with 0 gas and empty return)
     */
    return async function consolePrecompile(
        input: PrecompileInput
    ): Promise<PrecompileResult> {
        const calldata = input.data;

        if (calldata.length < 4) {
            // Invalid call - return success anyway (like Hardhat does)
            return SUCCESS;
        }

        // Extract function selector (first 4 bytes)
        const selectorBytes = calldata.slice(0, 4);
        const selector = ethers.hexlify(selectorBytes);
        const data = calldata.slice(4);

        try {
            const handler = CONSOLE_SELECTORS[selector];
            if (handler) {
                // Decode ABI-encoded parameters
                const args = abiCoder.decode(
                    handler.types,
                    ethers.hexlify(data)
                );
                // Format and log the message
                const message = handler.format(args);
                solidityLogger.debug(message);
            }
        } catch {
            // If decoding fails, silently ignore
        }

        // Always return success with 0 gas
        return SUCCESS;
    };
}
