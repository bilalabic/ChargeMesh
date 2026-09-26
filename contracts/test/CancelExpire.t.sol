// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";

contract CancelExpireTest is EscrowTestBase {
    bytes32 internal constant RID2 = keccak256("reservation:2");

    // =====================================================================
    // cancel
    // =====================================================================

    function test_cancel_beforeStartTime_fullRefund() public {
        _reserveDefault();
        uint256 driverBefore = driver.balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationCancelled(RID, DEPOSIT);
        vm.prank(driver);
        escrow.cancel(RID);

        assertEq(driver.balance - driverBefore, DEPOSIT);
        assertEq(address(escrow).balance, 0);
        _assertStatus(RID, IChargeMeshEscrow.Status.Cancelled);
        assertFalse(escrow.isSlotTaken(SLOT));
    }

    function test_cancel_atStartTimeMinusOneSucceeds() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.startTime) - 1);
        vm.prank(driver);
        escrow.cancel(RID);
        _assertStatus(RID, IChargeMeshEscrow.Status.Cancelled);
    }

    function test_cancel_revertsAtStartTime() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(q.startTime);
        vm.expectRevert(IChargeMeshEscrow.TooLate.selector);
        vm.prank(driver);
        escrow.cancel(RID);
    }

    function test_cancel_revertsAfterStartTime() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.endTime) + 1);
        vm.expectRevert(IChargeMeshEscrow.TooLate.selector);
        vm.prank(driver);
        escrow.cancel(RID);
    }

    function test_cancel_revertsForNonDriver() public {
        _reserveDefault();
        address[4] memory callers = [stranger, host, settler, owner];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.expectRevert(IChargeMeshEscrow.NotDriver.selector);
            vm.prank(callers[i]);
            escrow.cancel(RID);
        }
        _assertStatus(RID, IChargeMeshEscrow.Status.Reserved);
    }

    function test_cancel_revertsInvalidStatus_none() public {
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.None));
        vm.prank(driver);
        escrow.cancel(RID);
    }

    function test_cancel_revertsInvalidStatus_active() public {
        _activeDefault();
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Active));
        vm.prank(driver);
        escrow.cancel(RID);
    }

    function test_cancel_revertsInvalidStatus_settled() public {
        _activeDefault();
        _settle(RID, 1);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Settled));
        vm.prank(driver);
        escrow.cancel(RID);
    }

    function test_cancel_revertsInvalidStatus_cancelledTwice() public {
        _reserveDefault();
        vm.prank(driver);
        escrow.cancel(RID);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Cancelled));
        vm.prank(driver);
        escrow.cancel(RID);
    }

    function test_cancel_revertsInvalidStatus_expired() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.endTime) + 1);
        escrow.expire(RID);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Expired));
        vm.prank(driver);
        escrow.cancel(RID);
    }

    function test_cancel_order_invalidStatusBeforeNotDriver() public {
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.None));
        vm.prank(stranger);
        escrow.cancel(RID);
    }

    function test_cancel_order_notDriverBeforeTooLate() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(q.startTime);
        vm.expectRevert(IChargeMeshEscrow.NotDriver.selector);
        vm.prank(stranger);
        escrow.cancel(RID);
    }

    function test_cancel_freesSlotForNewReservation() public {
        _reserveDefault();
        vm.prank(driver);
        escrow.cancel(RID);

        _reserve(_quoteFor(RID2, SLOT));
        _assertStatus(RID2, IChargeMeshEscrow.Status.Reserved);
        assertTrue(escrow.isSlotTaken(SLOT));
        assertEq(escrow.getReservation(RID2).slotRef, SLOT);
        // Old reservation keeps its terminal state.
        _assertStatus(RID, IChargeMeshEscrow.Status.Cancelled);
    }

    // =====================================================================
    // expire: Reserved
    // =====================================================================

    function test_expire_reservedAfterEndTime_refundsDriver() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.endTime) + 1);
        uint256 driverBefore = driver.balance;
        uint256 strangerBefore = stranger.balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationExpired(RID, DEPOSIT);
        vm.prank(stranger); // anyone can call
        escrow.expire(RID);

        assertEq(driver.balance - driverBefore, DEPOSIT);
        assertEq(stranger.balance, strangerBefore);
        assertEq(address(escrow).balance, 0);
        _assertStatus(RID, IChargeMeshEscrow.Status.Expired);
        assertFalse(escrow.isSlotTaken(SLOT));
    }

    function test_expire_reservedRevertsAtEndTime() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(q.endTime);
        vm.expectRevert(IChargeMeshEscrow.TooEarly.selector);
        escrow.expire(RID);
    }

    function test_expire_reservedRevertsBeforeStart() public {
        _reserveDefault();
        vm.expectRevert(IChargeMeshEscrow.TooEarly.selector);
        escrow.expire(RID);
    }

    function test_expire_reservedRevertsBetweenStartAndEnd() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(q.startTime + 1);
        vm.expectRevert(IChargeMeshEscrow.TooEarly.selector);
        escrow.expire(RID);
    }

    // =====================================================================
    // expire: Active
    // =====================================================================

    function test_expire_activeAfterEndTimePlusGrace() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1);
        uint256 driverBefore = driver.balance;
        uint256 hostBefore = host.balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationExpired(RID, DEPOSIT);
        vm.prank(stranger);
        escrow.expire(RID);

        assertEq(driver.balance - driverBefore, DEPOSIT);
        assertEq(host.balance, hostBefore);
        assertEq(address(escrow).balance, 0);
        _assertStatus(RID, IChargeMeshEscrow.Status.Expired);
        assertFalse(escrow.isSlotTaken(SLOT));
    }

    function test_expire_activeRevertsAtEndTimePlusGrace() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE());
        vm.expectRevert(IChargeMeshEscrow.TooEarly.selector);
        escrow.expire(RID);
    }

    function test_expire_activeRevertsJustAfterEndTime() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + 1);
        vm.expectRevert(IChargeMeshEscrow.TooEarly.selector);
        escrow.expire(RID);
    }

    function test_expire_callableByDriverHostSettler() public {
        address[3] memory callers = [driver, host, settler];
        for (uint256 i = 0; i < callers.length; i++) {
            bytes32 id = keccak256(abi.encode("reservation:expire", i));
            bytes32 slot = keccak256(abi.encode("slot:expire", i));
            IChargeMeshEscrow.ReservationQuote memory q = _quoteFor(id, slot);
            _reserve(q);
            vm.warp(uint256(q.endTime) + 1);
            vm.prank(callers[i]);
            escrow.expire(id);
            _assertStatus(id, IChargeMeshEscrow.Status.Expired);
        }
    }

    // =====================================================================
    // expire: invalid status
    // =====================================================================

    function test_expire_revertsInvalidStatus_none() public {
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.None));
        escrow.expire(RID);
    }

    function test_expire_revertsInvalidStatus_settled() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        _settle(RID, 1);
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Settled));
        escrow.expire(RID);
    }

    function test_expire_revertsInvalidStatus_cancelled() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.prank(driver);
        escrow.cancel(RID);
        vm.warp(uint256(q.endTime) + 1);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Cancelled));
        escrow.expire(RID);
    }

    function test_expire_revertsInvalidStatus_expiredTwice() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.endTime) + 1);
        escrow.expire(RID);
        uint256 driverBal = driver.balance;
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Expired));
        escrow.expire(RID);
        assertEq(driver.balance, driverBal);
    }

    function test_expire_order_invalidStatusBeforeTooEarly() public {
        _reserveDefault();
        vm.prank(driver);
        escrow.cancel(RID); // still before endTime
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Cancelled));
        escrow.expire(RID);
    }

    // =====================================================================
    // expire: slot reuse
    // =====================================================================

    function test_expire_reserved_freesSlotForNewReservation() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.endTime) + 1);
        escrow.expire(RID);

        _reserve(_quoteFor(RID2, SLOT)); // quote built relative to the warped time
        _assertStatus(RID2, IChargeMeshEscrow.Status.Reserved);
        assertTrue(escrow.isSlotTaken(SLOT));
    }

    function test_expire_active_freesSlotForNewReservation() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1);
        escrow.expire(RID);
        assertFalse(escrow.isSlotTaken(SLOT));

        _reserve(_quoteFor(RID2, SLOT));
        _assertStatus(RID2, IChargeMeshEscrow.Status.Reserved);
    }
}
