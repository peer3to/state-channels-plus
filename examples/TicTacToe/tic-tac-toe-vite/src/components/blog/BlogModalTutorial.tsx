import React from "react";
import "./BlogModal.css";

interface BlogModalProps {
  isOpen: boolean;
  onClose: () => void;
  //   title: string;
}

const BlogModalTutorial: React.FC<BlogModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>How To Play</h2>
        <p>
          Like classical Tic-Tac-Toe, two players are needed. It can be the same
          person, on the same device (e.g. 2 browser tabs) or it can be someone
          else located anywhere in the world.
        </p>
        <p>
          One player creates the game, which generates a game ID. The other
          player uses that game ID to connect.
        </p>
        <p>After connecting, any player can start the game.</p>
        <p>
          Before the game starts, players exchange a cryptographic commitment
          (that's done automatically for them) and that commitment is posted and
          verified on a blockchain. This and all blockchain operations are
          slower and not in real-time.
        </p>
        <p>After the blockchain verifies the commitment, the game starts.</p>
        <p>
          Players take turns playing Tic-Tac-Toe like they normally would.
          Winning the game increases the player's balance by up to 50 and
          decreases the losing player's balance by the same amount. The game
          terminates when one player's balance becomes 0 or a player fails to
          produce a move in time, which causes the other player to invoke
          timeout on the blockchain.
        </p>
        <p>
          For this demo, timeout transfers up to 50 from the player being
          removed to the player invoking timeout.
        </p>
        <p>
          If a player's balance becomes 0, they can refresh the page to get a
          new account with a new balance.
        </p>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default BlogModalTutorial;
