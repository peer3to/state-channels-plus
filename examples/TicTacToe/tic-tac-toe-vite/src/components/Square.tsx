import React from "react";

interface SquareProps {
    myPlayer: string;
    position: number;
    value: string | null;
    onClick: () => void;
}

const Square: React.FC<SquareProps> = ({
    myPlayer,
    position,
    value,
    onClick
}) => {
    return (
        <button
            className="square"
            onClick={onClick}
            style={{
                borderTop: position / 3 < 1 ? "none" : undefined,
                borderBottom: position / 3 >= 2 ? "none" : undefined,
                borderLeft: position % 3 === 0 ? "none" : undefined,
                borderRight: position % 3 === 2 ? "none" : undefined,
                color: value === myPlayer ? "#4e7cf4" : "#ffffff"
            }}
        >
            {value}
        </button>
    );
};

export default Square;
