# e2eParallelForgeTasks.test.ts

Test file: [test/scripts/e2eParallelForgeTasks.test.ts](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts)

## Overview

Checks Forge task discovery against the configured contract test inventory. This runner check does not replace execution of the discovered contracts.

## Tests

- `does not invoke Foundry when parity artifacts are cold`: none
- `runs parity only when warm artifacts and Foundry are present`: none
- `skips parity when Solidity sources are newer than Forge artifacts`: none
- `discovers one task per Foundry test contract in the repository test tree`: none
- `includes a test contract declared in a .test.sol file`: none
- `skips harness contracts that declare no test function`: none
- `selects a contract that inherits its test functions from a same-file base`: none
- `selects a concrete contract whose tests come from an imported abstract base`: none
- `ignores a resolved import target that is a directory`: none
- `skips a contract inheriting only from a base without test functions`: none
- `selects a contract whose only test function uses the statefulFuzz prefix`: none
- `selects a contract whose invariant function has no underscore after the prefix`: none
- `fails discovery when two files declare a test contract with the same name`: none
- `explains that a duplicate contract name makes every task run both contracts`: none
- `finds exactly the test contracts foundry itself lists for the repository`: none
- `ignores contract declarations inside comments and string literals`: none
- `excludes vendored lib and build output directories`: none
- `applies --grep to the forge contract title`: none
- `runs a forge task as a single anchored contract match`: none
- `invokes the forge tier through the hardhat forge-test task`: none
- `pins every forge task to one thread by default`: none
- `accepts an explicit forge thread count`: none
- `rejects a forge thread count of zero because it means all logical cores`: none
- `runs the configured forge binary with the selected contract and threads`: none
- `fails when the forge executable is missing`: none
- `passes a nonzero forge exit through as a runner failure`: none
- `turns a forge signal exit into a runner failure`: none
- `resolves Hardhat from the caller project`: none
- `loads copied node infrastructure from the compiled package layout`: none
- `treats a task without a runner as a hardhat task`: none
- `rejects an unknown runner instead of falling back to hardhat`: none
- `keeps forge tasks off the hardhat slot and account pools`: none
- `marks discovered Mocha tasks as hardhat tasks`: none
- `counts only the forge tasks in a mixed run`: none
- `counts a runnerless task as a hardhat task`: none
- `carries the forge runner across the wire round trip`: none
- `stamps a runnerless task as hardhat on the wire`: none
- `reads a wire task without a runner as a hardhat task`: none
- `rejects a wire task whose runner was corrupted`: none
- `discovers both the Mocha and forge tiers by default`: none
- `drops the Mocha tier for --forge-only`: none
- `drops the forge tier for --no-forge`: none
- `drops the forge tier for --e2e-only`: none
- `rejects --forge-only together with --no-forge`: none
- `rejects --forge-only together with --e2e-only`: none
- `parses a forge thread override in both flag spellings`: none
- `rejects a --forge-threads value of zero`: none
- `rejects partial, decimal, negative, missing, and nonnumeric forge thread values`: none
- `applies the shared test pattern to both tiers`: none
- `parses independent Mocha and forge test patterns`: none
- `keeps a shared filename pattern inside each tier's file boundary`: none
- `keeps tier-specific filename patterns independent`: none
- `forces zero distributed slots for a forge-only entry`: none
- `leaves distributed slots unset for Mocha-only entries`: none
- `runs the distributed --no-forge entry without invoking Foundry`: none
- `runs the distributed --e2e-only entry without invoking Foundry`: none
- `runs the distributed --forge-only entry with zero slots`: none
- `rejects an explicit Forge pattern with no runnable contracts`: none
- `rejects an explicit Mocha pattern with no runnable declarations`: none
- `rejects a tier-specific pattern when that tier is disabled`: none
- `rejects a Mocha pattern combined with --forge-only`: none
- `allows grep to empty one matched tier when another tier still has work`: none
- `reports an all-zero post-grep selection`: none
- `fails a dry run when an explicit Forge file contains no runnable contract`: none
- `fails a dry run when a Forge pattern is combined with --no-forge`: none
- `accepts a repository with only default Mocha tests`: none
- `accepts a repository with only default Forge tests`: none
- `reports an uncompilable --grep as an invalid RegExp`: none
- `reports a forge discovery throw as a forge failure even when --grep is set`: none
- `reports a Mocha discovery throw as a Mocha failure`: none
- `reduces forge output to valid attempt metadata`: none
- `reduces failing forge output to valid attempt metadata`: none
- `provisions no slot for a run made only of forge tasks`: none
- `provisions slots for a run that still holds a hardhat task`: none
- `treats a task without a runner as needing a slot`: none
- `clamps the requested slot count to the account pool maximum`: none
