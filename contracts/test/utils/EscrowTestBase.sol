// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";

import {ChargeMeshEscrow} from "../../src/ChargeMeshEscrow.sol";
import {IChargeMeshEscrow} from "../../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowActor} from "./Actors.sol";

/// @notice Solidity port of shared/src/units.ts, used as the test oracle.
library UnitsOracle {
    uint256 internal constant WH_PER_KWH = 1000;

    /// @dev ceil(wh * pricePerKwhWei / 1000)
    function depositFor(uint256 wh, uint256 pricePerKwhWei) internal pure returns (uint256) {
        return (wh * pricePerKwhWei + WH_PER_KWH - 1) / WH_PER_KWH;
    }

    /// @dev floor(wh * pricePerKwhWei / 1000)
    function costFor(uint256 wh, uint256 pricePerKwhWei) internal pure returns (uint256) {
        return (wh * pricePerKwhWei) / WH_PER_KWH;
    }

    function computeSettlement(uint256 requestedWh, uint256 deliveredWh, uint256 pricePerKwhWei, uint256 depositWei)
        internal
        pure
        returns (uint256 billableWh, uint256 hostAmountWei, uint256 refundWei)
    {
        billableWh = deliveredWh < requestedWh ? deliveredWh : requestedWh;
        uint256 raw = costFor(billableWh, pricePerKwhWei);
        hostAmountWei = raw < depositWei ? raw : depositWei;
        refundWei = depositWei - hostAmountWei;
    }
}

/// @notice Shared fixture: escrow + settler key + funded driver + quote/sign/reserve helpers.
/// @dev Demo numbers: 20 kWh at 0.01 MON/kWh => deposit 0.2 MON.
abstract contract EscrowTestBase is Test {
    uint32 internal constant REQUESTED_WH = 20_000;
    uint128 internal constant PRICE = 1e16; // wei per kWh
    uint128 internal constant DEPOSIT = 2e17; // ceil(20000 * 1e16 / 1000)
    uint256 internal constant T0 = 1_700_000_000;

    bytes32 internal constant RID = keccak256("reservation:1");
    bytes32 internal constant SLOT = keccak256("slot:1");
    bytes32 internal constant SESSION_HASH = keccak256("session:1");

    ChargeMeshEscrow internal escrow;

    address internal owner;
    address internal settler;
    uint256 internal settlerPk;
    address internal driver;
    address internal host;
    address internal stranger;

    function setUp() public virtual {
        vm.warp(T0);
        owner = makeAddr("owner");
        (settler, settlerPk) = makeAddrAndKey("settler");
        driver = makeAddr("driver");
        host = makeAddr("host");
        stranger = makeAddr("stranger");

        escrow = new ChargeMeshEscrow(owner, settler);
        vm.deal(driver, 100 ether);
    }

    // ---------- Quote building ----------

    /// @dev Valid demo quote for RID/SLOT relative to the current block time.
    function _quote() internal view returns (IChargeMeshEscrow.ReservationQuote memory) {
        return _quoteFor(RID, SLOT);
    }

    function _quoteFor(bytes32 reservationId, bytes32 slotRef)
        internal
        view
        returns (IChargeMeshEscrow.ReservationQuote memory q)
    {
        q = IChargeMeshEscrow.ReservationQuote({
            reservationId: reservationId,
            slotRef: slotRef,
            driver: driver,
            host: host,
            requestedWh: REQUESTED_WH,
            pricePerKwhWei: PRICE,
            depositWei: DEPOSIT,
            startTime: uint64(vm.getBlockTimestamp() + 1 hours),
            endTime: uint64(vm.getBlockTimestamp() + 3 hours),
            quoteExpiry: uint64(vm.getBlockTimestamp() + 5 minutes)
        });
    }

    function _sign(IChargeMeshEscrow.ReservationQuote memory q) internal view returns (bytes memory) {
        return _signWith(settlerPk, q);
    }

    function _signWith(uint256 pk, IChargeMeshEscrow.ReservationQuote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, escrow.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    // ---------- Actions ----------

    function _reserve(IChargeMeshEscrow.ReservationQuote memory q) internal {
        bytes memory sig = _sign(q);
        vm.deal(q.driver, q.driver.balance + q.depositWei);
        vm.prank(q.driver);
        escrow.reserve{value: q.depositWei}(q, sig);
    }

    function _reserveDefault() internal returns (IChargeMeshEscrow.ReservationQuote memory q) {
        q = _quote();
        _reserve(q);
    }

    function _start(bytes32 reservationId) internal {
        vm.prank(settler);
        escrow.startSession(reservationId);
    }

    function _settle(bytes32 reservationId, uint32 deliveredWh) internal {
        vm.prank(settler);
        escrow.settle(reservationId, deliveredWh, SESSION_HASH);
    }

    /// @dev Reserve + start the default quote.
    function _activeDefault() internal returns (IChargeMeshEscrow.ReservationQuote memory q) {
        q = _reserveDefault();
        _start(q.reservationId);
    }

    /// @dev Reserve + start the default quote with a custom host.
    function _activeWithHost(address host_) internal returns (IChargeMeshEscrow.ReservationQuote memory q) {
        q = _quote();
        q.host = host_;
        _reserve(q);
        _start(q.reservationId);
    }

    /// @dev Reserve the default quote with a contract account as driver.
    function _reserveWithContractDriver(address actor) internal returns (IChargeMeshEscrow.ReservationQuote memory q) {
        q = _quote();
        q.driver = actor;
        bytes memory sig = _sign(q);
        vm.deal(address(this), address(this).balance + DEPOSIT);
        EscrowActor(actor).doReserve{value: DEPOSIT}(q, sig);
    }

    function _setSettler(address newSettler) internal {
        vm.prank(owner);
        escrow.setSettler(newSettler);
    }

    // ---------- Assertions ----------

    function _status(bytes32 reservationId) internal view returns (IChargeMeshEscrow.Status) {
        return escrow.getReservation(reservationId).status;
    }

    function _assertStatus(bytes32 reservationId, IChargeMeshEscrow.Status expected) internal view {
        assertEq(uint8(_status(reservationId)), uint8(expected), "status");
    }

    function _invalidStatus(IChargeMeshEscrow.Status current) internal pure returns (bytes memory) {
        return abi.encodeWithSelector(IChargeMeshEscrow.InvalidStatus.selector, current);
    }
}
