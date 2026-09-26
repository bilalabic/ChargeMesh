// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";
import {GasGriefer, ToggleReceiver} from "./utils/Actors.sol";

/// @notice Push-or-defer payouts (security fix M-1) and the pull-based `withdraw`.
contract WithdrawTest is EscrowTestBase {
    uint256 internal constant HOST_PART = 0.145 ether;
    uint256 internal constant DRIVER_PART = 0.055 ether;

    ToggleReceiver internal rejecting;
    GasGriefer internal griefer;

    function setUp() public override {
        super.setUp();
        rejecting = new ToggleReceiver(escrow); // starts rejecting
        griefer = new GasGriefer(escrow); // starts griefing
    }

    // =====================================================================
    // Rejecting host
    // =====================================================================

    function test_settle_rejectingHost_succeedsAndDefersHostAmount() public {
        _activeWithHost(address(rejecting));
        uint256 driverBefore = driver.balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationSettled(
            RID, 14_500, 14_500, uint128(HOST_PART), uint128(DRIVER_PART), SESSION_HASH
        );
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.PaymentDeferred(address(rejecting), HOST_PART);
        _settle(RID, 14_500);

        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
        assertEq(driver.balance - driverBefore, DRIVER_PART, "driver refund pushed");
        assertEq(address(rejecting).balance, 0);
        assertEq(escrow.pendingWithdrawal(address(rejecting)), HOST_PART);
        assertEq(escrow.pendingWithdrawal(driver), 0);
        assertEq(address(escrow).balance, HOST_PART, "escrow == sum of pending");
    }

    function test_settle_rejectingHost_laterWithdraws() public {
        _activeWithHost(address(rejecting));
        _settle(RID, 14_500);

        rejecting.setAccepting(true);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.Withdrawn(address(rejecting), HOST_PART);
        rejecting.doWithdraw();

        assertEq(address(rejecting).balance, HOST_PART);
        assertEq(escrow.pendingWithdrawal(address(rejecting)), 0);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_rejectingHost_zeroDeliveryNoDeferral() public {
        // hostAmount == 0 => no push attempted, nothing deferred.
        _activeWithHost(address(rejecting));
        uint256 driverBefore = driver.balance;
        _settle(RID, 0);
        assertEq(driver.balance - driverBefore, DEPOSIT);
        assertEq(escrow.pendingWithdrawal(address(rejecting)), 0);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_rejectingHost_accumulatesAcrossReservations() public {
        _activeWithHost(address(rejecting));
        _settle(RID, 14_500);

        bytes32 rid2 = keccak256("reservation:2");
        IChargeMeshEscrow.ReservationQuote memory q2 = _quoteFor(rid2, keccak256("slot:2"));
        q2.host = address(rejecting);
        _reserve(q2);
        _start(rid2);
        _settle(rid2, 20_000);

        assertEq(escrow.pendingWithdrawal(address(rejecting)), HOST_PART + DEPOSIT);
        assertEq(address(escrow).balance, HOST_PART + DEPOSIT);

        rejecting.setAccepting(true);
        rejecting.doWithdraw();
        assertEq(address(rejecting).balance, HOST_PART + DEPOSIT);
        assertEq(address(escrow).balance, 0);
    }

    // =====================================================================
    // Rejecting driver (M-1: a hostile driver cannot block the host payout)
    // =====================================================================

    function test_settle_rejectingDriver_hostStillPaid() public {
        _reserveWithContractDriver(address(rejecting));
        _start(RID);
        uint256 hostBefore = host.balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.PaymentDeferred(address(rejecting), DRIVER_PART);
        _settle(RID, 14_500);

        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
        assertEq(host.balance - hostBefore, HOST_PART, "host paid");
        assertEq(escrow.pendingWithdrawal(address(rejecting)), DRIVER_PART);
        assertEq(address(escrow).balance, DRIVER_PART);

        rejecting.setAccepting(true);
        rejecting.doWithdraw();
        assertEq(address(rejecting).balance, DRIVER_PART);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_rejectingDriver_fullDeliveryNoDeferral() public {
        _reserveWithContractDriver(address(rejecting));
        _start(RID);
        _settle(RID, 20_000); // refund == 0
        assertEq(escrow.pendingWithdrawal(address(rejecting)), 0);
        assertEq(address(escrow).balance, 0);
    }

    function test_cancel_rejectingDriver_succeedsAndDefersRefund() public {
        _reserveWithContractDriver(address(rejecting));

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationCancelled(RID, DEPOSIT);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.PaymentDeferred(address(rejecting), DEPOSIT);
        rejecting.doCancel(RID);

        _assertStatus(RID, IChargeMeshEscrow.Status.Cancelled);
        assertFalse(escrow.isSlotTaken(SLOT));
        assertEq(escrow.pendingWithdrawal(address(rejecting)), DEPOSIT);
        assertEq(address(escrow).balance, DEPOSIT);

        rejecting.setAccepting(true);
        rejecting.doWithdraw();
        assertEq(address(rejecting).balance, DEPOSIT);
        assertEq(address(escrow).balance, 0);
    }

    function test_expire_rejectingDriver_succeedsAndDefersRefund() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveWithContractDriver(address(rejecting));
        vm.warp(uint256(q.endTime) + 1);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.PaymentDeferred(address(rejecting), DEPOSIT);
        vm.prank(stranger);
        escrow.expire(RID);

        _assertStatus(RID, IChargeMeshEscrow.Status.Expired);
        assertFalse(escrow.isSlotTaken(SLOT));
        assertEq(escrow.pendingWithdrawal(address(rejecting)), DEPOSIT);
        assertEq(address(escrow).balance, DEPOSIT);
    }

    function test_expire_activeRejectingDriver_succeedsAndDefersRefund() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveWithContractDriver(address(rejecting));
        _start(RID);
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1);
        escrow.expire(RID);
        assertEq(escrow.pendingWithdrawal(address(rejecting)), DEPOSIT);
    }

    // =====================================================================
    // Gas-griefing recipients
    // =====================================================================

    function test_settle_gasGriefingHost_deferredWithinGasCap() public {
        _activeWithHost(address(griefer));
        uint256 driverBefore = driver.balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.PaymentDeferred(address(griefer), HOST_PART);
        uint256 gasBefore = gasleft();
        _settle(RID, 14_500);
        uint256 used = gasBefore - gasleft();

        assertLt(used, 300_000, "griefer cannot burn more than the push cap");
        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
        assertEq(driver.balance - driverBefore, DRIVER_PART);
        assertEq(escrow.pendingWithdrawal(address(griefer)), HOST_PART);
        assertEq(address(escrow).balance, HOST_PART);

        griefer.setGriefing(false);
        griefer.doWithdraw();
        assertEq(address(griefer).balance, HOST_PART);
        assertEq(address(escrow).balance, 0);
    }

    function test_cancel_gasGriefingDriver_deferred() public {
        _reserveWithContractDriver(address(griefer));
        griefer.doCancel(RID);
        _assertStatus(RID, IChargeMeshEscrow.Status.Cancelled);
        assertEq(escrow.pendingWithdrawal(address(griefer)), DEPOSIT);
    }

    function test_settle_gasGriefingDriver_hostStillPaid() public {
        _reserveWithContractDriver(address(griefer));
        _start(RID);
        uint256 hostBefore = host.balance;
        _settle(RID, 14_500);
        assertEq(host.balance - hostBefore, HOST_PART);
        assertEq(escrow.pendingWithdrawal(address(griefer)), DRIVER_PART);
    }

    // =====================================================================
    // withdraw
    // =====================================================================

    function test_withdraw_revertsNothingToWithdraw() public {
        vm.expectRevert(IChargeMeshEscrow.NothingToWithdraw.selector);
        vm.prank(stranger);
        escrow.withdraw();
    }

    function test_withdraw_revertsNothingToWithdraw_afterNormalPush() public {
        _activeDefault();
        _settle(RID, 14_500);
        vm.expectRevert(IChargeMeshEscrow.NothingToWithdraw.selector);
        vm.prank(host);
        escrow.withdraw();
    }

    function test_withdraw_successEmitsAndZeroes() public {
        _activeWithHost(address(rejecting));
        _settle(RID, 14_500);
        rejecting.setAccepting(true);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.Withdrawn(address(rejecting), HOST_PART);
        rejecting.doWithdraw();

        assertEq(escrow.pendingWithdrawal(address(rejecting)), 0);
        assertEq(address(rejecting).balance, HOST_PART);
    }

    function test_withdraw_secondCallReverts() public {
        _activeWithHost(address(rejecting));
        _settle(RID, 14_500);
        rejecting.setAccepting(true);
        rejecting.doWithdraw();

        vm.expectRevert(IChargeMeshEscrow.NothingToWithdraw.selector);
        rejecting.doWithdraw();
        assertEq(address(rejecting).balance, HOST_PART);
    }

    function test_withdraw_stillRejecting_revertsTransferFailed() public {
        _activeWithHost(address(rejecting));
        _settle(RID, 14_500);

        vm.expectRevert(IChargeMeshEscrow.TransferFailed.selector);
        rejecting.doWithdraw();
        assertEq(escrow.pendingWithdrawal(address(rejecting)), HOST_PART, "pending restored on revert");
        assertEq(address(escrow).balance, HOST_PART);
    }

    function test_withdraw_onlyOwnBalance() public {
        _activeWithHost(address(rejecting));
        _settle(RID, 14_500);
        vm.expectRevert(IChargeMeshEscrow.NothingToWithdraw.selector);
        vm.prank(stranger);
        escrow.withdraw();
        assertEq(escrow.pendingWithdrawal(address(rejecting)), HOST_PART);
    }

    function test_pendingWithdrawal_defaultZero() public view {
        assertEq(escrow.pendingWithdrawal(driver), 0);
        assertEq(escrow.pendingWithdrawal(host), 0);
    }
}
