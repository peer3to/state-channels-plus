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
| [`parallel forge task discovery > includes a test contract declared in a .test.sol file`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L434) (line 434)                             | —      |
| [`parallel forge task discovery > skips harness contracts that declare no test function`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L450) (line 450)                             | —      |
| [`parallel forge task discovery > selects a contract that inherits its test functions from a same-file base`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L465) (line 465)         | —      |
| [`parallel forge task discovery > selects a concrete contract whose tests come from an imported abstract base`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L478) (line 478)       | —      |
| [`parallel forge task discovery > ignores a resolved import target that is a directory`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L500) (line 500)                              | —      |
| [`parallel forge task discovery > skips a contract inheriting only from a base without test functions`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L518) (line 518)               | —      |
| [`parallel forge task discovery > selects a contract whose only test function uses the statefulFuzz prefix`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L531) (line 531)          | —      |
| [`parallel forge task discovery > selects a contract whose invariant function has no underscore after the prefix`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L544) (line 544)    | —      |
| [`parallel forge task discovery > fails discovery when two files declare a test contract with the same name`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L557) (line 557)         | —      |
| [`parallel forge task discovery > explains that a duplicate contract name makes every task run both contracts`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L576) (line 576)       | —      |
| [`parallel forge task discovery > finds exactly the test contracts foundry itself lists for the repository`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L595) (line 595)          | —      |
| [`parallel forge task discovery > ignores contract declarations inside comments and string literals`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L604) (line 604)                 | —      |
| [`parallel forge task discovery > excludes vendored lib and build output directories`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L625) (line 625)                                | —      |
| [`parallel forge task discovery > applies --grep to the forge contract title`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L643) (line 643)                                        | —      |
| [`parallel forge task discovery > runs a forge task as a single anchored contract match`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L655) (line 655)                             | —      |
| [`parallel forge task discovery > invokes the forge tier through the hardhat forge-test task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L671) (line 671)                        | —      |
| [`parallel forge task discovery > pins every forge task to one thread by default`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L678) (line 678)                                    | —      |
| [`parallel forge task discovery > accepts an explicit forge thread count`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L688) (line 688)                                            | —      |
| [`parallel forge task discovery > rejects a forge thread count of zero because it means all logical cores`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L697) (line 697)           | —      |
| [`forge task runner > runs the configured forge binary with the selected contract and threads`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L705) (line 705)                       | —      |
| [`forge task runner > fails when the forge executable is missing`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L725) (line 725)                                                    | —      |
| [`forge task runner > passes a nonzero forge exit through as a runner failure`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L737) (line 737)                                       | —      |
| [`forge task runner > turns a forge signal exit into a runner failure`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L746) (line 746)                                               | —      |
| [`parallel task runner classification > resolves Hardhat from the caller project`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L757) (line 757)                                    | —      |
| [`parallel task runner classification > loads copied node infrastructure from the compiled package layout`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L781) (line 781)           | —      |
| [`parallel task runner classification > treats a task without a runner as a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L849) (line 849)                            | —      |
| [`parallel task runner classification > rejects an unknown runner instead of falling back to hardhat`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L853) (line 853)                | —      |
| [`parallel task runner classification > keeps forge tasks off the hardhat slot and account pools`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L859) (line 859)                    | —      |
| [`parallel task runner classification > marks discovered Mocha tasks as hardhat tasks`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L868) (line 868)                               | —      |
| [`parallel task runner classification > counts only the forge tasks in a mixed run`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L884) (line 884)                                  | —      |
| [`parallel task runner classification > counts a runnerless task as a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L893) (line 893)                                  | —      |
| [`parallel task runner wire protocol > carries the forge runner across the wire round trip`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L904) (line 904)                          | —      |
| [`parallel task runner wire protocol > stamps a runnerless task as hardhat on the wire`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L915) (line 915)                              | —      |
| [`parallel task runner wire protocol > reads a wire task without a runner as a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L932) (line 932)                         | —      |
| [`parallel task runner wire protocol > rejects a wire task whose runner was corrupted`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L949) (line 949)                               | —      |
| [`parallel forge tier selection > discovers both the Mocha and forge tiers by default`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L970) (line 970)                               | —      |
| [`parallel forge tier selection > drops the Mocha tier for --forge-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L981) (line 981)                                             | —      |
| [`parallel forge tier selection > drops the forge tier for --no-forge`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L991) (line 991)                                               | —      |
| [`parallel forge tier selection > drops the forge tier for --e2e-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1001) (line 1001)                                             | —      |
| [`parallel forge tier selection > rejects --forge-only together with --no-forge`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1011) (line 1011)                                   | —      |
| [`parallel forge tier selection > rejects --forge-only together with --e2e-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1017) (line 1017)                                   | —      |
| [`parallel forge tier selection > parses a forge thread override in both flag spellings`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1023) (line 1023)                           | —      |
| [`parallel forge tier selection > rejects a --forge-threads value of zero`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1033) (line 1033)                                         | —      |
| [`parallel forge tier selection > rejects partial, decimal, negative, missing, and nonnumeric forge thread values`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1039) (line 1039) | —      |
| [`parallel forge tier selection > applies the shared test pattern to both tiers`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1057) (line 1057)                                   | —      |
| [`parallel forge tier selection > parses independent Mocha and forge test patterns`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1064) (line 1064)                                | —      |
| [`parallel forge tier selection > keeps a shared filename pattern inside each tier's file boundary`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1076) (line 1076)                | —      |
| [`parallel forge tier selection > keeps tier-specific filename patterns independent`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1116) (line 1116)                               | —      |
| [`parallel forge tier selection > forces zero distributed slots for a forge-only entry`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1128) (line 1128)                            | —      |
| [`parallel forge tier selection > leaves distributed slots unset for Mocha-only entries`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1136) (line 1136)                           | —      |
| [`parallel forge tier selection > runs the distributed --no-forge entry without invoking Foundry`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1145) (line 1145)                  | —      |
| [`parallel forge tier selection > runs the distributed --e2e-only entry without invoking Foundry`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1159) (line 1159)                  | —      |
| [`parallel forge tier selection > runs the distributed --forge-only entry with zero slots`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1171) (line 1171)                         | —      |
| [`parallel forge tier guards > rejects an explicit Forge pattern with no runnable contracts`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1186) (line 1186)                       | —      |
| [`parallel forge tier guards > rejects an explicit Mocha pattern with no runnable declarations`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1203) (line 1203)                    | —      |
| [`parallel forge tier guards > rejects a tier-specific pattern when that tier is disabled`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1220) (line 1220)                         | —      |
| [`parallel forge tier guards > rejects a Mocha pattern combined with --forge-only`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1235) (line 1235)                                 | —      |
| [`parallel forge tier guards > allows grep to empty one matched tier when another tier still has work`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1250) (line 1250)             | —      |
| [`parallel forge tier guards > reports an all-zero post-grep selection`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1265) (line 1265)                                            | —      |
| [`parallel forge tier guards > fails a dry run when an explicit Forge file contains no runnable contract`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1280) (line 1280)          | —      |
| [`parallel forge tier guards > fails a dry run when a Forge pattern is combined with --no-forge`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1307) (line 1307)                   | —      |
| [`parallel forge tier guards > accepts a repository with only default Mocha tests`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1336) (line 1336)                                 | —      |
| [`parallel forge tier guards > accepts a repository with only default Forge tests`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1358) (line 1358)                                 | —      |
| [`parallel forge tier guards > reports an uncompilable --grep as an invalid RegExp`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1379) (line 1379)                                | —      |
| [`parallel forge tier guards > reports a forge discovery throw as a forge failure even when --grep is set`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1385) (line 1385)         | —      |
| [`parallel forge tier guards > reports a Mocha discovery throw as a Mocha failure`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1396) (line 1396)                                 | —      |
| [`parallel forge attempt reduction > reduces forge output to valid attempt metadata`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1408) (line 1408)                               | —      |
| [`parallel forge attempt reduction > reduces failing forge output to valid attempt metadata`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1420) (line 1420)                       | —      |
| [`parallel slot provisioning > provisions no slot for a run made only of forge tasks`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1429) (line 1429)                              | —      |
| [`parallel slot provisioning > provisions slots for a run that still holds a hardhat task`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1437) (line 1437)                         | —      |
| [`parallel slot provisioning > treats a task without a runner as needing a slot`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1445) (line 1445)                                   | —      |
| [`parallel slot provisioning > clamps the requested slot count to the account pool maximum`](../../../../../../test/scripts/e2eParallelForgeTasks.test.ts#L1449) (line 1449)                        | —      |
