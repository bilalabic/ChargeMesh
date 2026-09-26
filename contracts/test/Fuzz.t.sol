// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowTestBase, UnitsOracle} from "./utils/EscrowTestBase.sol";
import {ToggleReceiver} from "./utils/Actors.sol";

contract FuzzTest is EscrowTestBase {
    /// @dev Spec requirement: hostAmount + refund == deposit for random inputs; matches units.ts oracle.
    function testFuzz_settle_conservesDeposit(uint32 requestedWh, uint32 deliveredWh, uint128 price) public {
        requestedWh = uint32(bound(requestedWh, 1, 100_000));
        price = uint128(bound(price, 1, 1e24));
        _runAndCheck(requestedWh, deliveredWh, price);
    }

    /// @dev Full-domain variant: any requestedWh, any price whose deposit still fits in uint128.
    function testFuzz_settle_conservesDeposit_fullRange(uint32 requestedWh, uint32 deliveredWh, uint128 price) public {
        requestedWh = uint32(bound(requestedWh, 1, type(uint32).max));
        uint256 maxPrice = (uint256(type(uint128).max) * 1000) / requestedWh;
        if (maxPrice > type(uint128).max) maxPrice = type(uint128).max;
        price = uint128(bound(price, 1, maxPrice));
        vm.assume(UnitsOracle.depositFor(requestedWh, price) <= type(uint128).max);
        _runAndCheck(requestedWh, deliveredWh, price);
    }

    /// @dev With rejecting host and/or driver, everything not pushed sits in pendingWithdrawal and
    ///      escrow balance == sum of pending withdrawals.
    function testFuzz_settle_rejectingRecipients_escrowEqualsPending(
        uint32 requestedWh,
        uint32 deliveredWh,
        uint128 price,
        bool hostRejects,
        bool driverRejects
    ) public {
        requestedWh = uint32(bound(requestedWh, 1, 100_000));
        price = uint128(bound(price, 1, 1e24));
        uint128 deposit = uint128(UnitsOracle.depositFor(requestedWh, price));
        (, uint256 expHost, uint256 expRefund) = UnitsOracle.computeSettlement(requestedWh, deliveredWh, price, deposit);

        ToggleReceiver hostC = new ToggleReceiver(escrow);
        ToggleReceiver driverC = new ToggleReceiver(escrow);
        hostC.setAccepting(!hostRejects);
        driverC.setAccepting(!driverRejects);

        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.driver = address(driverC);
        q.host = address(hostC);
        q.requestedWh = requestedWh;
        q.pricePerKwhWei = price;
        q.depositWei = deposit;
        bytes memory sig = _sign(q);
        vm.deal(address(this), deposit);
        driverC.doReserve{value: deposit}(q, sig);
        _start(RID);
        _settle(RID, deliveredWh);

        uint256 pendingHost = escrow.pendingWithdrawal(address(hostC));
        uint256 pendingDriver = escrow.pendingWithdrawal(address(driverC));
        assertEq(address(escrow).balance, pendingHost + pendingDriver, "escrow == sum(pending)");
        assertEq(pendingHost, hostRejects ? expHost : 0);
        assertEq(pendingDriver, driverRejects ? expRefund : 0);
        assertEq(address(hostC).balance + pendingHost, expHost);
        assertEq(address(driverC).balance + pendingDriver, expRefund);

        // Everyone can pull out; escrow ends empty.
        hostC.setAccepting(true);
        driverC.setAccepting(true);
        if (pendingHost > 0) hostC.doWithdraw();
        if (pendingDriver > 0) driverC.doWithdraw();
        assertEq(address(escrow).balance, 0);
        assertEq(address(hostC).balance, expHost);
        assertEq(address(driverC).balance, expRefund);
    }

    /// @dev Deposit must be exactly ceil(wh * price / 1000); any other signed value is rejected.
    function testFuzz_reserve_rejectsNonCeilDeposit(uint32 requestedWh, uint128 price, uint128 deposit) public {
        requestedWh = uint32(bound(requestedWh, 1, 100_000));
        price = uint128(bound(price, 1, 1e24));
        uint256 correct = UnitsOracle.depositFor(requestedWh, price);
        deposit = uint128(bound(deposit, 0, correct * 2 + 1));
        vm.assume(deposit != correct);

        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.requestedWh = requestedWh;
        q.pricePerKwhWei = price;
        q.depositWei = deposit;
        bytes memory sig = _sign(q);
        vm.deal(driver, uint256(deposit));
        vm.expectRevert(IChargeMeshEscrow.IncorrectDeposit.selector);
        vm.prank(driver);
        escrow.reserve{value: deposit}(q, sig);
    }

    /// @dev Oracle self-check: hostAmount never exceeds deposit and host+refund == deposit.
    function testFuzz_oracle_invariants(uint32 requestedWh, uint32 deliveredWh, uint128 price) public pure {
        requestedWh = uint32(bound(requestedWh, 1, type(uint32).max));
        uint256 deposit = UnitsOracle.depositFor(requestedWh, price);
        (uint256 billable, uint256 h, uint256 r) =
            UnitsOracle.computeSettlement(requestedWh, deliveredWh, price, deposit);
        assertLe(billable, requestedWh);
        assertLe(h, deposit);
        assertEq(h + r, deposit);
        // For a valid deposit the cap never actually bites: cost(requested) <= ceil(...).
        assertEq(h, UnitsOracle.costFor(billable, price));
    }

    // ---------- Helpers ----------

    function _runAndCheck(uint32 requestedWh, uint32 deliveredWh, uint128 price) internal {
        uint128 deposit = uint128(UnitsOracle.depositFor(requestedWh, price));
        (uint256 expBillable, uint256 expHost, uint256 expRefund) =
            UnitsOracle.computeSettlement(requestedWh, deliveredWh, price, deposit);

        IChargeMeshEscrow.ReservationQuote memory q = _quote();
        q.requestedWh = requestedWh;
        q.pricePerKwhWei = price;
        q.depositWei = deposit;
        _reserve(q);
        _start(RID);

        uint256 hostBefore = host.balance;
        uint256 driverBefore = driver.balance;
        uint256 escrowBefore = address(escrow).balance;
        assertEq(escrowBefore, deposit);

        vm.expectEmit(true, false, false, true, address(escrow));
        emit IChargeMeshEscrow.ReservationSettled(
            RID, deliveredWh, uint32(expBillable), uint128(expHost), uint128(expRefund), SESSION_HASH
        );
        _settle(RID, deliveredWh);

        uint256 hostDelta = host.balance - hostBefore;
        uint256 driverDelta = driver.balance - driverBefore;

        assertEq(hostDelta + driverDelta, deposit, "hostAmount + refund == deposit");
        assertEq(hostDelta, expHost, "hostAmount == min(billable*price/1000, deposit)");
        assertEq(driverDelta, expRefund, "refund");
        assertLe(hostDelta, deposit);
        assertEq(address(escrow).balance, 0, "escrow drained");
        assertEq(escrow.pendingWithdrawal(host), 0);
        assertEq(escrow.pendingWithdrawal(driver), 0);
        assertEq(escrow.getReservation(RID).deliveredWh, deliveredWh);
    }
}
