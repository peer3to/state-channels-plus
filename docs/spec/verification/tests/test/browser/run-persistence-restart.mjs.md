# run-persistence-restart.mjs

Test file: [test/browser/run-persistence-restart.mjs](../../../../../../test/browser/run-persistence-restart.mjs)

## Overview

One Node test declaration drives the persistence page in Chromium. The page opens a `browser-level` (IndexedDB) partition, tries a second open while the first holds the Web Lock, writes through the production `Storage` with an explicit flush and with the timer, closes, and reopens with a different candidate secret, then reports which records and which signer secret came back. The declaration also fails on any page or console error.

## Tests

- `browser persistence partition recovers its signer and flushed records across reopen`: REQ-STOR-11-Q4AT07.T1.P4
