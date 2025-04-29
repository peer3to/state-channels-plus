import { SignatureLike } from "ethers";
import { ARpcService, MainRpcService } from "@/rpc";
import { SignedJoinChannelStruct } from "@typechain-types/contracts/V1/DataTypes";
import { EvmUtils, SignatureCollectionMap } from "@/utils";
import Clock from "@/Clock";

type JoinChanenelConfirmation = {
    signedJoinChannel: SignedJoinChannelStruct;
    confirmationSignatures: SignatureLike[];
};

class JoinChannelService extends ARpcService {
    // **** part of joinChannel logic ****
    joinChannelMap = new SignatureCollectionMap();
    joinChannelQueue: JoinChanenelConfirmation[] = [];

    constructor(mainRpcService: MainRpcService) {
        super(mainRpcService);
    }
    public async onJoinChannelRequest(
        signedJoinChannel: SignedJoinChannelStruct,
        confirmationSignature?: SignatureLike
    ) {
        //TODO! - require seccusfull init handshake
        try {
            let key = signedJoinChannel.encodedJoinChannel.toString(); //shouldn't leave a big memory footprint since it will be pruned
            let jc = EvmUtils.decodeJoinChannel(
                signedJoinChannel.encodedJoinChannel
            );
            if (!this.joinChannelMap.has(key)) {
                let timeRemaining =
                    Number(jc.deadlineTimestamp) - Clock.getTimeInSeconds();
                if (timeRemaining <= 0) return;
                let retrivedAddress = EvmUtils.retrieveSignerAddressJoinChannel(
                    jc,
                    signedJoinChannel.signature as SignatureLike
                );
                if (jc.participant != retrivedAddress) return; //TODO! Disconnect from peer
                //TODO! - analyzie retrivedAddress and apply subjectivivity to decide if to proceed or not
                //TODO! StateObserver can be triggered for this subjectivity too
                let mySignedJC = await EvmUtils.signJoinChannel(
                    jc,
                    this.mainRpcService.p2pManager.p2pSigner
                );
                this.joinChannelMap.tryInsert(key, {
                    signerAddress: jc.participant.toString(),
                    signature: mySignedJC.signature as SignatureLike
                });
                this.mainRpcService.rpcProxy
                    .onJoinChannelRequest(
                        signedJoinChannel,
                        mySignedJC.signature as SignatureLike
                    )
                    .broadcast();
                setTimeout(() => {
                    this.joinChannelMap.delete(key); // prune expired
                }, timeRemaining * 1000);
                return;
            }
            //confirmation logic
            if (!confirmationSignature) return;
            let retrivedAddress = EvmUtils.retrieveSignerAddressJoinChannel(
                jc,
                confirmationSignature
            );
            let currentParticipants =
                await this.mainRpcService.p2pManager.stateManager.getParticipantsCurrent();
            if (!currentParticipants.includes(retrivedAddress)) return;
            this.joinChannelMap.tryInsert(key, {
                signerAddress: retrivedAddress,
                signature: confirmationSignature
            });

            if (!this.joinChannelMap.didEveryoneSign(key, currentParticipants))
                return;
            this.joinChannelQueue.push({
                signedJoinChannel,
                confirmationSignatures: this.joinChannelMap
                    .get(key)
                    .map((x) => x.signature)
            }); //TODO! only pick signatures of current participants
        } catch (e) {
            console.log(e);
            return;
        }
    }
}

export default JoinChannelService;
