# WASM Precompile Example

This example demonstrates how to use a custom WASM-based precompile with the state channels SDK. While this example uses a simple calculator, you can use any WASM module as a precompile.

The calculator WASM used in this example is compiled from Rust code found at [peer3to/math-precompile-example](https://github.com/peer3to/math-precompile-example).

## How it Works

1. The WASM module is embedded into TypeScript code as a base64 string using `embed_wasm.js`. This allows the WASM to be distributed with your JavaScript package.

2. The precompile implementation (`calculator-precompile.ts`) shows how to:
   - Load and instantiate a WASM module
   - Handle memory management between EVM and WASM
   - Call WASM functions and handle their results

In this example:
- The calculator exports a `calculator` function, but your WASM can export any functions needed
- We use a memory offset of 1024 bytes since this example is small. For larger programs, you'll want to use higher offsets (like 0x10000 - start of second memory page of wasm VM) to avoid collisions with Rust's static memory area
- The TypeScript code is written to match the Rust WASM interface - you'll need to adjust this based on your WASM module's interface and memory model

## Setup

```bash
# Install dependencies
yarn install

# Build the project
yarn build
```

## Example Usage

See `src/index.ts` for a complete example of setting up P2P communication with a custom precompile.

## Building Your Own Precompile

1. Create your WASM module (can be compiled from Rust, C++, AssemblyScript, etc.)
2. Place it in `src/precompiles/` (alter the name as desired)
3. Update the precompile implementation to match your WASM module's interface
4. Build and use in your state channel application

## Notes

- The example uses a fixed gas cost for simplicity
- Memory management can be adjusted based on your WASM module's needs and source language
- Error handling should be added for production use 