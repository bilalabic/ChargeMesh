// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";

import {ChargeMeshEscrow} from "../src/ChargeMeshEscrow.sol";
import {IChargeMeshEscrow} from "../src/interfaces/IChargeMeshEscrow.sol";

/// @notice End-to-end smoke test of a deployed ChargeMeshEscrow on a live chain.
///         Flow A: reserve -> startSession -> settle. Flow B: reserve -> cancel.
/// @dev Env:
///      DEPLOYER_PRIVATE_KEY  settler key (on testnet the deployer is the settler); required
///      DRIVER_PRIVATE_KEY    optional, defaults to DEPLOYER_PRIVATE_KEY (driver == settler is allowed)
///      HOST_ADDRESS          optional, defaults to the deployer address
///      ESCROW_ADDRESS        optional, defaults to `escrow` in deployments/<chainId>.json
///      DELIVERED_WH          optional, default 14500
///      PRICE_WEI_PER_KWH     optional, default 1e12 (20 kWh deposit = 2e13 wei)
///      Does not write any deployment file.
///      forge script script/Smoke.s.sol --rpc-url <RPC_URL> --broadcast
contract Smoke is Script {
    uint256 internal constant WH_PER_KWH = 1000;
    uint32 internal constant REQUESTED_WH = 20_000;

    error SettlerMismatch(address onChainSettler, address keySettler);
    error SmokeCheckFailed(string what);

    ChargeMeshEscrow internal escrow;
    uint256 internal settlerKey;
    uint256 internal driverKey;
    address internal settler;
    address internal driver;
    address internal host;
    uint32 internal deliveredWh;
    uint128 internal price;

    function run() external {
        _loadEnv();

        address onChainSettler = escrow.settler();
        if (onChainSettler != settler) revert SettlerMismatch(onChainSettler, settler);

        console2.log("chainId:", block.chainid);
        console2.log("escrow:", address(escrow));
        console2.log("settler:", settler);
        console2.log("driver:", driver);
        console2.log("host:", host);

        bytes32 settledId = _flowSettle();
        bytes32 cancelledId = _flowCancel();

        console2.log("---- smoke summary ----");
        console2.log("settled reservationId:");
        console2.logBytes32(settledId);
        console2.log("cancelled reservationId:");
        console2.logBytes32(cancelledId);
        console2.log("OK: settle and cancel flows passed");
    }

    // ---------- Flows ----------

    /// @dev reserve (driver) -> startSession (settler) -> settle (settler).
    function _flowSettle() internal returns (bytes32 reservationId) {
        // startTime = now: nothing checks startTime on reserve/startSession, and startSession only
        // requires block.timestamp <= endTime, so the one-hour window absorbs mining delays.
        IChargeMeshEscrow.ReservationQuote memory q = _quote("settle", block.timestamp, block.timestamp + 1 hours);
        reservationId = q.reservationId;
        bytes memory sig = _sign(q);

        (uint256 hostAmount, uint256 refund) = _expectedSplit(q);
        uint256 hostBalanceBefore = host.balance;

        console2.log("---- flow A: settle ----");
        console2.log("reservationId:");
        console2.logBytes32(reservationId);
        console2.log("depositWei:", uint256(q.depositWei));
        console2.log("deliveredWh:", uint256(deliveredWh));
        console2.log("expected hostAmountWei:", hostAmount);
        console2.log("expected refundWei:", refund);

        bytes32 sessionHash = keccak256(abi.encodePacked("smoke-session:", reservationId));

        vm.startBroadcast(driverKey);
        escrow.reserve{value: q.depositWei}(q, sig);
        vm.stopBroadcast();

        vm.startBroadcast(settlerKey);
        escrow.startSession(reservationId);
        escrow.settle(reservationId, deliveredWh, sessionHash);
        vm.stopBroadcast();

        IChargeMeshEscrow.Reservation memory r = escrow.getReservation(reservationId);
        _check(r.status == IChargeMeshEscrow.Status.Settled, "settle: status != Settled");
        _check(r.slotRef == q.slotRef, "settle: slotRef");
        _check(r.driver == driver && r.host == host, "settle: driver/host");
        _check(r.requestedWh == q.requestedWh, "settle: requestedWh");
        _check(r.deliveredWh == deliveredWh, "settle: deliveredWh");
        _check(r.pricePerKwhWei == q.pricePerKwhWei && r.depositWei == q.depositWei, "settle: price/deposit");
        _check(r.startTime == q.startTime && r.endTime == q.endTime, "settle: times");
        _check(r.sessionHash == sessionHash, "settle: sessionHash");
        // Host balance is only comparable when the host pays no gas in this script.
        if (host != driver && host != settler) {
            _check(host.balance - hostBalanceBefore == hostAmount, "settle: host balance delta");
            console2.log("host balance delta OK:", hostAmount);
        }
        console2.log("status: Settled");
    }

    /// @dev reserve (driver, future slot) -> cancel (driver).
    function _flowCancel() internal returns (bytes32 reservationId) {
        // cancel requires block.timestamp < startTime; one hour of margin covers mining delays.
        IChargeMeshEscrow.ReservationQuote memory q =
            _quote("cancel", block.timestamp + 1 hours, block.timestamp + 2 hours);
        reservationId = q.reservationId;
        bytes memory sig = _sign(q);

        console2.log("---- flow B: cancel ----");
        console2.log("reservationId:");
        console2.logBytes32(reservationId);
        console2.log("depositWei (refunded):", uint256(q.depositWei));

        vm.startBroadcast(driverKey);
        escrow.reserve{value: q.depositWei}(q, sig);
        escrow.cancel(reservationId);
        vm.stopBroadcast();

        IChargeMeshEscrow.Reservation memory r = escrow.getReservation(reservationId);
        _check(r.status == IChargeMeshEscrow.Status.Cancelled, "cancel: status != Cancelled");
        _check(r.depositWei == q.depositWei && r.driver == driver, "cancel: stored fields");
        _check(!escrow.isSlotTaken(q.slotRef), "cancel: slot still taken");
        console2.log("status: Cancelled, slot freed");
    }

    // ---------- Helpers ----------

    function _loadEnv() internal {
        settlerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        driverKey = vm.envOr("DRIVER_PRIVATE_KEY", settlerKey);
        settler = vm.addr(settlerKey);
        driver = vm.addr(driverKey);
        host = vm.envOr("HOST_ADDRESS", settler);
        deliveredWh = uint32(vm.envOr("DELIVERED_WH", uint256(14_500)));
        price = uint128(vm.envOr("PRICE_WEI_PER_KWH", uint256(1e12)));
        escrow = ChargeMeshEscrow(vm.envOr("ESCROW_ADDRESS", address(0)));

        if (address(escrow) == address(0)) {
            string memory path = string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
            if (!vm.exists(path)) {
                revert(string.concat("Smoke: ESCROW_ADDRESS unset and no deployment file at ", path));
            }
            escrow = ChargeMeshEscrow(vm.parseJsonAddress(vm.readFile(path), ".escrow"));
        }
        if (address(escrow).code.length == 0) revert("Smoke: no contract code at escrow address");
    }

    function _quote(string memory tag, uint256 startTime, uint256 endTime)
        internal
        view
        returns (IChargeMeshEscrow.ReservationQuote memory q)
    {
        uint256 nonce = vm.getNonce(driver);
        q = IChargeMeshEscrow.ReservationQuote({
            reservationId: keccak256(abi.encodePacked("smoke:", tag, ":rid:", block.timestamp, nonce, driver)),
            slotRef: keccak256(abi.encodePacked("smoke:", tag, ":slot:", block.timestamp, nonce, driver)),
            driver: driver,
            host: host,
            requestedWh: REQUESTED_WH,
            pricePerKwhWei: price,
            depositWei: uint128((uint256(REQUESTED_WH) * price + WH_PER_KWH - 1) / WH_PER_KWH),
            startTime: uint64(startTime),
            endTime: uint64(endTime),
            quoteExpiry: uint64(block.timestamp + 10 minutes)
        });
    }

    function _sign(IChargeMeshEscrow.ReservationQuote memory q) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(settlerKey, escrow.hashQuote(q));
        return abi.encodePacked(r, s, v);
    }

    /// @dev Same formula as ChargeMeshEscrow.settle and shared/src/units.ts.
    function _expectedSplit(IChargeMeshEscrow.ReservationQuote memory q)
        internal
        view
        returns (uint256 hostAmount, uint256 refund)
    {
        uint256 billableWh = deliveredWh < q.requestedWh ? deliveredWh : q.requestedWh;
        uint256 cost = (billableWh * q.pricePerKwhWei) / WH_PER_KWH;
        hostAmount = cost < q.depositWei ? cost : q.depositWei;
        refund = q.depositWei - hostAmount;
    }

    function _check(bool ok, string memory what) internal pure {
        if (!ok) revert SmokeCheckFailed(what);
    }
}
