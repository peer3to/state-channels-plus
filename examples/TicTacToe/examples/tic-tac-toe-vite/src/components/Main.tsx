import React, { useState, useEffect } from "react";
import Lobby from "./Lobby";
import Game from "./Game";
import TempSingleton from "../stateChannel/TempSingleton";
import Account from "./Account";

const Main: React.FC = () => {
  const [gameStarted, setGameStarted] = useState<boolean>(false); // Track if the game has started
  const [gameId, setGameId] = useState<string>(""); // Game ID
  const [createdGame, setCreatedGame] = useState<boolean>(false); // Track if the game is created
  const [address, setAddress] = useState<string>("");
  const [opponentAddress, setOpponentAddress] = useState<string>("");
  TempSingleton.setGameStarted = setGameStarted;
  TempSingleton.setCreatedGame = setCreatedGame;
  TempSingleton.setGameId = setGameId;
  TempSingleton.setOpponentAddress = setOpponentAddress;

  useEffect(() => {
    const init = async () => {
      let adr = await TempSingleton.signer.getAddress();
      setAddress(adr);
    };
    init();
  }, []);

  const generateGameId = (): string => {
    return Math.floor(100000 + Math.random() * 900000).toString(); // Generate a 6-digit random number
  };

  const handleCreateGame = () => {
    let channelId = generateGameId();
    TempSingleton.setJoinChannel(channelId);
    setGameId(channelId);
    setCreatedGame(true); // Mark game as created
  };

  const handleJoinGame = () => {
    if (gameId.trim() !== "") {
      TempSingleton.setJoinChannel(gameId);
      setGameId(gameId);
      setCreatedGame(true); // Mark game as created
      // if (players.length === 1) {
      //   setGameStarted(true); // Start the game when two players have joined
      // }
    }
  };
  return (
    <div className="game">
      {!gameStarted ? (
        <div>
          {!createdGame ? (
            //MAIN
            <>
              <Account address={address} isLeft={true} />
              <input
                type="text"
                placeholder="Enter Game ID"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
              />
              <div className="buttons-container">
                <button onClick={handleCreateGame}>Create Game</button>
                <button onClick={handleJoinGame}>Join Game</button>
              </div>
            </>
          ) : (
            //LOBBY
            <>
              <Lobby
                gameId={gameId}
                myAddress={address}
                opponentAddress={opponentAddress}
              />
            </>
          )}
        </div>
      ) : (
        <>
          <Game
            gameStarted={gameStarted}
            myAddress={address}
            opponentAddress={opponentAddress}
          />
        </>
      )}
    </div>
  );
};

export default Main;
