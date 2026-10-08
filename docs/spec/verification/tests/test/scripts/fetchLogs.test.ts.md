# fetchLogs.test.ts

Test file: [test/scripts/fetchLogs.test.ts](../../../../../../test/scripts/fetchLogs.test.ts)

## Overview

The suite runs the fetch tool's fetch and persist steps against the real crash-log server on a
temporary directory. It uploads a small chunk and a fat one, lowers the server's inflate ceiling so
the fat one is skipped from the merged read, and asserts the fetched result counts the skipped chunk
and that the persisted file says at its top that the read is incomplete; the control case with a
complete read writes no such marker.

## Tests

- `marks a persisted log the server read short`: REQ-LOG-7-M2RC5W.T1.P7
- `writes no marker for a read the server completed`: none
