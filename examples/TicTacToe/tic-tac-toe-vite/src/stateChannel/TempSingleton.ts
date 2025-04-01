import {
    JoinChannelStruct,
    Clock,
    P2pSigner,
    AStateChannelManagerProxy,
    EvmUtils,
    P2pEventHooks
} from "@peer3/state-channels-plus";
import { Signer } from "ethers";
import {
    getDltContracts,
    getRandomSigner,
    p2pSetup
} from "./TicTacToeStateChannel";
import { TicTacToeStateMachine } from "./typechain-types";
import { ethers, BigNumberish } from "ethers";
import { DisputeStruct } from "@peer3/state-channels-plus";
//Singleton just for demo!
class TempSingleton {
    private static instance: TempSingleton;
    joinChanel: JoinChannelStruct | undefined;
    signer: Signer = getRandomSigner();
    p2pContract: TicTacToeStateMachine | undefined;
    p2pSigner: P2pSigner | undefined;
    stateChannelManagerContract: AStateChannelManagerProxy | undefined;
    myBalance = 500;
    opponentBalance = 500;
    //game data
    isX: boolean = true;
    setGameStarted = (started: boolean) => {};
    setCreatedGame = (created: boolean) => {};
    setGameId = (gameId: string) => {};
    setOpponentAddress = (address: string) => {};
    updateBoard = (row: number, col: number, cell: number) => {};
    setSquares = (squares: Array<string | null>) => {};
    setIsXNext = (isXNext: boolean) => {};
    setTimer = (timer: number) => {};
    setTimeRemaining = (timeRemaining: number[]) => {};
    setNotificationText = (text: string) => {};
    generateColor = (seed: string): string => {
        return "";
    };
    p2pDispose = async () => {};

    getMyBalance = (): number => {
        return this.myBalance;
    };
    setMyBalance = (balance: number) => {};
    getOpponentBalance = (): number => {
        return this.opponentBalance;
    };
    setOpponentBalance = (balance: number) => {};
    private constructor() {
        // Private constructor to prevent instantiation from outside
    }

    public static getInstance(): TempSingleton {
        if (!TempSingleton.instance) {
            TempSingleton.instance = new TempSingleton();
        }
        return TempSingleton.instance;
    }

