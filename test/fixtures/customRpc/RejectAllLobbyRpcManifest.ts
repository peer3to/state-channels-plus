// @spec-test-coverage-ignore: Test-only manifest exercised by runtime-port and targeted E2E declarations.
import type P2PManager from "@/P2PManager";
import { LobbyMatchingService } from "@/rpc/services";
import { HarnessControlRpc } from "./harnessControl/HarnessControlRpc";

export class RejectAllLobbyRpc extends HarnessControlRpc {
    constructor(p2pManager: P2PManager<RejectAllLobbyRpc>) {
        super(p2pManager);
        this.lobbyMatchingService = new LobbyMatchingService(p2pManager, {
            shouldMatchPeer: () => false
        });
    }
}

export default RejectAllLobbyRpc;
