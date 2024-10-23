import React, { useState, useEffect } from "react";
import Board from "./Board";
import TempSingleton from "../stateChannel/TempSingleton";
import Account from "./Account";
import { EvmUtils } from "@peer3/state-channel-plus";

interface LobbyProps {
  gameId: string;
  myAddress: string;
  opponentAddress: string;
}

const Lobby: React.FC<LobbyProps> = ({
  gameId,
  myAddress,
  opponentAddress,
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
    <div>
      {openingChannel && (
        <h2 style={{ fontWeight: "bold", color: "gray" }}>
          Opening channel on-chain!
        </h2>
      )}
      <h2>Lobby</h2>
      <h3>Game ID: {gameId}</h3>
      <Account address={myAddress} isLeft={true} />
      {opponentAddress && <Account address={opponentAddress} />}
      <p>Players Joined: {opponentAddress == "" ? 1 : 2} / 2</p>
      <div className="buttons-container">
        <button onClick={handleLeaveGame}>Leave</button>
        {opponentAddress && <button onClick={handleStartGame}>Start</button>}
      </div>
    </div>
  );
};

export default Lobby;
