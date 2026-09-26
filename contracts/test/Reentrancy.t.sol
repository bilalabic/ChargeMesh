// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";
import {ReentrantActor} from "./utils/Actors.sol";

/// @notice A recipient that re-enters the escrow from `receive` can never double-dip:
///         - bubble mode: its `receive` reverts, the push fails and the amount is deferred to
///           pendingWithdrawal (outer call still succeeds, see M-1);
///         - swallow mode: the reentrant call fails with ReentrancyGuardReentrantCall and the
///           push succeeds exactly once.
contract ReentrancyTest is EscrowTestBase {
    bytes32 internal constant RID2 = keccak256("reservation:2");
    bytes32 internal constant SLOT2 = keccak256("slot:2");
    uint256 internal constant HOST_PART = 0.145 ether;
    uint256 internal constant DRIVER_PART = 0.055 ether;

    ReentrantActor internal attacker;

    function setUp() public override {
        super.setUp();
        attacker = new ReentrantActor(escrow);
    }

    // =====================================================================
    // Malicious host during settle
    // =====================================================================

    /// Host is also the settler, so onlySettler passes on re-entry; only the guard stops it.
    function test_settle_maliciousHostReentersSettle_bubble_amountDeferred() public {
        _activeWithHost(address(attacker));
        _setSettler(address(attacker));
        attacker.configure(ReentrantActor.Attack.Settle, RID, true);
        uint256 driverBefore = driver.balance;

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.PaymentDeferred(address(attacker), HOST_PART);
        attacker.doSettle(RID, 14_500, SESSION_HASH);

        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
        assertEq(escrow.getReservation(RID).deliveredWh, 14_500, "reentrant settle did not overwrite");
        assertEq(escrow.getReservation(RID).sessionHash, SESSION_HASH);
        assertEq(address(attacker).balance, 0, "no push to attacker");
        assertEq(escrow.pendingWithdrawal(address(attacker)), HOST_PART);
        assertEq(driver.balance - driverBefore, DRIVER_PART, "driver still refunded");
        assertEq(address(escrow).balance, HOST_PART);

        // Later pulls exactly once.
        attacker.configure(ReentrantActor.Attack.None, bytes32(0), false);
        attacker.doWithdraw();
        assertEq(address(attacker).balance, HOST_PART);
        assertEq(escrow.pendingWithdrawal(address(attacker)), 0);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_maliciousHostReentersSettle_swallow_paidExactlyOnce() public {
        _activeWithHost(address(attacker));
        _setSettler(address(attacker));
        attacker.configure(ReentrantActor.Attack.Settle, RID, false);
        uint256 driverBefore = driver.balance;

        attacker.doSettle(RID, 14_500, SESSION_HASH);

        assertTrue(attacker.attempted());
        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(attacker.receiveCount(), 1);

        assertEq(address(attacker).balance, HOST_PART);
        assertEq(escrow.pendingWithdrawal(address(attacker)), 0);
        assertEq(driver.balance - driverBefore, DRIVER_PART);
        assertEq(address(escrow).balance, 0);
        assertEq(escrow.getReservation(RID).deliveredWh, 14_500);
    }

    /// Host is not the settler: the guard (which runs before onlySettler) still rejects the re-entry.
    function test_settle_maliciousHostNotSettler_reentryBlocked() public {
        _activeWithHost(address(attacker));
        attacker.configure(ReentrantActor.Attack.Settle, RID, false);

        _settle(RID, 14_500);
        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(address(attacker).balance, HOST_PART);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_maliciousHostReentersExpireSameId_bubble() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeWithHost(address(attacker));
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1); // RID would be expirable
        attacker.configure(ReentrantActor.Attack.Expire, RID, true);
        uint256 driverBefore = driver.balance;

        _settle(RID, 14_500);

        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
        assertEq(driver.balance - driverBefore, DRIVER_PART, "driver refunded once, not the full deposit");
        assertEq(escrow.pendingWithdrawal(address(attacker)), HOST_PART);
        assertEq(escrow.pendingWithdrawal(driver), 0);
        assertEq(address(escrow).balance, HOST_PART);
    }

    function test_settle_maliciousHostReentersExpireSameId_swallow() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeWithHost(address(attacker));
        vm.warp(uint256(q.endTime) + escrow.SETTLEMENT_GRACE() + 1);
        attacker.configure(ReentrantActor.Attack.Expire, RID, false);
        uint256 driverBefore = driver.balance;

        _settle(RID, 14_500);

        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
        assertEq(address(attacker).balance, HOST_PART);
        assertEq(driver.balance - driverBefore, DRIVER_PART);
        assertEq(address(escrow).balance, 0);
    }

    /// Re-entering expire on a different, legitimately expirable reservation is also blocked.
    function test_settle_maliciousHostReentersExpireOtherId() public {
        IChargeMeshEscrow.ReservationQuote memory q = _activeWithHost(address(attacker));
        _reserve(_quoteFor(RID2, SLOT2));
        vm.warp(uint256(q.endTime) + 1); // RID2 (Reserved) is now expirable
        attacker.configure(ReentrantActor.Attack.Expire, RID2, false);

        _settle(RID, 20_000);
        assertTrue(attacker.attempted());
        assertFalse(attacker.succeeded());
        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
        _assertStatus(RID2, IChargeMeshEscrow.Status.Reserved);
        assertEq(address(escrow).balance, DEPOSIT, "RID2 deposit still escrowed");

        escrow.expire(RID2);
        _assertStatus(RID2, IChargeMeshEscrow.Status.Expired);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_maliciousHostReentersStartSession() public {
        _activeWithHost(address(attacker));
        _reserve(_quoteFor(RID2, SLOT2));
        _setSettler(address(attacker));
        attacker.configure(ReentrantActor.Attack.StartSession, RID2, false);

        attacker.doSettle(RID, 20_000, SESSION_HASH);
        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        _assertStatus(RID2, IChargeMeshEscrow.Status.Reserved);
    }

    /// Host with an existing pending balance re-enters withdraw while being paid by a second settle.
    function test_settle_maliciousHostReentersWithdraw() public {
        // First settlement: host rejects (bubble) => 0.145 deferred.
        _activeWithHost(address(attacker));
        attacker.configure(ReentrantActor.Attack.Settle, RID, true);
        _settle(RID, 14_500);
        assertEq(escrow.pendingWithdrawal(address(attacker)), HOST_PART);

        // Second reservation, host re-enters withdraw during the push (swallow).
        IChargeMeshEscrow.ReservationQuote memory q2 = _quoteFor(RID2, SLOT2);
        q2.host = address(attacker);
        _reserve(q2);
        _start(RID2);
        attacker.configure(ReentrantActor.Attack.Withdraw, bytes32(0), false);
        _settle(RID2, 20_000);

        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(address(attacker).balance, DEPOSIT, "second settlement pushed");
        assertEq(escrow.pendingWithdrawal(address(attacker)), HOST_PART, "pending untouched by re-entry");
        assertEq(address(escrow).balance, HOST_PART);

        attacker.configure(ReentrantActor.Attack.None, bytes32(0), false);
        attacker.doWithdraw();
        assertEq(address(attacker).balance, DEPOSIT + HOST_PART);
        assertEq(address(escrow).balance, 0);
    }

    // =====================================================================
    // Malicious driver during refunds
    // =====================================================================

    function test_cancel_maliciousDriverReentersCancel_bubble_refundDeferred() public {
        _reserveWithContractDriver(address(attacker));
        attacker.configure(ReentrantActor.Attack.Cancel, RID, true);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.PaymentDeferred(address(attacker), DEPOSIT);
        attacker.doCancel(RID);

        _assertStatus(RID, IChargeMeshEscrow.Status.Cancelled);
        assertFalse(escrow.isSlotTaken(SLOT));
        assertEq(address(attacker).balance, 0);
        assertEq(escrow.pendingWithdrawal(address(attacker)), DEPOSIT);
        assertEq(address(escrow).balance, DEPOSIT);
    }

    function test_cancel_maliciousDriverReentersCancel_swallow_refundedOnce() public {
        _reserveWithContractDriver(address(attacker));
        attacker.configure(ReentrantActor.Attack.Cancel, RID, false);

        attacker.doCancel(RID);

        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(attacker.receiveCount(), 1);
        assertEq(address(attacker).balance, DEPOSIT, "refunded exactly once");
        assertEq(escrow.pendingWithdrawal(address(attacker)), 0);
        assertEq(address(escrow).balance, 0);
    }

    function test_expire_maliciousDriverReentersExpire_bubble_refundDeferred() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveWithContractDriver(address(attacker));
        vm.warp(uint256(q.endTime) + 1);
        attacker.configure(ReentrantActor.Attack.Expire, RID, true);

        escrow.expire(RID);

        _assertStatus(RID, IChargeMeshEscrow.Status.Expired);
        assertEq(address(attacker).balance, 0);
        assertEq(escrow.pendingWithdrawal(address(attacker)), DEPOSIT);
        assertEq(address(escrow).balance, DEPOSIT);
    }

    function test_expire_maliciousDriverReentersExpire_swallow_refundedOnce() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveWithContractDriver(address(attacker));
        vm.warp(uint256(q.endTime) + 1);
        attacker.configure(ReentrantActor.Attack.Expire, RID, false);

        escrow.expire(RID);

        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(address(attacker).balance, DEPOSIT);
        assertEq(address(escrow).balance, 0);
    }

    function test_settle_maliciousDriverReentersSettle_onRefund() public {
        _reserveWithContractDriver(address(attacker));
        _start(RID);
        attacker.configure(ReentrantActor.Attack.Settle, RID, true);
        uint256 hostBefore = host.balance;

        _settle(RID, 14_500);

        assertEq(host.balance - hostBefore, HOST_PART, "host paid despite hostile driver");
        assertEq(address(attacker).balance, 0);
        assertEq(escrow.pendingWithdrawal(address(attacker)), DRIVER_PART);
        assertEq(address(escrow).balance, DRIVER_PART);
    }

    // =====================================================================
    // withdraw re-entrancy
    // =====================================================================

    function test_withdraw_reentrantWithdraw_bubble_revertsAndKeepsPending() public {
        _givePending(DEPOSIT);
        attacker.configure(ReentrantActor.Attack.Withdraw, bytes32(0), true);

        vm.expectRevert(IChargeMeshEscrow.TransferFailed.selector);
        attacker.doWithdraw();

        assertEq(escrow.pendingWithdrawal(address(attacker)), DEPOSIT);
        assertEq(address(attacker).balance, 0);
        assertEq(address(escrow).balance, DEPOSIT);
    }

    function test_withdraw_reentrantWithdraw_swallow_paysOnce() public {
        _givePending(DEPOSIT);
        attacker.configure(ReentrantActor.Attack.Withdraw, bytes32(0), false);

        attacker.doWithdraw();

        assertFalse(attacker.succeeded());
        assertEq(attacker.revertSelector(), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(attacker.receiveCount(), 1);
        assertEq(address(attacker).balance, DEPOSIT);
        assertEq(escrow.pendingWithdrawal(address(attacker)), 0);
        assertEq(address(escrow).balance, 0);
    }

    function test_withdraw_reentrantCancelOtherReservation_blocked() public {
        // Attacker holds a pending refund (RID) and a live reservation (RID2) as driver.
        _givePending(DEPOSIT);
        IChargeMeshEscrow.ReservationQuote memory q2 = _quoteFor(RID2, SLOT2);
        q2.driver = address(attacker);
        bytes memory sig = _sign(q2);
        vm.deal(address(this), DEPOSIT);
        attacker.doReserve{value: DEPOSIT}(q2, sig);

        attacker.configure(ReentrantActor.Attack.Cancel, RID2, false);
        attacker.doWithdraw();

        assertFalse(attacker.succeeded());
        _assertStatus(RID2, IChargeMeshEscrow.Status.Reserved);
        assertEq(address(attacker).balance, DEPOSIT);
        assertEq(address(escrow).balance, DEPOSIT);
    }

    // ---------- Helpers ----------

    /// @dev Attacker ends up with `DEPOSIT` in pendingWithdrawal via a bubbled cancel refund.
    function _givePending(uint256 expected) internal {
        _reserveWithContractDriver(address(attacker));
        attacker.configure(ReentrantActor.Attack.Cancel, RID, true);
        attacker.doCancel(RID);
        assertEq(escrow.pendingWithdrawal(address(attacker)), expected);
    }
}
