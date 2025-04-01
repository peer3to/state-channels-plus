import React, { useState, useEffect } from "react";
import Lobby from "./Lobby";
import Game from "./Game";
import TempSingleton from "../stateChannel/TempSingleton";
import Account from "./Account";
import BlogModalTutorial from "./blog/BlogModalTutorial";
import BlogModalExplanation from "./blog/BlogModalExplanation";

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

  const isValidGameId = (gameId: string): boolean => {
    return /^\d{6}$/.test(gameId);
  };
  //////////////////////
  const [isModalOpenTutorial, setIsModalOpenTutorial] = useState(false);
  const [isModalOpenExplanation, setIsModalOpenExplanation] = useState(false);

  const openModalTutorial = () => {
    setIsModalOpenTutorial(true);
  };

  const closeModalTutorial = () => {
    setIsModalOpenTutorial(false);
  };
  const openModalExplanation = () => {
    setIsModalOpenExplanation(true);
  };

  const closeModalExplanation = () => {
    setIsModalOpenExplanation(false);
  };
  /////////////////////
  return (
    <>
      <div className="game">
        {!gameStarted ? (
          <div
            style={{
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "100vh",
            }}
          >
            {!createdGame ? (
              //MAIN
              <div className="main-container">
                <div className="central-container">
                  <Account
                    address={address}
                    isLeft={true}
                    gameStarted={gameStarted}
                  />
                  <h1
                    style={{
                      color: "white",
                      marginTop: "-30px",
                      paddingBottom: "20px",
                    }}
                  >
                    Play
                  </h1>
                  <div className="input-button-container">
                    <input
                      type="text"
                      placeholder="Enter Game ID"
                      value={gameId}
                      onChange={(e) => setGameId(e.target.value)}
                      style={{
                        width: "50%",
                        height: "40px",
                        padding: "10px",
                        fontSize: "16px",
                        borderRadius: "8px 0 0 8px",
                        border: "none",
                        backgroundColor: "#0000003D",
                        color: "white",
                      }}
                    />
                    <button
                      onClick={handleJoinGame}
                      disabled={!isValidGameId(gameId)}
                      style={{
                        width: "20%",
                        height: "60px",
                        padding: "10px 10px",
                        fontSize: "16px",
                        borderRadius: "0 8px 8px 0",
                        border: "none",
                        backgroundColor: "#4e7cf4",
                        color: "white",
                        cursor: "pointer",
                      }}
                    >
                      Join Game
                    </button>
                  </div>
                  <div className="buttons-container">
                    <button onClick={handleCreateGame}>Create Game</button>
                  </div>
                </div>
                <div className="footer-container">
                  <div className="tutorial">
                    <button onClick={openModalTutorial}>How To Play</button>
                    <BlogModalTutorial
                      isOpen={isModalOpenTutorial}
                      onClose={closeModalTutorial}
                    />
                  </div>
                  <div className="explanation">
                    <button onClick={openModalExplanation}>Explanation</button>
                    <BlogModalExplanation
                      isOpen={isModalOpenExplanation}
                      onClose={closeModalExplanation}
                    />
                  </div>
                </div>
              </div>
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
    </>
  );
};

export default Main;
