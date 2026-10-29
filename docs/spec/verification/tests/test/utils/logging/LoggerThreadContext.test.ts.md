# LoggerThreadContext.test.ts

Test file: [test/utils/logging/LoggerThreadContext.test.ts](../../../../../../../test/utils/logging/LoggerThreadContext.test.ts)
Exercises: [Logger.ts](../../../../../implementation/source/src/utils/logging/Logger.ts.md)

## Overview

The suite creates real loggers through the public factory and the uploader fixture against a real
receiver. It asserts the default thread name, and that lines written before the channel was known are
filed under it once it is: both when an earlier upload already stored them under the placeholder
(the watermark starts over, so the second body begins at sequence zero again) and when they were
still buffered.

## Tests

- `defaults the thread name to main`: UNIT-TEST-LOGGER-1-4MNRMD.P1
- `re-uploads earlier entries under the channel set later`: REQ-LOG-4-W5XR7Q.T1.P3
- `uploads buffered entries under the channel set later`: none
- `reparents children to the surviving grandparent on disposal`: UNIT-TEST-LOGGER-1-4MNRMD.P5, REQ-LOG-1-H2VQ8X.T2.P1
- `keeps one shared store registered after its parent logger is disposed`: UNIT-TEST-LOGGER-1-4MNRMD.P6, UNIT-TEST-LOGGER-1-4MNRMD.P2, REQ-LOG-1-H2VQ8X.T2.P2
- `releases shared crash listeners only after the last logger is disposed`: UNIT-TEST-LOGGER-1-4MNRMD.P7, REQ-LOG-1-H2VQ8X.T2.P3
- `cascades through grandchildren reparented by an earlier disposal`: UNIT-TEST-LOGGER-1-4MNRMD.P8
- `throws on every log level and replay after disposal even when filtered`: UNIT-TEST-LOGGER-1-4MNRMD.P10, REQ-LOG-1-H2VQ8X.T2.P5
