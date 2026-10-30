# run-transport-local-e2e.mjs

Test file: [test/browser/run-transport-local-e2e.mjs](../../../../../../test/browser/run-transport-local-e2e.mjs)

## Overview

The runner behind package script `test:browser:transport:local` (shared driver
`transportPermutations.mjs`) starts a Hardhat node mining once a second, the local discovery relay hub (`localDiscoveryRelayHub.mjs`: membership sockets announce a topic's peers, link sockets pair two peers), a Vite dev
server, and headless Chromium. Each SDK runtime runs in its own browser context and page
(`RUN_SDK_IN_THREAD`, WebRTC on the page through the bridge) and authors a `MathStateMachine`
block on each of its turns. Two pages join one lobby topic at the same moment; the oracles are one
matched channel and both pages participating, only WebRTC connections from the upgrade grace end
until three agreement windows after participation, and at least three finalized blocks per page in
that window. The gate then closes the WebRTC connections of one page and requires a bootstrap
connection on both pages within one agreement window and three more finalized blocks per page.
Three new pages then select one channel with `connectToChannel` (no lobby): the genesis
participant before the on-chain opening, then the second participant and the observer together
after it, while both participants may still be syncing; the oracles are `true` from each connect, a connection between every
pair, three more finalized blocks per participant, and the observer at `SYNCED`. Two more pages,
each running its SDK inline on the page, then match through the lobby: one blacklists the other,
which leaves and joins the channel topic again so the hub announces it once more; the oracles are no
connection between the two pages and no hub link pair for them over a bounded window, then, after the
release, exactly one new hub link pair and one bootstrap connection on each page. Two last pages,
also inline, join one lobby topic while the hub holds every link socket's opening handshake; one
page disposes its runtime and the hub then lets the sockets open, so that page's link opens after
its runtime is gone; the oracle is a closed link at the hub and no error on the disposed page. Any
page error, console error, or relay error fails the run.

## Tests

- `package script test:browser:transport:local`: REQ-RUNTIME-3-VQXW59.T1.P83, REQ-UPG-4-M2XDBA.T1.P13, REQ-UPG-7-61PHDB.T1.P1, REQ-UPG-7-61PHDB.T1.P3, REQ-UPG-7-61PHDB.T1.P8, REQ-UPG-8-06HTCM.T1.P1
