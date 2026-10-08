# e2eParallelForgeTasks.test.ts — Test report

> **Test file:** [test/scripts/e2eParallelForgeTasks.test.ts](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Checks Forge task discovery against the configured contract test inventory. This runner check does not replace execution of the discovered contracts.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                    | Covers |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`parallel forge task discovery > does not invoke Foundry when parity artifacts are cold`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L343) (line 343)                            | —      |
| [`parallel forge task discovery > runs parity only when warm artifacts and Foundry are present`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L361) (line 361)                      | —      |
| [`parallel forge task discovery > skips parity when Solidity sources are newer than Forge artifacts`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L376) (line 376)                 | —      |
| [`parallel forge task discovery > discovers one task per Foundry test contract in the repository test tree`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L403) (line 403)          | —      |
| [`parallel forge task discovery > includes a test contract declared in a .test.sol file`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L436) (line 436)                             | —      |
| [`parallel forge task discovery > skips harness contracts that declare no test function`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L452) (line 452)                             | —      |
| [`parallel forge task discovery > selects a contract that inherits its test functions from a same-file base`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L467) (line 467)         | —      |
| [`parallel forge task discovery > selects a concrete contract whose tests come from an imported abstract base`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L480) (line 480)       | —      |
| [`parallel forge task discovery > ignores a resolved import target that is a directory`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L502) (line 502)                              | —      |
| [`parallel forge task discovery > skips a contract inheriting only from a base without test functions`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L520) (line 520)               | —      |
| [`parallel forge task discovery > selects a contract whose only test function uses the statefulFuzz prefix`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L533) (line 533)          | —      |
| [`parallel forge task discovery > selects a contract whose invariant function has no underscore after the prefix`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L546) (line 546)    | —      |
| [`parallel forge task discovery > fails discovery when two files declare a test contract with the same name`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L559) (line 559)         | —      |
| [`parallel forge task discovery > explains that a duplicate contract name makes every task run both contracts`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L578) (line 578)       | —      |
| [`parallel forge task discovery > finds exactly the test contracts foundry itself lists for the repository`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L597) (line 597)          | —      |
| [`parallel forge task discovery > ignores contract declarations inside comments and string literals`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L606) (line 606)                 | —      |
| [`parallel forge task discovery > excludes vendored lib and build output directories`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L627) (line 627)                                | —      |
| [`parallel forge task discovery > applies --grep to the forge contract title`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L645) (line 645)                                        | —      |
| [`parallel forge task discovery > runs a forge task as a single anchored contract match`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L658) (line 658)                             | —      |
| [`parallel forge task discovery > invokes the forge tier through the hardhat forge-test task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L674) (line 674)                        | —      |
| [`parallel forge task discovery > pins every forge task to one thread by default`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L681) (line 681)                                    | —      |
| [`parallel forge task discovery > accepts an explicit forge thread count`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L691) (line 691)                                            | —      |
| [`parallel forge task discovery > rejects a forge thread count of zero because it means all logical cores`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L700) (line 700)           | —      |
| [`forge task runner > runs the configured forge binary with the selected contract and threads`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L708) (line 708)                       | —      |
| [`forge task runner > fails when the forge executable is missing`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L728) (line 728)                                                    | —      |
| [`forge task runner > passes a nonzero forge exit through as a runner failure`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L740) (line 740)                                       | —      |
| [`forge task runner > turns a forge signal exit into a runner failure`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L749) (line 749)                                               | —      |
| [`parallel task runner classification > resolves Hardhat from the caller project`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L760) (line 760)                                    | —      |
| [`parallel task runner classification > loads copied node infrastructure from the compiled package layout`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L784) (line 784)           | —      |
| [`parallel task runner classification > treats a task without a runner as a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L852) (line 852)                            | —      |
| [`parallel task runner classification > rejects an unknown runner instead of falling back to hardhat`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L856) (line 856)                | —      |
| [`parallel task runner classification > keeps forge tasks off the hardhat slot and account pools`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L862) (line 862)                    | —      |
| [`parallel task runner classification > marks discovered Mocha tasks as hardhat tasks`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L871) (line 871)                               | —      |
| [`parallel task runner classification > counts only the forge tasks in a mixed run`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L887) (line 887)                                  | —      |
| [`parallel task runner classification > counts a runnerless task as a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L896) (line 896)                                  | —      |
| [`parallel task runner wire protocol > carries the forge runner across the wire round trip`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L907) (line 907)                          | —      |
| [`parallel task runner wire protocol > stamps a runnerless task as hardhat on the wire`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L918) (line 918)                              | —      |
| [`parallel task runner wire protocol > reads a wire task without a runner as a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L935) (line 935)                         | —      |
| [`parallel task runner wire protocol > rejects a wire task whose runner was corrupted`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L952) (line 952)                               | —      |
| [`parallel forge tier selection > discovers both the Mocha and forge tiers by default`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L973) (line 973)                               | —      |
| [`parallel forge tier selection > drops the Mocha tier for --forge-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L984) (line 984)                                             | —      |
| [`parallel forge tier selection > drops the forge tier for --no-forge`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L994) (line 994)                                               | —      |
| [`parallel forge tier selection > drops the forge tier for --e2e-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1004) (line 1004)                                             | —      |
| [`parallel forge tier selection > rejects --forge-only together with --no-forge`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1014) (line 1014)                                   | —      |
| [`parallel forge tier selection > rejects --forge-only together with --e2e-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1020) (line 1020)                                   | —      |
| [`parallel forge tier selection > parses a forge thread override in both flag spellings`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1026) (line 1026)                           | —      |
| [`parallel forge tier selection > rejects a --forge-threads value of zero`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1036) (line 1036)                                         | —      |
| [`parallel forge tier selection > rejects partial, decimal, negative, missing, and nonnumeric forge thread values`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1042) (line 1042) | —      |
| [`parallel forge tier selection > applies the shared test pattern to both tiers`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1060) (line 1060)                                   | —      |
| [`parallel forge tier selection > parses independent Mocha and forge test patterns`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1067) (line 1067)                                | —      |
| [`parallel forge tier selection > keeps a shared filename pattern inside each tier's file boundary`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1079) (line 1079)                | —      |
| [`parallel forge tier selection > keeps tier-specific filename patterns independent`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1119) (line 1119)                               | —      |
| [`parallel forge tier selection > forces zero distributed slots for a forge-only entry`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1131) (line 1131)                            | —      |
| [`parallel forge tier selection > leaves distributed slots unset for Mocha-only entries`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1139) (line 1139)                           | —      |
| [`parallel forge tier selection > runs the distributed --no-forge entry without invoking Foundry`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1148) (line 1148)                  | —      |
| [`parallel forge tier selection > runs the distributed --e2e-only entry without invoking Foundry`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1162) (line 1162)                  | —      |
| [`parallel forge tier selection > runs the distributed --forge-only entry with zero slots`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1174) (line 1174)                         | —      |
| [`parallel forge tier guards > rejects an explicit Forge pattern with no runnable contracts`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1189) (line 1189)                       | —      |
| [`parallel forge tier guards > rejects an explicit Mocha pattern with no runnable declarations`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1206) (line 1206)                    | —      |
| [`parallel forge tier guards > rejects a tier-specific pattern when that tier is disabled`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1223) (line 1223)                         | —      |
| [`parallel forge tier guards > rejects a Mocha pattern combined with --forge-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1238) (line 1238)                                 | —      |
| [`parallel forge tier guards > allows grep to empty one matched tier when another tier still has work`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1253) (line 1253)             | —      |
| [`parallel forge tier guards > reports an all-zero post-grep selection`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1268) (line 1268)                                            | —      |
| [`parallel forge tier guards > fails a dry run when an explicit Forge file contains no runnable contract`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1283) (line 1283)          | —      |
| [`parallel forge tier guards > fails a dry run when a Forge pattern is combined with --no-forge`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1310) (line 1310)                   | —      |
| [`parallel forge tier guards > accepts a repository with only default Mocha tests`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1339) (line 1339)                                 | —      |
| [`parallel forge tier guards > accepts a repository with only default Forge tests`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1361) (line 1361)                                 | —      |
| [`parallel forge tier guards > reports an uncompilable --grep as an invalid RegExp`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1382) (line 1382)                                | —      |
| [`parallel forge tier guards > reports a forge discovery throw as a forge failure even when --grep is set`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1388) (line 1388)         | —      |
| [`parallel forge tier guards > reports a Mocha discovery throw as a Mocha failure`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1399) (line 1399)                                 | —      |
| [`parallel forge attempt reduction > reduces forge output to valid attempt metadata`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1411) (line 1411)                               | —      |
| [`parallel forge attempt reduction > reduces failing forge output to valid attempt metadata`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1423) (line 1423)                       | —      |
| [`parallel slot provisioning > provisions no slot for a run made only of forge tasks`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1432) (line 1432)                              | —      |
| [`parallel slot provisioning > provisions slots for a run that still holds a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1440) (line 1440)                         | —      |
| [`parallel slot provisioning > treats a task without a runner as needing a slot`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1448) (line 1448)                                   | —      |
| [`parallel slot provisioning > clamps the requested slot count to the account pool maximum`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1452) (line 1452)                        | —      |
