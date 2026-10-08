# e2eParallelBrowserChromium.test.ts — Test report

> **Test file:** [test/scripts/e2eParallelBrowserChromium.test.ts](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts) > **Status:** Authored; engineer verification pending.

## Overview

Checks the runner Chromium probe environment. These runner mechanics do not establish protocol behavior.

## Tests and covered test IDs

| Test declaration                                                                                                                                                                                           | Covers |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| [`browser typecheck boundary > admits the gate once the browser typecheck passes`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L48) (line 48)                                        | —      |
| [`browser typecheck boundary > stops the run before admitting any gate when the browser typecheck fails`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L53) (line 53)                 | —      |
| [`browser task cancellation > reaps a cancelled gate's Chromium and releases its port`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L64) (line 64)                                   | —      |
| [`browser task cancellation > runs a following gate after one was cancelled`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L90) (line 90)                                             | —      |
| [`browser tier environment > checks the gates' Chromium before a run schedules them`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L119) (line 119)                                   | —      |
| [`browser tier environment > passes the Chromium pre-check when only the headless shell the gates launch is installed`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L126) (line 126) | —      |
| [`browser tier environment > fails the Chromium pre-check when only the full Chromium is installed`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L132) (line 132)                    | —      |
| [`browser tier environment > launches a real Chromium through the gates' own policy`](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts#L139) (line 139)                                   | —      |
