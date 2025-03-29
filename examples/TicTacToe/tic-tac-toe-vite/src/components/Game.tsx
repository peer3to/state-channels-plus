import React, { useState, useEffect } from "react";
import Board from "./Board";
import TempSingleton from "../stateChannel/TempSingleton";
import Account from "./Account";
import { Clock } from "@peer3/state-channels-plus";

interface GameProps {
    gameStarted: boolean;
    myAddress: string;
    opponentAddress: string;
}

const Game: React.FC<GameProps> = ({
    gameStarted,
    myAddress,
    opponentAddress
}) => {
    const [squares, setSquares] = useState<Array<string | null>>(
        Array(9).fill(null)
    );
    const [isXNext, setIsXNext] = useState<boolean>(true);
    const [timer, setTimer] = useState<number>(5); // Timer for each player's turn
    const [timeRemaining, setTimeRemaining] = useState<Array<number>>([5, 5]);
    const [notificationText, setNotificationText] = useState<string>("");
    TempSingleton.setSquares = setSquares;
    TempSingleton.setIsXNext = setIsXNext;
    TempSingleton.setTimer = setTimer;
    TempSingleton.setTimeRemaining = setTimeRemaining;
    TempSingleton.setNotificationText = setNotificationText;

    useEffect(() => {
        let timerInterval: NodeJS.Timeout;
        if (gameStarted) {
            // Start the timer countdown when the game starts
            timerInterval = setInterval(() => {
                setTimer((prevTimer) => {
                    if (prevTimer <= 1) {
                        let x = timeRemaining.shift();
                        x && console.log("timeRemaining", timeRemaining);
                        !x && console.log("timeRemaining #", timeRemaining);
                        x && setTimeRemaining(timeRemaining);
                        return x ? x : 0;
                    }
                    return prevTimer - 1; // Decrement timer
                });
            }, 1000);
        }
        return () => clearInterval(timerInterval); // Cleanup on unmount
    }, [gameStarted, timeRemaining]); // Restart timer when game starts or turn changes

    const isMyTurn = (): boolean => {
        return (
            (isXNext && TempSingleton.isX) || (!isXNext && !TempSingleton.isX)
        );
    };
    const handleClick = (index: number) => {
        if (
            !gameStarted ||
            !isMyTurn() ||
            timeRemaining.length != 2 ||
            squares[index] ||
            calculateWinner(squares)
        )
            return;
        let row = Math.floor(index / 3);
        let col = index % 3;
        console.log("makeMove - ", row, col);
        TempSingleton.p2pContract?.makeMove(row, col);
        // const newSquares = squares.slice();
        // newSquares[index] = isXNext ? "X" : "O";
        // setSquares(newSquares);
        // setIsXNext(!isXNext);
        // setTimer(5); // Reset timer after a move
    };
    const updateBoard = (row: number, col: number, cell: number) => {
        console.log("updateBoard - ", row, col);
        const index = row * 3 + col;
        // const newSquares = squares.slice();
        squares[index] = cell == 1 ? "X" : "O";
        setSquares(squares);
        setIsXNext(!isXNext);
    };
    TempSingleton.updateBoard = updateBoard;

    const winner = calculateWinner(squares);
    const status = winner
        ? `Winner: ${winner}`
        : `Next player: ${isXNext ? "X" : "O"}`;
    const player = TempSingleton.isX ? "X" : "O";
    return (
        <>
            <Account address={myAddress} isLeft={true} gameStarted={true} />
            <Account address={opponentAddress} gameStarted={true} />
            <div className="board-container">
                <div className="game-info">
                    {notificationText ? (
                        <h4 className="notification-game">
                            {notificationText}
                        </h4>
                    ) : (
                        <>
                            <div className="player-info">
                                You are:
                                <div>&nbsp; {player}</div>
                            </div>
                            <div className="time-info">
                                {timeRemaining.length == 2 && (
                                    <>Time left: {timer} </>
                                )}
                                {timeRemaining.length == 1 &&
                                    (isMyTurn() ? (
                                        <>Forfeight</>
                                    ) : (
                                        <> Delay: {timer} </>
                                    ))}
                                {timeRemaining.length == 0 &&
                                    (isMyTurn() ? (
                                        <>Forfeight</>
                                    ) : (
                                        <> Fallback: {timer} </>
                                    ))}
                            </div>
                            <div className="status-info">
                                {!winner ? (
                                    <>
                                        Next:
                                        <p
                                            style={{
                                                color: isMyTurn()
                                                    ? "#4e7cf4"
                                                    : "#ffffff"
                                            }}
                                        >
                                            {" "}
                                            &nbsp; {isXNext ? "X" : "O"}
                                        </p>
                                    </>
                                ) : (
                                    <>
                                        Winner:
                                        <p
                                            style={{
                                                color: isMyTurn()
                                                    ? "#4e7cf4"
                                                    : "#ffffff"
                                            }}
                                        >
                                            {" "}
                                            &nbsp; {winner}
                                        </p>
                                    </>
                                )}
                            </div>
                        </>
                    )}

                    {/* I'm {player} <br /> {status} <br />
          {timeRemaining.length == 2 && <>Time left: {timer} seconds</>}
          {timeRemaining.length == 1 && <>Delay: {timer} seconds</>}
          {timeRemaining.length == 0 && <>On-chain fallback: {timer} seconds</>} */}
                </div>
                <Board
                    myPlayer={player}
                    squares={squares}
                    onClick={handleClick}
                    isMyTurn={isMyTurn() && timeRemaining.length == 2}
                />
                <div className="buttons-container">
                    {/* <button onClick={handleResetGame}>Reset Game</button> */}
                </div>
            </div>
        </>
    );
};

const calculateWinner = (squares: Array<string | null>): string | null => {
    const lines = [
        [0, 1, 2],
        [3, 4, 5],
        [6, 7, 8],
        [0, 3, 6],
        [1, 4, 7],
        [2, 5, 8],
        [0, 4, 8],
        [2, 4, 6]
    ];

    for (let i = 0; i < lines.length; i++) {
        const [a, b, c] = lines[i];
        if (
            squares[a] &&
            squares[a] === squares[b] &&
            squares[a] === squares[c]
        ) {
            return squares[a];
        }
    }
    return null;
};

export default Game;
