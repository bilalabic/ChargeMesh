// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";

contract SessionTest is EscrowTestBase {
    // =====================================================================
    // startSession
    // =====================================================================

    function test_startSession_happyPath() public {
        _reserveDefault();
        _start(RID);
        _assertStatus(RID, IChargeMeshEscrow.Status.Active);
        assertTrue(escrow.isSlotTaken(SLOT));
        assertEq(address(escrow).balance, DEPOSIT);
    }

    function test_startSession_emitsSessionStarted() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(q.startTime + 10);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.SessionStarted(RID, q.startTime + 10);
        _start(RID);
    }

    function test_startSession_allowedBeforeStartTime() public {
        // Spec only bounds startSession by endTime.
        _reserveDefault();
        _start(RID);
        _assertStatus(RID, IChargeMeshEscrow.Status.Active);
    }

    function test_startSession_atEndTimeBoundarySucceeds() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(q.endTime);
        _start(RID);
        _assertStatus(RID, IChargeMeshEscrow.Status.Active);
    }

    function test_startSession_revertsAfterEndTime() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.endTime) + 1);
        vm.expectRevert(IChargeMeshEscrow.TooLate.selector);
        vm.prank(settler);
        escrow.startSession(RID);
    }

    function test_startSession_revertsForNonSettler() public {
        _reserveDefault();
        address[3] memory callers = [stranger, driver, owner];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
            vm.prank(callers[i]);
            escrow.startSession(RID);
        }
    }

    function test_startSession_revertsForHost() public {
        _reserveDefault();
        vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
        vm.prank(host);
        escrow.startSession(RID);
    }

    function test_startSession_revertsInvalidStatus_none() public {
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.None));
        vm.prank(settler);
        escrow.startSession(RID);
    }

    function test_startSession_revertsInvalidStatus_active() public {
        _activeDefault();
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Active));
        vm.prank(settler);
        escrow.startSession(RID);
    }

    function test_startSession_revertsInvalidStatus_settled() public {
        _activeDefault();
        _settle(RID, REQUESTED_WH);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Settled));
        vm.prank(settler);
        escrow.startSession(RID);
    }

    function test_startSession_revertsInvalidStatus_cancelled() public {
        _reserveDefault();
        vm.prank(driver);
        escrow.cancel(RID);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Cancelled));
        vm.prank(settler);
        escrow.startSession(RID);
    }

    function test_startSession_revertsInvalidStatus_expired() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        vm.warp(uint256(q.endTime) + 1);
        escrow.expire(RID);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Expired));
        vm.prank(settler);
        escrow.startSession(RID);
    }

    function test_startSession_order_notSettlerBeforeInvalidStatus() public {
        vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
        vm.prank(stranger);
        escrow.startSession(RID); // status None
    }

    function test_startSession_order_invalidStatusBeforeTooLate() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + 1);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Active));
        vm.prank(settler);
        escrow.startSession(RID);
    }

    // =====================================================================
    // settle: balances
    // =====================================================================

    function test_settle_fullDelivery() public {
        _assertSettlement(20_000, 20_000, 0.2 ether, 0);
    }

    function test_settle_partialDelivery() public {
        // 14.5 kWh * 0.01 MON = 0.145 MON to host, 0.055 MON back to driver.
        _assertSettlement(14_500, 14_500, 0.145 ether, 0.055 ether);
    }

    function test_settle_overDelivery() public {
        // Billing is capped at requestedWh.
        _assertSettlement(20_493, 20_000, 0.2 ether, 0);
    }

    function test_settle_zeroDelivery() public {
        _assertSettlement(0, 0, 0, 0.2 ether);
    }

    function test_settle_maxUint32Delivery() public {
        _assertSettlement(type(uint32).max, 20_000, 0.2 ether, 0);
    }

    function test_settle_oneWhDelivery() public {
        _assertSettlement(1, 1, 1e13, 0.2 ether - 1e13);
    }

    function test_settle_hostAmountRoundsDown() public {
        // price 3 wei/kWh, 1 Wh: deposit = ceil(3/1000) = 1, cost = floor(3/1000) = 0.
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.requestedWh = 1;
        q.pricePerKwhWei = 3;
        q.depositWei = 1;
        _reserve(q);
        _start(RID);

        uint256 hostBefore = host.balance;
        uint256 driverBefore = driver.balance;
        _settle(RID, 1);
        assertEq(host.balance - hostBefore, 0);
        assertEq(driver.balance - driverBefore, 1);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_roundingWithOddPrice() public {
        // price = 1e16 + 7 wei/kWh, 14.5 kWh delivered of 20.
        uint128 price = 1e16 + 7;
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.pricePerKwhWei = price;
        q.depositWei = uint128((uint256(REQUESTED_WH) * price + 999) / 1000); // 200000000000000140
        _reserve(q);
        _start(RID);

        uint256 expectedHost = (uint256(14_500) * price) / 1000; // 145000000000000101 (floor of ...101.5)
        assertEq(q.depositWei, 200000000000000140);
        assertEq(expectedHost, 145000000000000101);

        uint256 hostBefore = host.balance;
        uint256 driverBefore = driver.balance;
        _settle(RID, 14_500);
        assertEq(host.balance - hostBefore, expectedHost);
        assertEq(driver.balance - driverBefore, q.depositWei - expectedHost);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_onlyTouchesOwnDeposit() public {
        // Two reservations in escrow; settling one must leave the other's deposit untouched.
        _activeDefault();
        _reserve(_quoteFor(keccak256("reservation:2"), keccak256("slot:2")));
        assertEq(address(escrow).balance, 2 * uint256(DEPOSIT));

        _settle(RID, 14_500);
        assertEq(address(escrow).balance, DEPOSIT);
    }

    // =====================================================================
    // settle: stored state, event, slot
    // =====================================================================

    function test_settle_storesDeliveredWhAndSessionHash() public {
        _activeDefault();
        _settle(RID, 20_493);
        IChargeMeshEscrow.Reservation memory r = escrow.getReservation(RID);
        assertEq(uint8(r.status), uint8(IChargeMeshEscrow.Status.Settled));
        assertEq(r.deliveredWh, 20_493, "stores raw delivered, not billable");
        assertEq(r.sessionHash, SESSION_HASH);
        // Unchanged fields
        assertEq(r.requestedWh, REQUESTED_WH);
        assertEq(r.depositWei, DEPOSIT);
        assertEq(r.driver, driver);
        assertEq(r.host, host);
    }

    function test_settle_emitsReservationSettled() public {
        _activeDefault();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationSettled(RID, 14_500, 14_500, 0.145 ether, 0.055 ether, SESSION_HASH);
        _settle(RID, 14_500);
    }

    function test_settle_emitsReservationSettled_overDelivery() public {
        _activeDefault();
        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationSettled(RID, 20_493, 20_000, 0.2 ether, 0, SESSION_HASH);
        _settle(RID, 20_493);
    }

    function test_settle_slotStaysTaken() public {
        _activeDefault();
        _settle(RID, 14_500);
        assertTrue(escrow.isSlotTaken(SLOT));

        IChargeMeshEscrow.ReservationQuote memory q = _quoteFor(keccak256("reservation:2"), SLOT);
        bytes memory sig = _sign(q);
        vm.expectRevert(IChargeMeshEscrow.SlotAlreadyTaken.selector);
        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, sig);
    }

    function test_settle_afterEndTimeWithinGrace() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE());
        _settle(RID, 14_500);
        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
    }

    function test_settle_afterGraceIfNobodyExpired() public {
        // Spec does not time-bound settle; an Active reservation can be settled until someone expires it.
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1);
        _settle(RID, 14_500);
        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
    }

    // =====================================================================
    // settle: reverts
    // =====================================================================

    function test_settle_revertsOnZeroSessionHash() public {
        _activeDefault();
        vm.expectRevert(IChargeMeshEscrow.ZeroSessionHash.selector);
        vm.prank(settler);
        escrow.settle(RID, 14_500, bytes32(0));
        _assertStatus(RID, IChargeMeshEscrow.Status.Active);
        assertEq(address(escrow).balance, DEPOSIT);
    }

    function test_settle_revertsForNonSettler() public {
        _activeDefault();
        address[4] memory callers = [stranger, driver, host, owner];
        for (uint256 i = 0; i < callers.length; i++) {
            vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
            vm.prank(callers[i]);
            escrow.settle(RID, 14_500, SESSION_HASH);
        }
    }

    function test_settle_revertsInvalidStatus_none() public {
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.None));
        vm.prank(settler);
        escrow.settle(RID, 1, SESSION_HASH);
    }

    function test_settle_revertsInvalidStatus_reserved() public {
        _reserveDefault();
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Reserved));
        vm.prank(settler);
        escrow.settle(RID, 1, SESSION_HASH);
    }

    function test_settle_revertsInvalidStatus_settledTwice() public {
        _activeDefault();
        _settle(RID, 14_500);
        uint256 hostBal = host.balance;
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Settled));
        vm.prank(settler);
        escrow.settle(RID, 14_500, SESSION_HASH);
        assertEq(host.balance, hostBal);
    }

    function test_settle_revertsInvalidStatus_cancelled() public {
        _reserveDefault();
        vm.prank(driver);
        escrow.cancel(RID);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Cancelled));
        vm.prank(settler);
        escrow.settle(RID, 1, SESSION_HASH);
    }

    function test_settle_revertsInvalidStatus_expired() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeDefault();
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1);
        escrow.expire(RID);
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Expired));
        vm.prank(settler);
        escrow.settle(RID, 1, SESSION_HASH);
    }

    function test_settle_order_notSettlerBeforeInvalidStatus() public {
        _reserveDefault();
        vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
        vm.prank(stranger);
        escrow.settle(RID, 1, bytes32(0));
    }

    function test_settle_order_invalidStatusBeforeZeroSessionHash() public {
        _reserveDefault();
        vm.expectRevert(_invalidStatus(IChargeMeshEscrow.Status.Reserved));
        vm.prank(settler);
        escrow.settle(RID, 1, bytes32(0));
    }

    // =====================================================================
    // Full demo lifecycle
    // =====================================================================

    function test_lifecycle_demo() public {
        uint256 driverStart = driver.balance;
        uint256 hostStart = host.balance;

        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, sig);

        vm.warp(q.startTime);
        _start(RID);
        vm.warp(q.startTime + 45 minutes);
        _settle(RID, 14_500);

        assertEq(driverStart - driver.balance, 0.145 ether, "driver net cost");
        assertEq(host.balance - hostStart, 0.145 ether, "host earnings");
        assertEq(address(escrow).balance, 0);
    }

    // ---------- Helpers ----------

    function _assertSettlement(
        uint32 deliveredWh,
        uint32 expectedBillable,
        uint256 expectedHost,
        uint256 expectedRefund
    ) internal {
        _activeDefault();
        assertEq(expectedHost + expectedRefund, DEPOSIT, "test vector must conserve deposit");

        uint256 hostBefore = host.balance;
        uint256 driverBefore = driver.balance;
        uint256 escrowBefore = address(escrow).balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationSettled(
            RID, deliveredWh, expectedBillable, uint128(expectedHost), uint128(expectedRefund), SESSION_HASH
        );
        _settle(RID, deliveredWh);

        assertEq(host.balance - hostBefore, expectedHost, "host delta");
        assertEq(driver.balance - driverBefore, expectedRefund, "driver delta");
        assertEq(escrowBefore - address(escrow).balance, DEPOSIT, "escrow delta");
        assertEq(address(escrow).balance, 0, "escrow drained");

        IChargeMeshEscrow.Reservation memory r = escrow.getReservation(RID);
        assertEq(uint8(r.status), uint8(IChargeMeshEscrow.Status.Settled));
        assertEq(r.deliveredWh, deliveredWh);
        assertEq(r.sessionHash, SESSION_HASH);
        assertTrue(escrow.isSlotTaken(SLOT));
    }
}
