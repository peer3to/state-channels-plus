import React, { useState, useEffect } from "react";
import Lobby from "./Lobby";
import Game from "./Game";
import TempSingleton from "../stateChannel/TempSingleton";

interface AccountProps {
  address: string;
  isLeft?: boolean;
}

const Account: React.FC<AccountProps> = ({ address, isLeft }) => {
  const [profileColor, setProfileColor] = useState<string>("");

  useEffect(() => {
    const init = async () => {
      setProfileColor(generateRandomColor(address));
    };
    init();
  }, [address]);

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
        top: "45px",
        left: isLeft ? "10px" : "auto",
        right: isLeft ? "auto" : "10px",
        border: "1px solid #ccc",
        padding: "10px",
        borderRadius: "8px",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: "50px",
          height: "50px",
          borderRadius: "50%",
          backgroundColor: profileColor,
          display: "inline-block",
          marginRight: "10px",
        }}
      ></div>
      <div>
        <h1 style={{ margin: "0", fontSize: "16px" }}>Account</h1>
        <p style={{ margin: "0", fontSize: "14px" }}>
          {address.slice(0, 6) + "..." + address.slice(address.length - 6)}
        </p>
      </div>
    </div>
  );
};

export default Account;
