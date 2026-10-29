# nodeGlobalsShim.test.ts

Test file: [test/evm/nodeGlobalsShim.test.ts](../../../../../../test/evm/nodeGlobalsShim.test.ts)
Exercises: [applyNodeGlobalsShim.ts](../../../../implementation/source/src/evm/p2pRuntime/worker/applyNodeGlobalsShim.ts.md)

## Overview

A unit suite for `applyNodeGlobalsShim`, called directly on plain scope objects (no worker
involved). The oracles inspect the mutated scope. The cases prove: an empty scope gains `global`
and a full `process` shim (`env`, a working `nextTick`, `browser: true`); a partial bundler
injected `process` is patched field-by-field without clobbering what exists — the regression this
file guards, where a whole-object `??=` left `nextTick` undefined and crashed the EVM stack; an
existing `nextTick` is never overwritten; a scope whose `process.versions.node` is set is not
misidentified as a browser; and the shimmed `nextTick` schedules its callback asynchronously with
arguments passed through. Worker startup wiring that applies the shim is out of scope.

## Tests

- `fills in a full process shim when none exists`: none
- `patches missing fields on a partial process without clobbering existing ones`: none
- `does not overwrite an existing nextTick`: none
- `does not identify a real Node process as a browser`: none
- `schedules the callback asynchronously via the shimmed nextTick`: none

This is partial component evidence for `REQ-RUNTIME-4-B0N70Y`; it does not claim worker placement coverage.
