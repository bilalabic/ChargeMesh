// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ChargeMeshEscrow} from "../src/ChargeMeshEscrow.sol";
import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";

contract ChargeMeshEscrowTest is Test {
    event SettlerUpdated(address indexed previousSettler, address indexed newSettler);

    ChargeMeshEscrow internal escrow;
    address internal owner = makeAddr("owner");
    address internal settler = makeAddr("settler");
    address internal stranger = makeAddr("stranger");

    function setUp() public {
        escrow = new ChargeMeshEscrow(owner, settler);
    }

    // ---------- Constructor ----------

    function test_constructor_setsOwnerAndSettler() public view {
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), address(0));
        assertEq(escrow.settler(), settler);
    }

    function test_constructor_emitsSettlerUpdated() public {
        vm.expectEmit(true, true, false, false);
        emit SettlerUpdated(address(0), settler);
        new ChargeMeshEscrow(owner, settler);
    }

    function test_constructor_revertsOnZeroSettler() public {
        vm.expectRevert(IChargeMeshEscrow.ZeroAddress.selector);
        new ChargeMeshEscrow(owner, address(0));
    }

    function test_constructor_revertsOnZeroOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableInvalidOwner.selector, address(0)));
        new ChargeMeshEscrow(address(0), settler);
    }

    // ---------- Constants and views ----------

    function test_settlementGrace_isOneDay() public view {
        assertEq(escrow.SETTLEMENT_GRACE(), 1 days);
    }

    function test_views_defaultEmpty() public view {
        IChargeMeshEscrow.Reservation memory r = escrow.getReservation(keccak256("reservation:none"));
        assertEq(uint8(r.status), uint8(IChargeMeshEscrow.Status.None));
        assertEq(r.driver, address(0));
        assertFalse(escrow.isSlotTaken(keccak256("slot:none")));
    }

    // ---------- setSettler ----------

    function test_setSettler_updatesAndEmits() public {
        address next = makeAddr("nextSettler");
        vm.expectEmit(true, true, false, false, address(escrow));
        emit SettlerUpdated(settler, next);
        vm.prank(owner);
        escrow.setSettler(next);
        assertEq(escrow.settler(), next);
    }

    function test_setSettler_revertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.setSettler(stranger);
    }

    function test_setSettler_revertsForSettler() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, settler));
        vm.prank(settler);
        escrow.setSettler(stranger);
    }

    function test_setSettler_revertsOnZeroAddress() public {
        vm.expectRevert(IChargeMeshEscrow.ZeroAddress.selector);
        vm.prank(owner);
        escrow.setSettler(address(0));
    }

    function testFuzz_setSettler(address next) public {
        vm.assume(next != address(0));
        vm.prank(owner);
        escrow.setSettler(next);
        assertEq(escrow.settler(), next);
    }

    // ---------- Ownable2Step ----------

    function test_ownership_isTwoStep() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), newOwner);

        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
    }

    // ---------- M0 stubs ----------

    function test_m0_businessFunctionsRevertNotImplemented() public {
        IChargeMeshEscrow.ReservationQuote memory q;
        bytes32 id = keccak256("reservation:x");

        vm.expectRevert(ChargeMeshEscrow.NotImplemented.selector);
        escrow.reserve(q, "");
        vm.expectRevert(ChargeMeshEscrow.NotImplemented.selector);
        escrow.cancel(id);
        vm.expectRevert(ChargeMeshEscrow.NotImplemented.selector);
        escrow.expire(id);

        vm.startPrank(settler);
        vm.expectRevert(ChargeMeshEscrow.NotImplemented.selector);
        escrow.startSession(id);
        vm.expectRevert(ChargeMeshEscrow.NotImplemented.selector);
        escrow.settle(id, 1, bytes32(uint256(1)));
        vm.stopPrank();
    }

    function test_settlerFunctions_revertForNonSettler() public {
        bytes32 id = keccak256("reservation:x");
        vm.startPrank(stranger);
        vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
        escrow.startSession(id);
        vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
        escrow.settle(id, 1, bytes32(uint256(1)));
        vm.stopPrank();
    }

    // ---------- TODO(M1): docs/04-akilli-sozlesme.md "Test gereksinimleri" ----------
    // The functions below are placeholders (prefix `todo_`, so forge does not run them).
    // Each one must become a real `test_` / `testFuzz_` before M1 is done.
    // When implementing, delete test_m0_businessFunctionsRevertNotImplemented.

    // reserve: happy path and every revert condition
    function todo_reserve_happyPath() public {}
    function todo_reserve_revertsOnWrongSigner() public {}
    function todo_reserve_revertsOnIncorrectDeposit_msgValue() public {}
    function todo_reserve_revertsOnIncorrectDeposit_quoteDeposit() public {}
    function todo_reserve_revertsOnExpiredQuote() public {}
    function todo_reserve_revertsOnReusedReservationId() public {}
    function todo_reserve_revertsOnTakenSlotRef() public {}
    function todo_reserve_revertsWhenSenderIsNotDriver() public {}
    function todo_reserve_revertsOnInvalidQuote_startNotBeforeEnd() public {}
    function todo_reserve_revertsOnInvalidQuote_zeroRequestedWh() public {}

    // startSession and settle: exact balances for full / partial / over / zero delivery
    function todo_startSession_happyPath() public {}
    function todo_startSession_revertsForNonSettler() public {}
    function todo_startSession_revertsAfterEndTime() public {}
    function todo_settle_fullDelivery() public {}
    function todo_settle_partialDelivery() public {}
    function todo_settle_overDelivery() public {}
    function todo_settle_zeroDelivery() public {}
    function todo_settle_revertsOnZeroSessionHash() public {}
    function todo_settle_revertsForNonSettler() public {}
    function todo_settle_revertsWhenNotActive() public {}

    // cancel and expire: time boundaries with vm.warp
    function todo_cancel_beforeStartTime() public {}
    function todo_cancel_revertsAtOrAfterStartTime() public {}
    function todo_cancel_revertsForNonDriver() public {}
    function todo_expire_reservedAfterEndTime() public {}
    function todo_expire_reservedRevertsAtEndTime() public {}
    function todo_expire_activeAfterEndTimePlusGrace() public {}
    function todo_expire_activeRevertsAtEndTimePlusGrace() public {}
    function todo_expire_revertsForFinalStates() public {}

    // Reentrancy: malicious host contract cannot re-enter settle
    function todo_settle_maliciousHostCannotReenter() public {}

    // EIP-712 compatibility: covered by test/Eip712Compat.t.sol (fixture from packages/shared)

    // Fuzz: hostAmount + refund == deposit for random requestedWh, deliveredWh, pricePerKwhWei
    function todo_testFuzz_settle_conservesDeposit() public {}
}
