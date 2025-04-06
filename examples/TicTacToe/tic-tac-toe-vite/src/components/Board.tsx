import React from "react";
import Square from "./Square";

interface BoardProps {
    myPlayer: string; // X or O
    squares: Array<string | null>;
    onClick: (index: number) => void;
    isMyTurn: boolean;
}

const Board: React.FC<BoardProps> = ({
    myPlayer,
    squares,
    onClick,
    isMyTurn
}) => {
    const renderSquare = (index: number) => {
        return (
            <Square
                myPlayer={myPlayer}
                position={index}
                value={squares[index]}
                onClick={() => onClick(index)}
            />
        );
    };

    return (
        <div
            className="game-board"
            style={{ boxShadow: isMyTurn ? "0 0 50px #4e7cf4" : undefined }}
        >
            <div className="board-row">
                {renderSquare(0)}
                {renderSquare(1)}
                {renderSquare(2)}
            </div>
            <div className="board-row">
                {renderSquare(3)}
                {renderSquare(4)}
                {renderSquare(5)}
            </div>
            <div className="board-row">
                {renderSquare(6)}
                {renderSquare(7)}
                {renderSquare(8)}
            </div>
        </div>
    );
};

export default Board;
