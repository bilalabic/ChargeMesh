// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {console2} from "forge-std/console2.sol";

import {IChargeMeshEscrow} from "../../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase, UnitsOracle} from "../utils/EscrowTestBase.sol";
import {EscrowHandler} from "./EscrowHandler.sol";

/// @notice Stateful invariant suite for {ChargeMeshEscrow}. Actions live in {EscrowHandler}.
contract EscrowInvariantsTest is EscrowTestBase {
    EscrowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new EscrowHandler(escrow, settler, settlerPk);

        bytes4[] memory selectors = new bytes4[](8);
        selectors[0] = EscrowHandler.reserve.selector;
        selectors[1] = EscrowHandler.startSession.selector;
        selectors[2] = EscrowHandler.settle.selector;
        selectors[3] = EscrowHandler.cancel.selector;
        selectors[4] = EscrowHandler.expire.selector;
        selectors[5] = EscrowHandler.withdraw.selector;
        selectors[6] = EscrowHandler.toggle.selector;
        selectors[7] = EscrowHandler.warp.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    // ---------- Funds ----------

    /// @dev No stuck or missing MON: the escrow holds exactly the open deposits plus what is owed.
    function invariant_balanceEqualsOpenDepositsPlusPending() public view {
        assertEq(
            address(escrow).balance,
            handler.ghostOpenDeposits() + handler.ghostPendingWithdrawals(),
            "balance == openDeposits + pendingWithdrawals"
        );
    }

    /// @dev Everything that came in is either still open, owed, or paid out.
    function invariant_accountingIdentity() public view {
        assertEq(
            handler.ghostDeposited(),
            handler.ghostOpenDeposits() + handler.ghostPendingWithdrawals() + handler.ghostPaidOut(),
            "deposited == open + pending + paidOut"
        );
    }

    /// @dev Per-actor pendingWithdrawal matches the independent push/defer prediction.
    function invariant_pendingMatchesGhost() public view {
        uint256 sum;
        uint256 n = handler.actorsLength();
        for (uint256 i; i < n; ++i) {
            address a = handler.actors(i);
            uint256 p = escrow.pendingWithdrawal(a);
            assertEq(p, handler.ghostPendingOf(a), "pendingWithdrawal(actor) == ghost");
            sum += p;
        }
        assertEq(sum, handler.ghostPendingWithdrawals(), "sum(pendingWithdrawal) == ghost");
        assertEq(handler.receiptMismatches(), 0, handler.lastViolation());
    }

    /// @dev The ghost sum of open deposits agrees with the escrow's own Reserved/Active records.
    function invariant_openDepositsMatchState() public view {
        uint256 open;
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            IChargeMeshEscrow.Reservation memory r = escrow.getReservation(handler.ids(i));
            if (r.status == IChargeMeshEscrow.Status.Reserved || r.status == IChargeMeshEscrow.Status.Active) {
                open += r.depositWei;
            }
        }
        assertEq(open, handler.ghostOpenDeposits(), "sum(deposit | Reserved|Active) == ghost");
    }

    // ---------- Settlement math ----------

    /// @dev Settled => host + refund == deposit and host == min(billable * price / 1000, deposit).
    ///      Cancelled/Expired => the driver got the full deposit back and the host nothing.
    function invariant_settlementMath() public view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            bytes32 id = handler.ids(i);
            IChargeMeshEscrow.Reservation memory r = escrow.getReservation(id);
            uint256 hostGot = handler.ghostHostReceived(id);
            uint256 driverGot = handler.ghostDriverReceived(id);
            assertEq(r.depositWei, handler.ghostDepositOf(id), "stored deposit");
            assertEq(r.depositWei, UnitsOracle.depositFor(r.requestedWh, r.pricePerKwhWei), "deposit == ceil");

            if (r.status == IChargeMeshEscrow.Status.Settled) {
                (, uint256 expHost, uint256 expRefund) =
                    UnitsOracle.computeSettlement(r.requestedWh, r.deliveredWh, r.pricePerKwhWei, r.depositWei);
                assertEq(r.deliveredWh, handler.ghostDeliveredArg(id), "deliveredWh stored");
                assertTrue(r.sessionHash != bytes32(0), "sessionHash set");
                assertEq(hostGot + driverGot, r.depositWei, "hostPaid + refund == deposit");
                assertEq(hostGot, expHost, "hostPaid == min(billable*price/1000, deposit)");
                assertEq(driverGot, expRefund, "refund == deposit - hostPaid");
                assertLe(hostGot, r.depositWei, "hostPaid <= deposit");
            } else if (r.status == IChargeMeshEscrow.Status.Cancelled || r.status == IChargeMeshEscrow.Status.Expired) {
                assertEq(driverGot, r.depositWei, "full refund");
                assertEq(hostGot, 0, "host unpaid");
            } else {
                assertEq(hostGot + driverGot, 0, "nothing paid while open");
            }
        }
    }

    // ---------- Slots ----------

    /// @dev slotTaken[slot] <=> some reservation on it is Reserved/Active/Settled, and at most one is.
    function invariant_slotTakenMatchesReservations() public view {
        bytes32[12] memory pool = handler.slotPool();
        uint256 n = handler.idsLength();
        for (uint256 s; s < pool.length; ++s) {
            uint256 holders;
            for (uint256 i; i < n; ++i) {
                bytes32 id = handler.ids(i);
                IChargeMeshEscrow.Reservation memory r = escrow.getReservation(id);
                if (r.slotRef != pool[s]) continue;
                if (
                    r.status == IChargeMeshEscrow.Status.Reserved || r.status == IChargeMeshEscrow.Status.Active
                        || r.status == IChargeMeshEscrow.Status.Settled
                ) holders++;
            }
            assertLe(holders, 1, "at most one holder per slot");
            assertEq(escrow.isSlotTaken(pool[s]), holders == 1, "slotTaken <=> holder exists");
        }
    }

    // ---------- State machine ----------

    /// @dev Only None->Reserved->{Active,Cancelled,Expired}, Active->{Settled,Expired}; terminal is final.
    function invariant_stateMachine() public view {
        assertEq(handler.badTransitions(), 0, handler.lastViolation());
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            bytes32 id = handler.ids(i);
            // The handler syncs after every action, so the escrow can never be ahead of it.
            assertEq(uint8(escrow.getReservation(id).status), uint8(handler.lastSeen(id)), "status in sync");
        }
    }

    /// @dev A reservationId is accepted by reserve() at most once, even after it became terminal.
    function invariant_noReservationIdReuse() public view {
        assertEq(handler.idReuses(), 0, handler.lastViolation());
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; ++i) {
            assertEq(handler.ghostReserveCount(handler.ids(i)), 1, "reserve count == 1");
        }
    }

    // ---------- Summary ----------

    function afterInvariant() public view {
        string[8] memory names = ["reserve", "startSession", "settle", "cancel", "expire", "withdraw", "toggle", "warp"];
        console2.log("---- EscrowHandler call summary (calls / successes) ----");
        for (uint256 i; i < names.length; ++i) {
            bytes32 key = bytes32(bytes(names[i]));
            console2.log(names[i], handler.calls(key), handler.successes(key));
        }
        console2.log(
            "reserve reverts ReservationExists/SlotAlreadyTaken:",
            handler.reserveErrors(IChargeMeshEscrow.ReservationExists.selector),
            handler.reserveErrors(IChargeMeshEscrow.SlotAlreadyTaken.selector)
        );
        console2.log("reservations:", handler.idsLength());
        console2.log("Reserved/Active/Settled:", handler.statusCount(1), handler.statusCount(2), handler.statusCount(3));
        console2.log("Cancelled/Expired:", handler.statusCount(4), handler.statusCount(5));
        console2.log("open deposits:", handler.ghostOpenDeposits());
        console2.log("pending withdrawals:", handler.ghostPendingWithdrawals());
        console2.log("paid out:", handler.ghostPaidOut());
    }
}
