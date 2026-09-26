// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

import {ChargeMeshEscrow} from "../src/ChargeMeshEscrow.sol";
import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";

/// @notice Constructor, views, settler rotation and ownership.
contract ChargeMeshEscrowTest is EscrowTestBase {
    // ---------- Constructor ----------

    function test_constructor_setsOwnerAndSettler() public view {
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), address(0));
        assertEq(escrow.settler(), settler);
    }

    function test_constructor_emitsSettlerUpdated() public {
        vm.expectEmit(true, true, false, false);
        emit IChargeMeshEscrow.SettlerUpdated(address(0), settler);
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
        assertEq(escrow.SETTLEMENT_GRACE(), 86_400);
    }

    function test_views_defaultEmpty() public view {
        IChargeMeshEscrow.Reservation memory r = escrow.getReservation(keccak256("reservation:none"));
        assertEq(uint8(r.status), uint8(IChargeMeshEscrow.Status.None));
        assertEq(r.driver, address(0));
        assertFalse(escrow.isSlotTaken(keccak256("slot:none")));
        assertEq(escrow.pendingWithdrawal(driver), 0);
    }

    function test_hashQuote_isDeterministicAndFieldSensitive() public view {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes32 h = escrow.hashQuote(q);
        assertEq(escrow.hashQuote(q), h);
        q.requestedWh += 1;
        assertTrue(escrow.hashQuote(q) != h);
    }

    function test_rejectsPlainEtherTransfers() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(escrow).call{value: 1 ether}("");
        assertFalse(ok, "escrow has no receive/fallback");
        assertEq(address(escrow).balance, 0);
    }

    // ---------- setSettler ----------

    function test_setSettler_updatesAndEmits() public {
        address next = makeAddr("nextSettler");
        vm.expectEmit(true, true, false, false, address(escrow));
        emit IChargeMeshEscrow.SettlerUpdated(settler, next);
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

    function test_setSettler_oldSignaturesInvalid_newSignaturesValid() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory oldSig = _sign(q);

        (address newSettler, uint256 newPk) = makeAddrAndKey("newSettler");
        _setSettler(newSettler);

        vm.expectRevert(IChargeMeshEscrow.InvalidSignature.selector);
        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, oldSig);

        bytes memory newSig = _signWith(newPk, q);
        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, newSig);
        _assertStatus(RID, IChargeMeshEscrow.Status.Reserved);
    }

    function test_setSettler_movesSettlerRights() public {
        _reserveDefault();
        address newSettler = makeAddr("newSettler");
        _setSettler(newSettler);

        vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
        vm.prank(settler);
        escrow.startSession(RID);

        vm.prank(newSettler);
        escrow.startSession(RID);

        vm.expectRevert(IChargeMeshEscrow.NotSettler.selector);
        vm.prank(settler);
        escrow.settle(RID, 1, SESSION_HASH);

        vm.prank(newSettler);
        escrow.settle(RID, 20_000, SESSION_HASH);
        _assertStatus(RID, IChargeMeshEscrow.Status.Settled);
    }

    function test_setSettler_existingReservationsSurviveRotation() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        _setSettler(makeAddr("newSettler"));
        vm.warp(uint256(q.endTime) + 1);
        uint256 before = driver.balance;
        escrow.expire(RID);
        assertEq(driver.balance - before, DEPOSIT);
    }

    // ---------- Ownable2Step ----------

    function test_ownership_isTwoStep() public {
        address newOwner = makeAddr("newOwner");
        vm.prank(owner);
        escrow.transferOwnership(newOwner);
        assertEq(escrow.owner(), owner);
        assertEq(escrow.pendingOwner(), newOwner);

        // Pending owner has no rights yet.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        vm.prank(newOwner);
        escrow.setSettler(newOwner);

        vm.prank(newOwner);
        escrow.acceptOwnership();
        assertEq(escrow.owner(), newOwner);
        assertEq(escrow.pendingOwner(), address(0));

        // Previous owner lost its rights; the new owner has them.
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, owner));
        vm.prank(owner);
        escrow.setSettler(owner);

        vm.prank(newOwner);
        escrow.setSettler(stranger);
        assertEq(escrow.settler(), stranger);
    }

    function test_ownership_onlyPendingOwnerCanAccept() public {
        vm.prank(owner);
        escrow.transferOwnership(makeAddr("newOwner"));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.acceptOwnership();
    }

    function test_ownership_transferOnlyByOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.transferOwnership(stranger);
    }

    // ---------- renounceOwnership disabled ----------

    function test_renounceOwnership_revertsForOwner() public {
        vm.expectRevert(IChargeMeshEscrow.RenounceDisabled.selector);
        vm.prank(owner);
        escrow.renounceOwnership();
        assertEq(escrow.owner(), owner);
    }

    function test_renounceOwnership_revertsForNonOwner() public {
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        vm.prank(stranger);
        escrow.renounceOwnership();
    }
}
