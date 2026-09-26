// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChargeMeshEscrow} from "../src/ChargeMeshEscrow.sol";
import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase} from "./utils/EscrowTestBase.sol";

/// @dev secp256k1 group order.
uint256 constant SECP256K1_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

contract ReserveTest is EscrowTestBase {
    // ---------- Happy path ----------

    function test_reserve_happyPath_storesReservation() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        uint256 driverBefore = driver.balance;

        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, sig);

        IChargeMeshEscrow.Reservation memory r = escrow.getReservation(RID);
        assertEq(r.slotRef, SLOT);
        assertEq(r.driver, driver);
        assertEq(r.host, host);
        assertEq(r.requestedWh, REQUESTED_WH);
        assertEq(r.deliveredWh, 0);
        assertEq(r.pricePerKwhWei, PRICE);
        assertEq(r.depositWei, DEPOSIT);
        assertEq(r.startTime, q.startTime);
        assertEq(r.endTime, q.endTime);
        assertEq(uint8(r.status), uint8(IChargeMeshEscrow.Status.Reserved));
        assertEq(r.sessionHash, bytes32(0));

        assertTrue(escrow.isSlotTaken(SLOT));
        assertEq(address(escrow).balance, DEPOSIT);
        assertEq(driver.balance, driverBefore - DEPOSIT);
    }

    function test_reserve_happyPath_emitsReservationCreated() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);

        vm.expectEmit(true, true, true, true, address(escrow));
        emit IChargeMeshEscrow.ReservationCreated(
            RID, SLOT, driver, host, REQUESTED_WH, PRICE, DEPOSIT, q.startTime, q.endTime
        );
        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, sig);
    }

    function test_reserve_demoDepositIsPointTwoMon() public pure {
        assertEq(DEPOSIT, 0.2 ether);
        assertEq(DEPOSIT, (uint256(REQUESTED_WH) * PRICE + 999) / 1000);
    }

    function test_reserve_depositRoundsUp() public {
        // 1 Wh at 1 wei/kWh => ceil(1/1000) = 1 wei.
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.requestedWh = 1;
        q.pricePerKwhWei = 1;
        q.depositWei = 1;
        _reserve(q);
        _assertStatus(RID, IChargeMeshEscrow.Status.Reserved);
        assertEq(address(escrow).balance, 1);
    }

    function test_reserve_depositRoundedDownReverts() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.requestedWh = 1;
        q.pricePerKwhWei = 1;
        q.depositWei = 0; // floor instead of ceil
        bytes memory sig = _sign(q);
        vm.expectRevert(IChargeMeshEscrow.IncorrectDeposit.selector);
        vm.prank(driver);
        escrow.reserve{value: 0}(q, sig);
    }

    function test_reserve_atQuoteExpiryBoundarySucceeds() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        vm.warp(q.quoteExpiry);
        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, sig);
        _assertStatus(RID, IChargeMeshEscrow.Status.Reserved);
    }

    function test_reserve_twoReservationsDifferentSlots() public {
        _reserve(_quoteFor(RID, SLOT));
        _reserve(_quoteFor(keccak256("reservation:2"), keccak256("slot:2")));
        assertEq(address(escrow).balance, 2 * uint256(DEPOSIT));
    }

    // ---------- 1. NotDriver ----------

    function test_reserve_revertsWhenSenderIsNotDriver() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        vm.deal(stranger, 1 ether);
        vm.expectRevert(IChargeMeshEscrow.NotDriver.selector);
        vm.prank(stranger);
        escrow.reserve{value: DEPOSIT}(q, sig);
    }

    function test_reserve_revertsWhenSettlerSubmitsDriverQuote() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        vm.deal(settler, 1 ether);
        vm.expectRevert(IChargeMeshEscrow.NotDriver.selector);
        vm.prank(settler);
        escrow.reserve{value: DEPOSIT}(q, sig);
    }

    // ---------- 2. QuoteExpired ----------

    function test_reserve_revertsOnExpiredQuote() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        vm.warp(uint256(q.quoteExpiry) + 1);
        vm.expectRevert(IChargeMeshEscrow.QuoteExpired.selector);
        vm.prank(driver);
        escrow.reserve{value: DEPOSIT}(q, sig);
    }

    // ---------- 3. InvalidQuote ----------

    function test_reserve_revertsOnInvalidQuote_startEqualsEnd() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.endTime = q.startTime;
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.InvalidQuote.selector);
    }

    function test_reserve_revertsOnInvalidQuote_startAfterEnd() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.startTime = q.endTime + 1;
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.InvalidQuote.selector);
    }

    function test_reserve_revertsOnInvalidQuote_zeroRequestedWh() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.requestedWh = 0;
        q.depositWei = 0; // ceil(0) == 0, so only requestedWh is wrong
        _expectReserveRevert(q, _sign(q), 0, IChargeMeshEscrow.InvalidQuote.selector);
    }

    function test_reserve_revertsOnInvalidQuote_zeroHost() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.host = address(0);
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.InvalidQuote.selector);
    }

    // ---------- 4. IncorrectDeposit ----------

    function test_reserve_revertsOnIncorrectDeposit_quoteDepositTooHigh() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.depositWei = DEPOSIT + 1; // correctly signed, but not ceil(wh*price/1000)
        _expectReserveRevert(q, _sign(q), DEPOSIT + 1, IChargeMeshEscrow.IncorrectDeposit.selector);
    }

    function test_reserve_revertsOnIncorrectDeposit_quoteDepositTooLow() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.depositWei = DEPOSIT - 1;
        _expectReserveRevert(q, _sign(q), DEPOSIT - 1, IChargeMeshEscrow.IncorrectDeposit.selector);
    }

    function test_reserve_revertsOnIncorrectDeposit_msgValueTooLow() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        _expectReserveRevert(q, _sign(q), DEPOSIT - 1, IChargeMeshEscrow.IncorrectDeposit.selector);
    }

    function test_reserve_revertsOnIncorrectDeposit_msgValueTooHigh() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        _expectReserveRevert(q, _sign(q), DEPOSIT + 1, IChargeMeshEscrow.IncorrectDeposit.selector);
    }

    function test_reserve_revertsOnIncorrectDeposit_zeroMsgValue() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        _expectReserveRevert(q, _sign(q), 0, IChargeMeshEscrow.IncorrectDeposit.selector);
    }

    function testFuzz_reserve_revertsOnAnyWrongMsgValue(uint256 value) public {
        value = bound(value, 0, 10 ether);
        vm.assume(value != DEPOSIT);
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        _expectReserveRevert(q, _sign(q), value, IChargeMeshEscrow.IncorrectDeposit.selector);
    }

    // ---------- 5. InvalidSignature ----------

    function test_reserve_revertsOnWrongSigner() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        (, uint256 otherPk) = makeAddrAndKey("notSettler");
        _expectReserveRevert(q, _signWith(otherPk, q), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsWhenDriverSignsOwnQuote() public {
        (address selfDriver, uint256 selfPk) = makeAddrAndKey("selfSigningDriver");
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.driver = selfDriver;
        vm.deal(selfDriver, 1 ether);
        _expectReserveRevert(q, _signWith(selfPk, q), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnTamperedField_host() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        q.host = stranger;
        _expectReserveRevert(q, sig, DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnTamperedField_slotRef() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        q.slotRef = keccak256("slot:other");
        _expectReserveRevert(q, sig, DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnTamperedField_reservationId() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        q.reservationId = keccak256("reservation:other");
        _expectReserveRevert(q, sig, DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnTamperedField_priceAndDeposit() public {
        // Driver halves the price and adjusts the deposit consistently: deposit check passes, signature fails.
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        q.pricePerKwhWei = PRICE / 2;
        q.depositWei = DEPOSIT / 2;
        _expectReserveRevert(q, sig, DEPOSIT / 2, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnTamperedField_times() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        q.endTime += 1 days;
        _expectReserveRevert(q, sig, DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);

        q = _quote();
        q.quoteExpiry += 1 days;
        _expectReserveRevert(q, sig, DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnSignatureFromOtherContractDomain() public {
        // Same quote, signed for a different verifying contract.
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        ChargeMeshEscrow other = new ChargeMeshEscrow(owner, settler);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(settlerPk, other.hashQuote(q));
        assertTrue(other.hashQuote(q) != escrow.hashQuote(q));
        _expectReserveRevert(q, abi.encodePacked(r, s, v), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnEmptySignature() public {
        _expectReserveRevert(_quote(), "", DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnShortSignature() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        bytes memory short = new bytes(64);
        for (uint256 i = 0; i < 64; i++) {
            short[i] = sig[i];
        }
        _expectReserveRevert(q, short, DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnLongSignature() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory longSig = bytes.concat(_sign(q), bytes1(0x00));
        _expectReserveRevert(q, longSig, DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnCompactEip2098Signature() public {
        // 64-byte (r, vs) form is not accepted by the bytes overload: treated as malformed.
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(settlerPk, escrow.hashQuote(q));
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        _expectReserveRevert(q, abi.encodePacked(r, vs), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnZeroedSignature() public {
        _expectReserveRevert(_quote(), new bytes(65), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnInvalidV() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        (, bytes32 r, bytes32 s) = vm.sign(settlerPk, escrow.hashQuote(q));
        _expectReserveRevert(q, abi.encodePacked(r, s, uint8(29)), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_revertsOnHighSMalleableSignature() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(settlerPk, escrow.hashQuote(q));
        bytes32 highS = bytes32(SECP256K1_N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        // Sanity: the malleable twin recovers the settler via raw ecrecover.
        assertEq(ecrecover(escrow.hashQuote(q), flippedV, r, highS), settler);
        _expectReserveRevert(
            q, abi.encodePacked(r, highS, flippedV), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector
        );
    }

    // ---------- 6. ReservationExists ----------

    function test_reserve_revertsOnReusedReservationId_sameSlot() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        // Same id and slot: ReservationExists is checked before SlotAlreadyTaken.
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.ReservationExists.selector);
    }

    function test_reserve_revertsOnReusedReservationId_differentSlot() public {
        _reserveDefault();
        IChargeMeshEscrow.ReservationQuote memory q = _quoteFor(RID, keccak256("slot:2"));
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.ReservationExists.selector);
    }

    function test_reserve_revertsOnReusedReservationId_afterCancel() public {
        _reserveDefault();
        vm.prank(driver);
        escrow.cancel(RID);
        // Slot is free again, but the id is permanently used.
        assertFalse(escrow.isSlotTaken(SLOT));
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.ReservationExists.selector);
    }

    // ---------- 7. SlotAlreadyTaken ----------

    function test_reserve_revertsOnTakenSlotRef() public {
        _reserveDefault();
        IChargeMeshEscrow.ReservationQuote memory q = _quoteFor(keccak256("reservation:2"), SLOT);
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.SlotAlreadyTaken.selector);
    }

    function test_reserve_revertsOnTakenSlotRef_otherDriver() public {
        _reserveDefault();
        address driver2 = makeAddr("driver2");
        IChargeMeshEscrow.ReservationQuote memory q = _quoteFor(keccak256("reservation:2"), SLOT);
        q.driver = driver2;
        vm.deal(driver2, 1 ether);
        _expectReserveRevert(q, _sign(q), DEPOSIT, IChargeMeshEscrow.SlotAlreadyTaken.selector);
    }

    // ---------- Check order (first failing check wins) ----------

    function test_reserve_order_notDriverBeforeQuoteExpired() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        bytes memory sig = _sign(q);
        vm.warp(uint256(q.quoteExpiry) + 1);
        vm.deal(stranger, 1 ether);
        vm.expectRevert(IChargeMeshEscrow.NotDriver.selector);
        vm.prank(stranger);
        escrow.reserve{value: DEPOSIT}(q, sig);
    }

    function test_reserve_order_notDriverBeforeEverything() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault(); // id + slot now taken
        q.host = address(0);
        q.depositWei = 1;
        vm.warp(uint256(q.quoteExpiry) + 1);
        vm.deal(stranger, 1 ether);
        vm.expectRevert(IChargeMeshEscrow.NotDriver.selector);
        vm.prank(stranger);
        escrow.reserve{value: 0}(q, "");
    }

    function test_reserve_order_quoteExpiredBeforeInvalidQuote() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.requestedWh = 0;
        bytes memory sig = _sign(q);
        vm.warp(uint256(q.quoteExpiry) + 1);
        _expectReserveRevert(q, sig, 0, IChargeMeshEscrow.QuoteExpired.selector);
    }

    function test_reserve_order_invalidQuoteBeforeIncorrectDeposit() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.host = address(0);
        q.depositWei = 1;
        _expectReserveRevert(q, _sign(q), 7, IChargeMeshEscrow.InvalidQuote.selector);
    }

    function test_reserve_order_incorrectDepositBeforeInvalidSignature() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        _expectReserveRevert(q, "", DEPOSIT - 1, IChargeMeshEscrow.IncorrectDeposit.selector);
    }

    function test_reserve_order_invalidSignatureBeforeReservationExists() public {
        IChargeMeshEscrow.ReservationQuote memory q = _reserveDefault();
        (, uint256 otherPk) = makeAddrAndKey("notSettler");
        _expectReserveRevert(q, _signWith(otherPk, q), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    function test_reserve_order_invalidSignatureBeforeSlotAlreadyTaken() public {
        _reserveDefault();
        IChargeMeshEscrow.ReservationQuote memory q = _quoteFor(keccak256("reservation:2"), SLOT);
        _expectReserveRevert(q, new bytes(65), DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
    }

    // ---------- Failed reserve leaves no trace ----------

    function test_reserve_revertLeavesStateUntouched() public {
        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        _expectReserveRevert(q, "", DEPOSIT, IChargeMeshEscrow.InvalidSignature.selector);
        _assertStatus(RID, IChargeMeshEscrow.Status.None);
        assertFalse(escrow.isSlotTaken(SLOT));
        assertEq(address(escrow).balance, 0);
    }

    // ---------- Helpers ----------

    function _expectReserveRevert(
        IChargeMeshEscrow.ReservationQuote memory q,
        bytes memory sig,
        uint256 value,
        bytes4 selector
    ) internal {
        vm.deal(q.driver, q.driver.balance + value);
        vm.expectRevert(selector);
        vm.prank(q.driver);
        escrow.reserve{value: value}(q, sig);
    }
}
