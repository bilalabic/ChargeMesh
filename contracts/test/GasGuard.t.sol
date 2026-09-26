// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";
import {ToggleReceiver} from "./utils/Actors.sol";

/// @notice A caller must not be able to force a payment deferral by starving the push of gas.
contract GasGuardTest is EscrowTestBase {
    function test_expire_withStarvedGas_revertsInsteadOfDeferring() public {
        ToggleReceiver contractDriver = new ToggleReceiver(escrow);
        IChargeMeshEscrow.ReservationQuote memory q = _reserveWithContractDriver(address(contractDriver));
        vm.warp(uint256(q.endTime) + 1);

        vm.expectRevert(IChargeMeshEscrow.InsufficientGas.selector);
        escrow.expire{gas: 120_000}(q.reservationId);

        _assertStatus(q.reservationId, IChargeMeshEscrow.Status.Reserved);
        assertEq(escrow.pendingWithdrawal(address(contractDriver)), 0);
    }

    /// @dev Mirrors PUSH_GAS_LIMIT / PUSH_GAS_MARGIN in ChargeMeshEscrow. Whenever the guard passes,
    ///      the recipient must still receive the full stipend under Monad's worst-case CALL cost
    ///      (cold account 10,100 + value transfer 9,000 + new account 25,000).
    function test_guardMargin_coversMonadWorstCaseCallCost() public pure {
        uint256 pushGasLimit = 100_000;
        uint256 pushGasMargin = 50_000;
        uint256 monadWorstCaseCallCost = 10_100 + 9_000 + 25_000;

        uint256 minGasLeft = pushGasLimit * 64 / 63 + pushGasMargin;
        uint256 forwarded = (minGasLeft - monadWorstCaseCallCost) * 63 / 64;
        assertGe(forwarded, pushGasLimit);
    }

    function test_expire_withEnoughGas_pushesToAcceptingContract() public {
        ToggleReceiver contractDriver = new ToggleReceiver(escrow);
        IChargeMeshEscrow.ReservationQuote memory q = _reserveWithContractDriver(address(contractDriver));
        contractDriver.setAccepting(true);
        vm.warp(uint256(q.endTime) + 1);

        uint256 before = address(contractDriver).balance;
        escrow.expire{gas: 400_000}(q.reservationId);

        _assertStatus(q.reservationId, IChargeMeshEscrow.Status.Expired);
        assertEq(address(contractDriver).balance - before, q.depositWei);
        assertEq(escrow.pendingWithdrawal(address(contractDriver)), 0);
    }
}
