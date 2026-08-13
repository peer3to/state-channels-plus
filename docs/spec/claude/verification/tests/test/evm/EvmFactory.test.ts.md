# test/evm/EvmFactory.test.ts — Test Report

> **Test file:** [test/evm/EvmFactory.test.ts](../../../../../../../test/evm/EvmFactory.test.ts) > **Status:** Authored — engineer verification pending.
> **Exercises:** [EvmFactory.ts](../../../../implementation/source/src/evm/EvmFactory.ts.md)

## Contents

- [Overview](#overview)
- [Tests and covered test IDs](#tests-and-covered-test-ids)

## Overview

A single regression case for `createEvm`: registering a caller-supplied custom precompile must
not disable the built-in console precompile. The test builds an EVM through the public factory
with one custom precompile and a record-only logger, then issues two `runCall`s directly. The
oracles assert the custom precompile executes at its address exactly once and returns the
ABI-encoded value unchanged, and that a subsequent `log(string)` call to `CONSOLE_ADDRESS` still
reaches the console precompile (the logger's `debug` spy receives the decoded message) with no
exception on either call. Hardfork selection, jumpdest caching, and executor wrappers are out of
scope — this file pins only the precompile-composition behavior of the factory.

## Tests and covered test IDs

A row lists only test IDs this test covers **in full** — partial credit is never recorded. Each
test ID may be assigned to at most one test across the whole tree; static analysis reports
duplicate assignments, and tests with no assigned ID are listed in the verification-coverage
report but are kept here.

| Test declaration                                                                                                                                                     | Covers |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`EvmFactory > should execute custom precompiles without disabling the built-in console precompile`](../../../../../../../test/evm/EvmFactory.test.ts#L27) (line 27) | —      |