    public async setJoinChannel(channelId: string) {
        await Clock.init(this.signer.provider!);
        console.log("Clock seconds:", Clock.getTimeInSeconds());
        console.log("Signer address:", await this.signer.getAddress());
        let encodedChannelId = ethers.AbiCoder.defaultAbiCoder().encode(
            ["string"],
            [channelId]
        );
        console.log("encodedChannelId:", encodedChannelId);
        let channelIdHash = ethers.keccak256(encodedChannelId);
        console.log("channelIdHash:", channelIdHash);
        console.log("My Balance:", this.getMyBalance());
        this.joinChanel = {
            channelId: channelIdHash,
            participant: await this.signer.getAddress(),
            amount: this.getMyBalance(),
            deadlineTimestamp: Clock.getTimeInSeconds() + 120,
            data: "0x00"
        };
        let signedJoinChannel = await EvmUtils.signJoinChannel(
            this.joinChanel,
            this.signer
        );

        let contracts = await getDltContracts(this.signer);
        let p2p = await p2pSetup(
            contracts.TicTacToeStateChannelManagerInstance,
            contracts.TicTacToeSmInstance,
            {
                onConnection: async (address) => {
                    //TODO! This is only for tests - currently
                    console.log("onConnection");
                    this.setOpponentAddress(address);
                },
                onTurn: async (address: string) => {
                    let timeConfig =
                        p2p.p2pSigner.p2pManager.stateManager.timeConfig;
                    this.setTimer(timeConfig.p2pTime);
                    this.setTimeRemaining([
                        timeConfig.agreementTime,
                        timeConfig.chainFallbackTime
                    ]);
                },
                onInitiatingDispute: async () => {
                    this.setNotificationText("Initiating Dispute on-chain!");
                },
                onPostingCalldata: async () => {
                    this.setNotificationText(
                        "Opponent did NOT cooperate - Posting Calldata on-chain!"
                    );
                },
                onPostedCalldata: async () => {
                    this.setNotificationText("Calldata posted on-chain!");
                    console.log("onPostedCalldata - start");
                    let timeConfig =
                        p2p.p2pSigner.p2pManager.stateManager.timeConfig;
                    this.setTimer(timeConfig.p2pTime);
                    this.setTimeRemaining([
                        timeConfig.agreementTime,
                        timeConfig.chainFallbackTime
                    ]);
                    setTimeout(() => {
                        this.setNotificationText("");
                    }, 2000);
                    console.log("onPostedCalldata - end");
                },
                onSetState: async () => {
                    console.log("onSetState");
                    let participants =
                        await p2p.p2pContractInstance.getParticipants();
                    await this.updateBalances();
                    this.setSquares(Array(9).fill(null));
                    if (participants.length < 2) {
                        await this.finishGame();
                        return;
                    }
                    let firstPlayer =
                        await p2p.p2pContractInstance.getNextToWrite();
                    this.isX = firstPlayer === (await this.signer.getAddress());
                    this.setGameStarted(true);
                    this.setNotificationText("");
                    let timeConfig =
                        p2p.p2pSigner.p2pManager.stateManager.timeConfig;
                    this.setTimer(timeConfig.p2pTime);
                    this.setTimeRemaining([
                        timeConfig.agreementTime,
                        timeConfig.chainFallbackTime
                    ]);
                },
                onDisputeUpdate: async (dispute: DisputeStruct) => {
                    console.log("onDisputeUpdate", dispute);
                    for (let i = 0; i < dispute.processExits.length; i++) {
                        let processExit = dispute.processExits[i];
                        let participant = processExit.participant;
                        let amount = processExit.amount;
                        if (participant === this.p2pSigner?.signerAddress) {
                            this.myBalance = Number(amount);
                            console.log(
                                "Removed Participant My Balance",
                                this.myBalance
                            );
                            console.trace("Removed Participant My Balance");
                            this.setMyBalance(this.myBalance);
                            //!!!! Can NOT !!! set opponent's balance (from local state) since this executed on-chain
                        } else {
                            this.opponentBalance = Number(amount);
                            console.log(
                                "Removed Participant Opponent Balance",
                                this.opponentBalance
                            );
                            console.trace(
                                "Removed Participant Opponent Balance"
                            );
                            this.setOpponentBalance(this.opponentBalance);
                            //!!!! Can NOT !!! set my balance (fron local state) since this executed on-chain
                        }
                    }
                }
            }
        );
        this.p2pDispose = async () => {
            await p2p.dispose();
        };
        this.stateChannelManagerContract =
            contracts.TicTacToeStateChannelManagerInstance;
        this.p2pContract = p2p.p2pContractInstance;
        this.p2pSigner = p2p.p2pSigner;
        this.p2pSigner.setJc(this.joinChanel, signedJoinChannel);
        this.p2pSigner.connectToChannel(channelIdHash);

        this.p2pContract.on(
            this.p2pContract.filters.MoveMade,
            (
                address: string,
                row: BigNumberish,
                col: BigNumberish,
                cell: BigNumberish
            ) => {
                console.log("moveMade EVENT", row, col);
                this.updateBoard(Number(row), Number(col), Number(cell));
                let timeConfig =
                    p2p.p2pSigner.p2pManager.stateManager.timeConfig;
                this.setTimer(timeConfig.p2pTime);
                this.setTimeRemaining([
                    timeConfig.agreementTime,
                    timeConfig.chainFallbackTime
                ]);
            }
        );
        this.p2pContract.on(
            this.p2pContract.filters.GameOver,
            (winnerCell: BigNumberish) => {
                //reset game
                setTimeout(async () => {
                    let firstPlayer =
                        await p2p.p2pContractInstance.getNextToWrite();
                    this.isX = firstPlayer === (await this.signer.getAddress());
                    await this.updateBalances();
                    console.log("Game Over EVENT is X", this.isX);
                    this.setSquares(Array(9).fill(null));
                    this.setIsXNext(true);
                    let timeConfig =
                        p2p.p2pSigner.p2pManager.stateManager.timeConfig;
                    this.setTimer(timeConfig.p2pTime);
                    this.setTimeRemaining([
                        timeConfig.agreementTime,
                        timeConfig.chainFallbackTime
                    ]);
                }, 2000);
            }
        );
        // this.p2pContract.on(
        //   this.p2pContract.filters.RemovedParticipant,
        //   async (participant: string, amount: BigNumberish) => {
        //     //Special case for update balances
        //     if (participant === this.p2pSigner?.signerAddress) {
        //       this.myBalance = Number(amount);
        //       console.log("Removed Participant My Balance", this.myBalance);
        //       console.trace("Removed Participant My Balance");
        //       this.setMyBalance(this.myBalance);
        //       //!!!! Can NOT !!! set opponent's balance (from local state) since this executed on-chain
        //     } else {
        //       this.opponentBalance = Number(amount);
        //       console.log(
        //         "Removed Participant Opponent Balance",
        //         this.opponentBalance
        //       );
        //       console.trace("Removed Participant Opponent Balance");
        //       this.setOpponentBalance(this.opponentBalance);
        //       //!!!! Can NOT !!! set my balance (fron local state) since this executed on-chain
        //     }
        //   }
        // );
    }
    public getJoinChannel() {
        return this.joinChanel;
    }

    private async updateBalances() {
        let participants = await this.p2pContract!.getParticipants();
        let shouldTerminate = false;
        for (let i = 0; i < participants.length; i++) {
            if (participants[i] === this.p2pSigner!.signerAddress) {
                this.myBalance = Number(
                    await this.p2pContract!.getBalance(participants[i])
                );
                console.log("Update My Balance", this.myBalance);
                this.setMyBalance(this.myBalance);
                if (this.myBalance === 0) shouldTerminate = true;
            } else {
                this.opponentBalance = Number(
                    await this.p2pContract!.getBalance(participants[i])
                );
                console.log("Update Opponent Balance", this.opponentBalance);
                this.setOpponentBalance(this.opponentBalance);
                if (this.opponentBalance === 0) shouldTerminate = true;
            }
        }
        if (shouldTerminate) await this.finishGame();
    }

    private async finishGame() {
        await this.p2pDispose();
        this.setGameStarted(false);
        this.setOpponentAddress("");
        this.setCreatedGame(false);
        this.setGameId("");
    }
}

function deleteObjectAndLinks(obj: any) {
    for (let key in obj) {
        if (typeof obj[key] === "object" && obj[key] !== null) {
            deleteObjectAndLinks(obj[key]);
        }
        delete obj[key];
    }
}
export default TempSingleton.getInstance();
