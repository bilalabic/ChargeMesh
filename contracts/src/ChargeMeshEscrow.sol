// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {IChargeMeshEscrow} from "./interfaces/IChargeMeshEscrow.sol";

/// @title ChargeMeshEscrow
/// @author ChargeMesh blockchain team
/// @notice Locks a driver's deposit for a settler-signed charging reservation and splits it
///         between host and driver based on the delivered energy. Spec: docs/04-akilli-sozlesme.md.
/// @dev Check order and errors follow the "Hangi durumda hangi hata?" table of the spec.
///      Settlement math is byte-for-byte identical to shared/src/units.ts.
///      Not upgradeable; no fees, pause or token support (out of scope).
contract ChargeMeshEscrow is IChargeMeshEscrow, Ownable2Step, EIP712, ReentrancyGuard {
    // ---------- Constants ----------

    /// @notice Time after `endTime` during which an `Active` reservation can still be settled
    ///         before anyone may `expire` it.
    uint64 public constant SETTLEMENT_GRACE = 1 days;

    uint256 internal constant WH_PER_KWH = 1000;

    /// @dev Gas forwarded on push payments. Enough for EOAs and common smart wallets; a recipient
    ///      that reverts or runs out of gas is credited in {pendingWithdrawal} instead (docs/04, M-1).
    uint256 internal constant PUSH_GAS_LIMIT = 100_000;

    /// @dev Headroom for the CALL itself (value transfer, cold account access) on top of the stipend.
    uint256 internal constant PUSH_GAS_MARGIN = 40_000;

    /// @dev keccak256 of the EIP-712 type string. Must match
    ///      shared/src/chain/eip712.ts (RESERVATION_QUOTE_TYPESTRING) character for character.
    bytes32 internal constant RESERVATION_QUOTE_TYPEHASH = keccak256(
        "ReservationQuote(bytes32 reservationId,bytes32 slotRef,address driver,address host,uint32 requestedWh,uint128 pricePerKwhWei,uint128 depositWei,uint64 startTime,uint64 endTime,uint64 quoteExpiry)"
    );

    // ---------- Storage ----------

    /// @notice Backend EOA that signs quotes and reports session start and settlement.
    address public settler;

    /// @dev reservationId => reservation.
    mapping(bytes32 reservationId => Reservation) internal reservations;

    /// @dev slotRef => true while a reservation holds the slot (stays true after settlement).
    mapping(bytes32 slotRef => bool) internal slotTaken;

    /// @dev account => amount whose push payment failed; claimable via {withdraw}.
    mapping(address account => uint256) internal pendingWithdrawals;

    // ---------- Modifiers ----------

    modifier onlySettler() {
        if (msg.sender != settler) revert NotSettler();
        _;
    }

    // ---------- Constructor ----------

    /// @param initialOwner Owner allowed to call {setSettler} (two-step transferable).
    /// @param initialSettler Backend settler EOA.
    constructor(address initialOwner, address initialSettler) Ownable(initialOwner) EIP712("ChargeMesh", "1") {
        if (initialSettler == address(0)) revert ZeroAddress();
        settler = initialSettler;
        emit SettlerUpdated(address(0), initialSettler);
    }

    // ---------- Driver ----------

    /// @inheritdoc IChargeMeshEscrow
    function reserve(ReservationQuote calldata quote, bytes calldata signature) external payable nonReentrant {
        if (msg.sender != quote.driver) revert NotDriver();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > quote.quoteExpiry) revert QuoteExpired();
        if (quote.startTime >= quote.endTime || quote.requestedWh == 0 || quote.host == address(0)) {
            revert InvalidQuote();
        }
        if (quote.depositWei != _depositFor(quote.requestedWh, quote.pricePerKwhWei) || msg.value != quote.depositWei) {
            revert IncorrectDeposit();
        }
        _verifyQuoteSigner(quote, signature);
        if (reservations[quote.reservationId].status != Status.None) revert ReservationExists();
        if (slotTaken[quote.slotRef]) revert SlotAlreadyTaken();

        reservations[quote.reservationId] = Reservation({
            slotRef: quote.slotRef,
            driver: quote.driver,
            host: quote.host,
            requestedWh: quote.requestedWh,
            deliveredWh: 0,
            pricePerKwhWei: quote.pricePerKwhWei,
            depositWei: quote.depositWei,
            startTime: quote.startTime,
            endTime: quote.endTime,
            status: Status.Reserved,
            sessionHash: bytes32(0)
        });
        slotTaken[quote.slotRef] = true;

        // The only external call before this event is the ecrecover precompile (staticcall).
        // forge-lint: disable-next-item(reentrancy-events)
        emit ReservationCreated(
            quote.reservationId,
            quote.slotRef,
            quote.driver,
            quote.host,
            quote.requestedWh,
            quote.pricePerKwhWei,
            quote.depositWei,
            quote.startTime,
            quote.endTime
        );
    }

    /// @inheritdoc IChargeMeshEscrow
    function cancel(bytes32 reservationId) external nonReentrant {
        Reservation storage r = reservations[reservationId];
        if (r.status != Status.Reserved) revert InvalidStatus(r.status);
        if (msg.sender != r.driver) revert NotDriver();
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= r.startTime) revert TooLate();

        r.status = Status.Cancelled;
        slotTaken[r.slotRef] = false;
        uint128 refund = r.depositWei;
        emit ReservationCancelled(reservationId, refund);

        _payOrDefer(r.driver, refund);
    }

    // ---------- Settler ----------

    /// @inheritdoc IChargeMeshEscrow
    function startSession(bytes32 reservationId) external nonReentrant onlySettler {
        Reservation storage r = reservations[reservationId];
        if (r.status != Status.Reserved) revert InvalidStatus(r.status);
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp > r.endTime) revert TooLate();

        r.status = Status.Active;
        // uint64 seconds cannot overflow for billions of years.
        // forge-lint: disable-next-line(unsafe-typecast)
        emit SessionStarted(reservationId, uint64(block.timestamp));
    }

    /// @inheritdoc IChargeMeshEscrow
    function settle(bytes32 reservationId, uint32 deliveredWh, bytes32 sessionHash) external nonReentrant onlySettler {
        Reservation storage r = reservations[reservationId];
        if (r.status != Status.Active) revert InvalidStatus(r.status);
        if (sessionHash == bytes32(0)) revert ZeroSessionHash();

        uint32 billableWh = deliveredWh < r.requestedWh ? deliveredWh : r.requestedWh;
        uint256 cost = (uint256(billableWh) * r.pricePerKwhWei) / WH_PER_KWH;
        uint128 deposit = r.depositWei;
        // cost <= deposit always holds for a valid quote; the cap mirrors units.ts defensively.
        // The cast only happens when cost < deposit, so it fits in uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 hostAmount = cost < deposit ? uint128(cost) : deposit;
        uint128 refund = deposit - hostAmount;

        r.status = Status.Settled;
        r.deliveredWh = deliveredWh;
        r.sessionHash = sessionHash;
        emit ReservationSettled(reservationId, deliveredWh, billableWh, hostAmount, refund, sessionHash);

        _payOrDefer(r.host, hostAmount);
        _payOrDefer(r.driver, refund);
    }

    // ---------- Anyone ----------

    /// @inheritdoc IChargeMeshEscrow
    function expire(bytes32 reservationId) external nonReentrant {
        Reservation storage r = reservations[reservationId];
        Status status = r.status;
        if (status == Status.Reserved) {
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp <= r.endTime) revert TooEarly();
        } else if (status == Status.Active) {
            // forge-lint: disable-next-line(block-timestamp)
            if (block.timestamp <= uint256(r.endTime) + SETTLEMENT_GRACE) revert TooEarly();
        } else {
            revert InvalidStatus(status);
        }

        r.status = Status.Expired;
        slotTaken[r.slotRef] = false;
        uint128 refund = r.depositWei;
        emit ReservationExpired(reservationId, refund);

        _payOrDefer(r.driver, refund);
    }

    /// @inheritdoc IChargeMeshEscrow
    function withdraw() external nonReentrant {
        uint256 amount = pendingWithdrawals[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        pendingWithdrawals[msg.sender] = 0;
        emit Withdrawn(msg.sender, amount);

        (bool ok,) = payable(msg.sender).call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ---------- Owner ----------

    /// @notice Disabled: without an owner the settler could never be rotated.
    function renounceOwnership() public view override onlyOwner {
        revert RenounceDisabled();
    }

    /// @inheritdoc IChargeMeshEscrow
    function setSettler(address newSettler) external onlyOwner {
        if (newSettler == address(0)) revert ZeroAddress();
        address previous = settler;
        settler = newSettler;
        emit SettlerUpdated(previous, newSettler);
    }

    // ---------- Views ----------

    /// @inheritdoc IChargeMeshEscrow
    function getReservation(bytes32 reservationId) external view returns (Reservation memory) {
        return reservations[reservationId];
    }

    /// @inheritdoc IChargeMeshEscrow
    function pendingWithdrawal(address account) external view returns (uint256) {
        return pendingWithdrawals[account];
    }

    /// @inheritdoc IChargeMeshEscrow
    function isSlotTaken(bytes32 slotRef) external view returns (bool) {
        return slotTaken[slotRef];
    }

    /// @inheritdoc IChargeMeshEscrow
    function hashQuote(ReservationQuote calldata quote) external view returns (bytes32) {
        return _hashQuote(quote);
    }

    // ---------- Internal ----------

    /// @dev ceil(wh * pricePerKwhWei / 1000). Cannot overflow: uint32 * uint128 < 2^160.
    function _depositFor(uint32 wh, uint128 pricePerKwhWei) internal pure returns (uint256) {
        return (uint256(wh) * pricePerKwhWei + WH_PER_KWH - 1) / WH_PER_KWH;
    }

    /// @dev Pushes native MON with a gas cap and without copying return data (no return-bomb).
    ///      If the recipient rejects it, the amount is credited to {pendingWithdrawal} so that one
    ///      party can never block the other's payment. Zero amounts are skipped.
    function _payOrDefer(address to, uint256 amount) internal {
        if (amount == 0) return;
        // Under the 63/64 rule a caller could starve the push and force a deferral; require enough
        // gas to forward the full stipend so deferral only happens when the recipient itself fails.
        if (gasleft() < PUSH_GAS_LIMIT * 64 / 63 + PUSH_GAS_MARGIN) revert InsufficientGas();
        bool ok;
        // `to` is always the stored driver or host of the reservation.
        assembly ("memory-safe") {
            ok := call(PUSH_GAS_LIMIT, to, amount, 0, 0, 0, 0)
        }
        if (!ok) {
            pendingWithdrawals[to] += amount;
            // Emitted after our own push attempt; all callers are nonReentrant.
            // forge-lint: disable-next-line(reentrancy-events)
            emit PaymentDeferred(to, amount);
        }
    }

    /// @dev EIP-712 digest of `quote` under this contract's domain ("ChargeMesh", "1", chainid, address(this)).
    function _hashQuote(ReservationQuote calldata quote) internal view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(
                    RESERVATION_QUOTE_TYPEHASH,
                    quote.reservationId,
                    quote.slotRef,
                    quote.driver,
                    quote.host,
                    quote.requestedWh,
                    quote.pricePerKwhWei,
                    quote.depositWei,
                    quote.startTime,
                    quote.endTime,
                    quote.quoteExpiry
                )
            )
        );
    }

    /// @dev Reverts with {InvalidSignature} unless `signature` is a valid ECDSA signature of the
    ///      quote digest by the current settler. Malleable (high-s) and malformed signatures are rejected.
    function _verifyQuoteSigner(ReservationQuote calldata quote, bytes calldata signature) internal view {
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecoverCalldata(_hashQuote(quote), signature);
        if (err != ECDSA.RecoverError.NoError || recovered != settler) revert InvalidSignature();
    }
}
