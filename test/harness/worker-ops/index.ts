// step 1 - side-effect imports register every shipped worker-op into the
// current isolate's registry. orchestrator + worker entry both pull this in
// so InlinePeer.transition.submitNext + worker's TRANSITION_RUN_OP resolve
// the same op ids against the same table.

import "./math";
