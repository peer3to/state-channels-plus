import React, { useState, useEffect } from "react";
import Board from "./Board";
import TempSingleton from "../stateChannel/TempSingleton";
import Account from "./Account";
import { EvmUtils } from "@peer3/state-channels-plus";

interface LobbyProps {
    gameId: string;
    myAddress: string;
    opponentAddress: string;
}

const Lobby: React.FC<LobbyProps> = ({
    gameId,
    myAddress,
    opponentAddress
}) => {
    const [openingChannel, setOpeningChannel] = useState<boolean>(false); // Track if the game has started

    const handleStartGame = async () => {
        let jc = TempSingleton.getJoinChannel();
        let signedJoinChannel = await EvmUtils.signJoinChannel(
            jc!,
            TempSingleton.signer
        );
        TempSingleton.p2pSigner?.p2pManager.rpcProxy
            .onSignJoinChannelTEST(
                signedJoinChannel.encodedJoinChannel as string,
                signedJoinChannel.signature as string
            )
            .broadcast();
        setOpeningChannel(true);
    };
    const handleLeaveGame = async () => {
        TempSingleton.p2pDispose();
        TempSingleton.setGameStarted(false);
        TempSingleton.setOpponentAddress("");
        TempSingleton.setCreatedGame(false);
        TempSingleton.setGameId("");
    };
    return (
        <>
            <Account address={myAddress} isLeft={true} gameStarted={false} />
            {opponentAddress && (
                <Account address={opponentAddress} gameStarted={false} />
            )}
            <div
                className="central-container"
                style={{
                    position: "relative"
                }}
            >
                {openingChannel && (
                    <h2 className="notification-loby">
                        Opening channel on-chain!
                    </h2>
                )}
                <h1
                    style={{
                        color: "white",
                        marginTop: "-30px",
                        paddingBottom: "30px"
                    }}
                >
                    Lobby
                </h1>
                <h3 style={{ color: "white" }}>
                    Game ID: <span style={{ color: "#4e7cf4" }}>{gameId}</span>
                </h3>
                <p style={{ color: "white" }}>
                    Players Joined: {opponentAddress == "" ? 1 : 2} / 2
                </p>
                <div className="buttons-container">
                    <button onClick={handleLeaveGame}>Leave</button>
                    {opponentAddress && (
                        <button onClick={handleStartGame}>Start</button>
                    )}
                </div>
            </div>
        </>
    );
};

export default Lobby;
