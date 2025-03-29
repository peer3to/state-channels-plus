import React from "react";
import "./BlogModal.css";
import twitterIcon from "../../assets/twitter.svg";
import githubIcon from "../../assets/github.svg";
interface BlogModalProps {
  isOpen: boolean;
  onClose: () => void;
  //   title: string;
}

const BlogModalExplanation: React.FC<BlogModalProps> = ({
  isOpen,
  onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Explanation</h2>
        <p>
          This is a demo of Tic-Tac-Toe built using our{" "}
          <a
            href="https://github.com/peer3to/state-channels-plus"
            target="_blank"
            rel="noopener noreferrer"
          >
            SDK
          </a>
          .
        </p>
        <p>
          There is no money at stake. The balances shown are only for accounting
          purposes and don't represent any value.
        </p>
        <p>
          The game runs entirely peer-to-peer between the users devices. A
          blockchain is used as the final settlement layer and supreme court.
        </p>
        <p>
          <a
            href="https://x.com/TanssiNetwork"
            target="_blank"
            rel="noopener noreferrer"
          >
            Tanssi
          </a>{" "}
          provides the dedicated blockchain secured by Polkadot.{" "}
          <a
            href="https://x.com/Apillon"
            target="_blank"
            rel="noopener noreferrer"
          >
            Apillon
          </a>{" "}
          provides the decentralized (web3) hosting of the user interface making
          it always available and unstoppable, also powered by Polkadot.
        </p>
        <p>
          For more details, read our{" "}
          <a
            href="https://medium.com/@peer3_to/building-a-peer-to-peer-internet-secured-by-web3-f2ef870922d9"
            target="_blank"
            rel="noopener noreferrer"
          >
            blog
          </a>
        </p>
        <p>Feel free to reachout</p>
        <a href="mailto:contact@peer3.to">contact@peer3.to</a>
        <div className="icon-container">
          <a
            href="https://x.com/peer3_to"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={twitterIcon} alt="Twitter" className="icon" />
          </a>
          <a
            href="https://github.com/peer3to/state-channels-plus"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img src={githubIcon} alt="GitHub" className="icon" />
          </a>
        </div>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default BlogModalExplanation;
