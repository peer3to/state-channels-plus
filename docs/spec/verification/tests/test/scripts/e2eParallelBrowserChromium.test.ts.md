# e2eParallelBrowserChromium.test.ts

Test file: [test/scripts/e2eParallelBrowserChromium.test.ts](../../../../../../test/scripts/e2eParallelBrowserChromium.test.ts)

## Overview

Checks the runner Chromium probe environment. These runner mechanics do not establish protocol behavior.

## Tests

- `admits the gate once the browser typecheck passes`: none
- `stops the run before admitting any gate when the browser typecheck fails`: none
- `reaps a cancelled gate's Chromium and releases its port`: none
- `runs a following gate after one was cancelled`: none
- `checks the gates' Chromium before a run schedules them`: none
- `passes the Chromium pre-check when only the headless shell the gates launch is installed`: none
- `fails the Chromium pre-check when only the full Chromium is installed`: none
- `launches a real Chromium through the gates' own policy`: none
