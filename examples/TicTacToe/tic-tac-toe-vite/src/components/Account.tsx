import React, { useState, useEffect } from "react";
import Lobby from "./Lobby";
import Game from "./Game";
import TempSingleton from "../stateChannel/TempSingleton";
import accountIconBlack from "../assets/account.svg";
import accountIconWhite from "../assets/accountWhite.svg";

interface AccountProps {
    address: string;
    isLeft?: boolean;
    gameStarted?: boolean;
}

const Account: React.FC<AccountProps> = ({ address, isLeft, gameStarted }) => {
    const [profileColor, setProfileColor] = useState<string>("");
    const [balance, setBalance] = useState<number>(
        isLeft
            ? TempSingleton.getMyBalance()
            : TempSingleton.getOpponentBalance()
    );
    isLeft
        ? (TempSingleton.setMyBalance = setBalance)
        : (TempSingleton.setOpponentBalance = setBalance);
    useEffect(() => {
        const init = async () => {
            setProfileColor(generateRandomColor(address));
        };
        init();
    }, [address]);

    const isNodejs =
        typeof process !== "undefined" &&
        process.versions != null &&
        process.versions.node != null;

    const generateRandomColor = (seed: string): string => {
        const letters = "0123456789ABCDEF";
        let color = "#";
        for (let i = 0; i < 6; i++) {
            let num = seed.charCodeAt(i + 2) % 16;
            color += letters[num];
        }
        return color;
    };
    TempSingleton.generateColor = generateRandomColor;

    return (
        <div
            style={{
                position: "absolute",
                top: !isNodejs ? "15px" : "45px",
                left: isLeft ? "10px" : "auto",
                right: isLeft ? "auto" : "10px",
                border: "none",
                padding: "10px",
                borderRadius: "8px",
                display: "flex",
                alignItems: "center",
                backgroundColor: "#222222"
            }}
        >
            <img
                src={isLeft ? accountIconBlack : accountIconWhite}
                alt="account"
                style={{
                    width: "50px",
                    height: "50px",
                    display: "inline-block",
                    marginRight: "10px"
                }}
            />
            {/* <div
        style={{
          width: "50px",
          height: "50px",
          borderRadius: "50%",
          backgroundColor: profileColor,
          display: "inline-block",
          marginRight: "10px",
        }}
      ></div> */}
            <div>
                {/* <h1 style={{ margin: "0", fontSize: "14px", color: "white" }}>
          Account
        </h1> */}
                <p style={{ margin: "0", fontSize: "12px", color: "white" }}>
                    {address.slice(0, 6) +
                        "..." +
                        address.slice(address.length - 6)}
                </p>
                <p
                    style={{
                        margin: "0",
                        fontSize: "14px",
                        color: "white",
                        fontWeight: "bold"
                    }}
                >
                    Balance: {isLeft || gameStarted ? balance : ""}
                </p>
            </div>
        </div>
    );
};

export default Account;
