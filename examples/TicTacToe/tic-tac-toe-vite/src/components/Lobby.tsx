import React, { useState } from "react";
import TempSingleton from "../stateChannel/TempSingleton";
import Account from "./Account";

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
        if (!opponentAddress) return;

        setOpeningChannel(true);

        try {
            await TempSingleton.p2pSigner?.p2pManager.localRpc.openChannelNegotiationService.beginNegotiation(
                opponentAddress
            );
        } catch (e) {
            console.error("beginNegotiation failed", e);
            setOpeningChannel(false);
        }
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
