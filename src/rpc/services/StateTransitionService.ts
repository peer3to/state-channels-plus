import { BytesLike } from "ethers";
import { SignedBlockStruct } from "@typechain-types/contracts/V1/DataTypes";
import { ExecutionFlags } from "@/types";
import { ARpcService, MainRpcService } from "@/rpc";

class StateTransitionService extends ARpcService {
    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }

    public async onSignedBlock(signedBlock: SignedBlockStruct) {
        //TODO! - require seccusfull init handshake (also on other methods)
        let flag =
            await this.mainRpcService.p2pManager.stateManager.onSignedBlock(
                signedBlock
            );
        if (
            flag == ExecutionFlags.DISCONNECT ||
            flag == ExecutionFlags.DISPUTE
        ) {
            //TODO - disconnect from peer
            return;
        }
        if (flag == ExecutionFlags.SUCCESS)
            this.mainRpcService.rpcProxy.onSignedBlock(signedBlock).broadcast(); //TODO? - broadcast dispute so others can learn about it
    }

    public async onBlockConfirmation(
        originalSignedBlock: SignedBlockStruct,
        confirmationSignature: BytesLike
    ) {
        let flag =
            await this.mainRpcService.p2pManager.stateManager.onBlockConfirmation(
                originalSignedBlock,
                confirmationSignature
            );
        if (
            flag == ExecutionFlags.DISCONNECT ||
            flag == ExecutionFlags.DISPUTE
        ) {
            //TODO - disconnect from peer
            return;
        }
        if (flag == ExecutionFlags.SUCCESS)
            this.mainRpcService.rpcProxy
                .onBlockConfirmation(originalSignedBlock, confirmationSignature)
                .broadcast();
    }
}

export default StateTransitionService;
