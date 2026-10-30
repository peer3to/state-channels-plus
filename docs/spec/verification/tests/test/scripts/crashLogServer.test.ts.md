# crashLogServer.test.ts

Test file: [test/scripts/crashLogServer.test.ts](../../../../../../test/scripts/crashLogServer.test.ts)

## Overview

The suite exercises the crash-log receiver script: its path-segment sanitizer, its upload body
validation, and the POST and GET routes end to end on a real listening app with a temporary log
directory. Route oracles are HTTP statuses and the decoded merged read. It covers a chunk stored and
read back; two stores with the same sequence range kept apart; eight concurrent uploads for one
channel landing in one directory; a merged read that runs out of inflate budget dropping the oldest
run and announcing the drop on a header; the index listing; and, with a token configured, a send
with no token or the wrong one refused and not stored while a later valid send is accepted.

## Tests

- `leaves legitimate hex ids / addresses unchanged`: none
- `replaces every disallowed character with _`: none
- `keeps a sanitized segment contained under LOG_DIR`: none
- `keeps a sanitized thread segment under LOG_DIR`: none
- `accepts a well-formed chunk upload`: none
- `rejects a non-integer sequence range`: none
- `rejects an upload with no store id`: none
- `rejects a chunk whose entry count disagrees with its range`: none
- `rejects a body with no thread name`: none
- `stores an uploaded chunk and reads it back merged`: none
- `keeps two stores with the same sequence range apart`: REQ-LOG-6-Q8KY4N.T1.P4
- `keeps concurrent uploads for one channel in a single directory`: REQ-LOG-5-ST6S0G.T1.P4
- `keeps the newest store when a merged read runs out of budget`: REQ-LOG-7-M2RC5W.T1.P2
- `lists stored chunks in the index`: none
- `refuses an upload with no token`: REQ-LOG-7-M2RC5W.T1.P4
- `refuses an upload with the wrong token`: REQ-LOG-7-M2RC5W.T1.P5
- `stores an upload with the configured token`: none
- `stores a valid upload after a refused one`: REQ-LOG-7-M2RC5W.T1.P6
