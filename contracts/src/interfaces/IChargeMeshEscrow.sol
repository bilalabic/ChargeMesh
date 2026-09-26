// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IChargeMeshEscrow
/// @notice Frozen v1 interface. Spec: docs/04-akilli-sozlesme.md.
/// @dev The ABI in shared/src/chain/abi.ts is generated from this contract family.
///      Changing this file requires the contract change protocol (docs/07-paralel-calisma.md).
interface IChargeMeshEscrow {
    enum Status {
        None,
        Reserved,
        Active,
        Settled,
        Cancelled,
        Expired
    }

    /// @dev EIP-712 type:
    /// ReservationQuote(bytes32 reservationId,bytes32 slotRef,address driver,address host,uint32 requestedWh,uint128 pricePerKwhWei,uint128 depositWei,uint64 startTime,uint64 endTime,uint64 quoteExpiry)
    struct ReservationQuote {
        bytes32 reservationId;
        bytes32 slotRef;
        address driver;
        address host;
        uint32 requestedWh;
        uint128 pricePerKwhWei;
        uint128 depositWei;
        uint64 startTime;
        uint64 endTime;
        uint64 quoteExpiry;
    }

    struct Reservation {
        bytes32 slotRef;
        address driver;
        address host;
        uint32 requestedWh;
        uint32 deliveredWh;
        uint128 pricePerKwhWei;
        uint128 depositWei;
        uint64 startTime;
        uint64 endTime;
        Status status;
        bytes32 sessionHash;
    }

    // ---------- Events ----------

    event ReservationCreated(
        bytes32 indexed reservationId,
        bytes32 indexed slotRef,
        address indexed driver,
        address host,
        uint32 requestedWh,
        uint128 pricePerKwhWei,
        uint128 depositWei,
        uint64 startTime,
        uint64 endTime
    );
    event SessionStarted(bytes32 indexed reservationId, uint64 startedAt);
    event ReservationSettled(
        bytes32 indexed reservationId,
        uint32 deliveredWh,
        uint32 billableWh,
        uint128 hostAmountWei,
        uint128 refundWei,
        bytes32 sessionHash
    );
    event ReservationCancelled(bytes32 indexed reservationId, uint128 refundWei);
    event ReservationExpired(bytes32 indexed reservationId, uint128 refundWei);
    event SettlerUpdated(address indexed previousSettler, address indexed newSettler);

    // ---------- Errors ----------

    error NotDriver();
    error NotSettler();
    error InvalidQuote();
    error QuoteExpired();
    error InvalidSignature();
    error IncorrectDeposit();
    error ReservationExists();
    error SlotAlreadyTaken();
    error InvalidStatus(Status current);
    error TooLate();
    error TooEarly();
    error ZeroSessionHash();
    error TransferFailed();
    error ZeroAddress();

    // ---------- Driver ----------

    function reserve(ReservationQuote calldata quote, bytes calldata signature) external payable;

    function cancel(bytes32 reservationId) external;

    // ---------- Settler ----------

    function startSession(bytes32 reservationId) external;

    function settle(bytes32 reservationId, uint32 deliveredWh, bytes32 sessionHash) external;

    // ---------- Anyone ----------

    function expire(bytes32 reservationId) external;

    // ---------- Owner ----------

    function setSettler(address newSettler) external;

    // ---------- Views ----------

    function getReservation(bytes32 reservationId) external view returns (Reservation memory);

    function isSlotTaken(bytes32 slotRef) external view returns (bool);

    function settler() external view returns (address);

    function hashQuote(ReservationQuote calldata quote) external view returns (bytes32);

    function SETTLEMENT_GRACE() external view returns (uint64);
}
