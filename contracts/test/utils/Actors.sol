// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChargeMeshEscrow} from "../../src/ChargeMeshEscrow.sol";
import {IChargeMeshEscrow} from "../../src/interfaces/IChargeMeshEscrow.sol";

/// @notice Contract account that can act as driver, host or settler of the escrow.
abstract contract EscrowActor {
    ChargeMeshEscrow internal immutable escrow;

    constructor(ChargeMeshEscrow escrow_) {
        escrow = escrow_;
    }

    function doReserve(IChargeMeshEscrow.ReservationQuote calldata q, bytes calldata sig) external payable {
        escrow.reserve{value: msg.value}(q, sig);
    }

    function doCancel(bytes32 id) external {
        escrow.cancel(id);
    }

    function doSettle(bytes32 id, uint32 deliveredWh, bytes32 sessionHash) external {
        escrow.settle(id, deliveredWh, sessionHash);
    }

    function doWithdraw() external {
        escrow.withdraw();
    }
}

/// @notice Rejects MON while `accepting == false`.
contract ToggleReceiver is EscrowActor {
    bool public accepting;

    constructor(ChargeMeshEscrow escrow_) EscrowActor(escrow_) {}

    function setAccepting(bool accepting_) external {
        accepting = accepting_;
    }

    receive() external payable {
        require(accepting, "rejecting");
    }
}

/// @notice Burns all forwarded gas in `receive` while `griefing == true`.
contract GasGriefer is EscrowActor {
    bool public griefing = true;

    constructor(ChargeMeshEscrow escrow_) EscrowActor(escrow_) {}

    function setGriefing(bool griefing_) external {
        griefing = griefing_;
    }

    receive() external payable {
        if (griefing) {
            while (true) {}
        }
    }
}

/// @notice Tries to re-enter the escrow from `receive`.
/// @dev `bubble == true`: re-throws the reentrant call's revert (so the push to this contract fails).
///      `bubble == false`: swallows the failure and records it (so the push succeeds).
///      All bookkeeping is packed into one slot to stay well below the escrow's push gas cap.
contract ReentrantActor is EscrowActor {
    enum Attack {
        None,
        Settle,
        Expire,
        Cancel,
        StartSession,
        Withdraw
    }

    struct Record {
        Attack attack;
        bool bubble;
        bool attempted;
        bool succeeded;
        uint32 receiveCount;
        bytes4 revertSelector;
    }

    Record public rec;
    bytes32 public targetId;

    constructor(ChargeMeshEscrow escrow_) EscrowActor(escrow_) {}

    function configure(Attack attack_, bytes32 targetId_, bool bubble_) external {
        rec = Record(attack_, bubble_, false, false, 0, bytes4(0));
        targetId = targetId_;
    }

    function attempted() external view returns (bool) {
        return rec.attempted;
    }

    function succeeded() external view returns (bool) {
        return rec.succeeded;
    }

    function receiveCount() external view returns (uint32) {
        return rec.receiveCount;
    }

    function revertSelector() external view returns (bytes4) {
        return rec.revertSelector;
    }

    receive() external payable {
        Record memory r = rec;
        r.receiveCount++;
        if (r.attack == Attack.None) {
            rec = r;
            return;
        }

        bytes memory data;
        if (r.attack == Attack.Settle) {
            data = abi.encodeCall(ChargeMeshEscrow.settle, (targetId, 1, keccak256("reentrant")));
        } else if (r.attack == Attack.Expire) {
            data = abi.encodeCall(ChargeMeshEscrow.expire, (targetId));
        } else if (r.attack == Attack.Cancel) {
            data = abi.encodeCall(ChargeMeshEscrow.cancel, (targetId));
        } else if (r.attack == Attack.StartSession) {
            data = abi.encodeCall(ChargeMeshEscrow.startSession, (targetId));
        } else {
            data = abi.encodeCall(ChargeMeshEscrow.withdraw, ());
        }

        (bool ok, bytes memory ret) = address(escrow).call(data);
        r.attempted = true;
        r.succeeded = ok;
        r.revertSelector = ret.length >= 4 ? bytes4(ret) : bytes4(0);
        rec = r;
        if (!ok && r.bubble) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }
}
