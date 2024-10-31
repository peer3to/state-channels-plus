// SPDX-License-Identifier: MIT
pragma solidity ^0.8.8;

import "@peer3/state-channels-plus/contracts/V1/AStateMachine.sol";

enum Cell {
    None,
    X,
    O
}
struct TicTacToeState {
    address[] participants;
    Cell[3][3] board;
    address currentPlayer;
    bool gameActive;
    uint movesCount;
}

contract TicTacToeStateMachine is AStateMachine {
    TicTacToeState state;
    event MoveMade(address player, uint8 row, uint8 col, Cell cell);
    event GameOver(Cell winner);

    modifier onlyCurrentPlayer() {
        require(_tx.header.participant == state.currentPlayer, "Not your turn");
        _;
    }

    modifier isActiveGame() {
        require(state.gameActive, "Game is not active");
        _;
    }

    function makeMove(
        uint8 row,
        uint8 col
    ) public onlyCurrentPlayer isActiveGame {
        require(row < 3 && col < 3, "Invalid board position");
        require(state.board[row][col] == Cell.None, "Cell is already occupied");

        state.board[row][col] = state.currentPlayer == state.participants[0]
            ? Cell.X
            : Cell.O;
        state.movesCount++;
        emit MoveMade(msg.sender, row, col, state.board[row][col]);

        if (checkWinner(row, col)) {
            state.gameActive = false;
            resetGame();
            emit GameOver(state.board[row][col]); // Last played cell won
        } else if (state.movesCount == 9) {
            state.gameActive = false;
            resetGame();
            emit GameOver(Cell.None); // Draw
        } else {
            state.currentPlayer = state.participants[state.movesCount % 2];
        }
    }

    function checkWinner(uint8 row, uint8 col) internal view returns (bool) {
        // Check row
        if (
            state.board[row][0] == state.board[row][col] &&
            state.board[row][1] == state.board[row][col] &&
            state.board[row][2] == state.board[row][col]
        ) {
            return true;
        }
        // Check column
        if (
            state.board[0][col] == state.board[row][col] &&
            state.board[1][col] == state.board[row][col] &&
            state.board[2][col] == state.board[row][col]
        ) {
            return true;
        }
        // Check diagonals
        if (
            state.board[0][0] == state.board[row][col] &&
            state.board[1][1] == state.board[row][col] &&
            state.board[2][2] == state.board[row][col]
        ) {
            return true;
        }
        if (
            state.board[0][2] == state.board[row][col] &&
            state.board[1][1] == state.board[row][col] &&
            state.board[2][0] == state.board[row][col]
        ) {
            return true;
        }
        return false;
    }

    function resetGame() internal {
        for (uint8 i = 0; i < 3; i++) {
            for (uint8 j = 0; j < 3; j++) {
                state.board[i][j] = Cell.None;
            }
        }
        //swap players
        address t = state.participants[0];
        state.participants[0] = state.participants[1];
        state.participants[1] = t;

        state.currentPlayer = state.participants[0];
        state.gameActive = true;
        state.movesCount = 0;
    }

    function getBoard() public view returns (Cell[3][3] memory) {
        return state.board;
    }

    //AStateMachine
    function _setState(bytes memory encodedState) internal virtual override {
        state = abi.decode(encodedState, (TicTacToeState));
    }

    function getState() public view virtual override returns (bytes memory) {
        return abi.encode(state);
    }

    function getParticipants()
        public
        view
        virtual
        override
        returns (address[] memory)
    {
        return state.participants;
    }

    function getNextToWrite() public view virtual override returns (address) {
        if (state.participants.length == 0) {
            return _tx.header.participant;
        }
        return state.currentPlayer;
    }

    function _slashParticipant(
        address adr
    ) internal virtual override returns (bool, ProcessExit memory) {
        return _removeParticipant(adr);
    }

    function _removeParticipant(
        address adr
    ) internal virtual override returns (bool, ProcessExit memory) {
        uint256 length = state.participants.length;
        ProcessExit memory processExit;
        for (uint256 i = 0; i < length; i++) {
            if (state.participants[i] == adr) {
                state.participants[i] = state.participants[length - 1];
                state.participants.pop();

                processExit.participant = adr;
                processExit.amount = 0;
                return (true, processExit);
            }
        }
        return (false, processExit);
    }

    function _joinChannel(
        JoinChannel memory joinChannel
    ) internal virtual override returns (bool) {}
}
