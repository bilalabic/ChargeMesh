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
/// @dev M0 skeleton: ownership, settler management, storage layout, views and EIP-712 quote
///      hashing/verification are complete. The business functions (`reserve`, `startSession`,
///      `settle`, `cancel`, `expire`) revert with {NotImplemented} until M1.
///      Not upgradeable; no fees, pause or token support (out of scope).
contract ChargeMeshEscrow is IChargeMeshEscrow, Ownable2Step, EIP712, ReentrancyGuard {
    /// @notice Raised by business functions that are not implemented yet (M0 only).
    error NotImplemented();

    // ---------- Constants ----------

    /// @notice Time after `endTime` during which an `Active` reservation can still be settled
    ///         before anyone may `expire` it.
    uint64 public constant SETTLEMENT_GRACE = 1 days;

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

    /// @dev slotRef => true while a reservation holds the slot.
    mapping(bytes32 slotRef => bool) internal slotTaken;

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
    function reserve(ReservationQuote calldata, bytes calldata) external payable nonReentrant {
        // TODO(M1): docs/04-akilli-sozlesme.md — (nonReentrant already applied) checks in this order:
        //  - msg.sender == quote.driver                                   else NotDriver
        //  - block.timestamp <= quote.quoteExpiry                         else QuoteExpired
        //  - quote.startTime < quote.endTime && quote.requestedWh > 0     else InvalidQuote
        //  - quote.depositWei == ceilDiv(requestedWh * pricePerKwhWei, 1000) else IncorrectDeposit
        //  - msg.value == quote.depositWei                                else IncorrectDeposit
        //  - _verifyQuoteSigner(quote, signature) (signer == settler)     else InvalidSignature
        //  - reservations[id].status == None                              else ReservationExists
        //  - !slotTaken[quote.slotRef]                                    else SlotAlreadyTaken
        //  Effects: store Reservation{status: Reserved}, slotTaken[slotRef] = true, emit ReservationCreated.
        _revertNotImplemented();
    }

    /// @inheritdoc IChargeMeshEscrow
    function cancel(bytes32) external nonReentrant {
        // TODO(M1): docs/04-akilli-sozlesme.md — (nonReentrant already applied) checks:
        //  - status == Reserved                       else InvalidStatus(status)
        //  - msg.sender == driver                     else NotDriver
        //  - block.timestamp < startTime              else TooLate
        //  Effects: status = Cancelled, slotTaken[slotRef] = false, emit ReservationCancelled(id, depositWei).
        //  Interaction: refund full depositWei to driver (revert TransferFailed on failure).
        _revertNotImplemented();
    }

    // ---------- Settler ----------

    /// @inheritdoc IChargeMeshEscrow
    function startSession(bytes32) external nonReentrant onlySettler {
        // TODO(M1): docs/04-akilli-sozlesme.md — (nonReentrant + onlySettler already applied) checks:
        //  - status == Reserved                       else InvalidStatus(status)
        //  - block.timestamp <= endTime               else TooLate
        //  Effects: status = Active, emit SessionStarted(id, uint64(block.timestamp)).
        _revertNotImplemented();
    }

    /// @inheritdoc IChargeMeshEscrow
    function settle(bytes32, uint32, bytes32) external nonReentrant onlySettler {
        // TODO(M1): docs/04-akilli-sozlesme.md — (nonReentrant + onlySettler already applied) checks:
        //  - status == Active                         else InvalidStatus(status)
        //  - sessionHash != 0                         else ZeroSessionHash
        //  Math (identical to shared/src/units.ts, rounds down):
        //    billableWh = min(deliveredWh, requestedWh)
        //    hostAmount = min(billableWh * pricePerKwhWei / 1000, depositWei)
        //    refund     = depositWei - hostAmount
        //  Effects (before transfers): status = Settled, deliveredWh, sessionHash,
        //    slotTaken[slotRef] = false (TBD, see open question), emit ReservationSettled.
        //  Interactions: push hostAmount to host and refund to driver (revert TransferFailed on failure).
        _revertNotImplemented();
    }

    // ---------- Anyone ----------

    /// @inheritdoc IChargeMeshEscrow
    function expire(bytes32) external nonReentrant {
        // TODO(M1): docs/04-akilli-sozlesme.md — (nonReentrant already applied) checks:
        //  - (status == Reserved && block.timestamp > endTime) or
        //    (status == Active && block.timestamp > endTime + SETTLEMENT_GRACE)
        //    else InvalidStatus(status) for other states / TooEarly when the window has not passed
        //  Effects: status = Expired, slotTaken[slotRef] = false, emit ReservationExpired(id, depositWei).
        //  Interaction: refund full depositWei to driver (revert TransferFailed on failure).
        _revertNotImplemented();
    }

    // ---------- Owner ----------

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
    function isSlotTaken(bytes32 slotRef) external view returns (bool) {
        return slotTaken[slotRef];
    }

    /// @inheritdoc IChargeMeshEscrow
    function hashQuote(ReservationQuote calldata quote) external view returns (bytes32) {
        return _hashQuote(quote);
    }

    // ---------- Internal ----------

    /// @dev M0 only: reverts with {NotImplemented}. Remove together with the stubs in M1.
    function _revertNotImplemented() private pure {
        revert NotImplemented();
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
        (address recovered, ECDSA.RecoverError err,) = ECDSA.tryRecover(_hashQuote(quote), signature);
        if (err != ECDSA.RecoverError.NoError || recovered != settler) revert InvalidSignature();
    }
}
