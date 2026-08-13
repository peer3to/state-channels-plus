# test/evm/nodeGlobalsShim.test.ts — Test Report

> **Test file:** [test/evm/nodeGlobalsShim.test.ts](../../../../../../../test/evm/nodeGlobalsShim.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [nodeGlobalsShim.ts](../../../../implementation/source/src/evm/p2pRuntime/worker/nodeGlobalsShim.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A unit suite for `applyNodeGlobalsShim`, called directly on plain scope objects (no worker
involved). The oracles inspect the mutated scope. The cases prove: an empty scope gains `global`
and a full `process` shim (`env`, a working `nextTick`, `browser: true`); a partial bundler
injected `process` is patched field-by-field without clobbering what exists — the regression this
file guards, where a whole-object `??=` left `nextTick` undefined and crashed the EVM stack; an
existing `nextTick` is never overwritten; a scope whose `process.versions.node` is set is not
misidentified as a browser; and the shimmed `nextTick` schedules its callback asynchronously with
arguments passed through. Worker startup wiring that applies the shim is out of scope.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                             | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`applyNodeGlobalsShim > fills in a full process shim when none exists`](../../../../../../../test/evm/nodeGlobalsShim.test.ts#L17) (line 17)                                | —      |
| [`applyNodeGlobalsShim > patches missing fields on a partial process without clobbering existing ones`](../../../../../../../test/evm/nodeGlobalsShim.test.ts#L29) (line 29) | —      |
| [`applyNodeGlobalsShim > does not overwrite an existing nextTick`](../../../../../../../test/evm/nodeGlobalsShim.test.ts#L43) (line 43)                                      | —      |
| [`applyNodeGlobalsShim > does not identify a real Node process as a browser`](../../../../../../../test/evm/nodeGlobalsShim.test.ts#L52) (line 52)                           | —      |
| [`applyNodeGlobalsShim > schedules the callback asynchronously via the shimmed nextTick`](../../../../../../../test/evm/nodeGlobalsShim.test.ts#L62) (line 62)               | —      |
