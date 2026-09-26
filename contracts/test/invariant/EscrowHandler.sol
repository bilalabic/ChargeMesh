// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {ChargeMeshEscrow} from "../../src/ChargeMeshEscrow.sol";
import {IChargeMeshEscrow} from "../../src/interfaces/IChargeMeshEscrow.sol";
import {EscrowActor, GasGriefer, ToggleReceiver} from "../utils/Actors.sol";
import {UnitsOracle} from "../utils/EscrowTestBase.sol";

/// @notice Stateful fuzzing handler for {ChargeMeshEscrow}.
/// @dev Every action is bounded and wrapped in try/catch, so the fuzzer never "wastes" a call on a
///      revert and the handler can count successes/failures per action. All expectations are kept in
///      ghost variables that are computed independently of the escrow (oracle math + a prediction of
///      whether each recipient accepts MON), and are compared against the escrow in the invariants.
contract EscrowHandler is CommonBase, StdCheats, StdUtils {
    enum Kind {
        Eoa,
        Toggle,
        Griefer
    }

    uint256 internal constant SLOT_POOL = 12;

    ChargeMeshEscrow public immutable escrow;
    address public immutable settler;
    uint256 internal immutable settlerPk;

    // ---------- Actors ----------

    address[] public drivers;
    address[] public hosts;
    address[] public actors; // drivers ++ hosts
    mapping(address => Kind) public kindOf;

    bytes32[SLOT_POOL] public slots;

    // ---------- Reservation tracking ----------

    bytes32[] public ids;
    mapping(bytes32 => bool) public known;
    mapping(bytes32 => bytes32) public ghostSlotOf;
    mapping(bytes32 => uint128) public ghostDepositOf;
    mapping(bytes32 => address) public ghostDriverOf;
    mapping(bytes32 => address) public ghostHostOf;
    mapping(bytes32 => uint256) public ghostReserveCount; // successful reserve() calls per id
    mapping(bytes32 => IChargeMeshEscrow.Status) public lastSeen; // status observed after the last action
    mapping(bytes32 => uint32) public ghostDeliveredArg;
    /// @dev Measured value that reached host/driver for this reservation (balance delta + pending delta).
    mapping(bytes32 => uint256) public ghostHostReceived;
    mapping(bytes32 => uint256) public ghostDriverReceived;

    // ---------- Money ghosts ----------

    uint256 public ghostDeposited; // total MON sent into the escrow via reserve()
    uint256 public ghostOpenDeposits; // deposits of Reserved + Active reservations
    uint256 public ghostPendingWithdrawals; // predicted sum of pendingWithdrawal over all actors
    mapping(address => uint256) public ghostPendingOf;
    uint256 public ghostPaidOut; // predicted MON that left the escrow (pushes + withdrawals)

    // ---------- Status counts (refreshed after every action) ----------

    uint256[6] public statusCount;

    // ---------- Violations detected inside the handler ----------

    uint256 public badTransitions;
    uint256 public idReuses;
    uint256 public receiptMismatches;
    string public lastViolation;

    // ---------- Call summary ----------

    mapping(bytes32 => uint256) public calls;
    mapping(bytes32 => uint256) public successes;
    uint256 internal nonce;
    mapping(bytes4 => uint256) public reserveErrors;

    constructor(ChargeMeshEscrow escrow_, address settler_, uint256 settlerPk_) {
        escrow = escrow_;
        settler = settler_;
        settlerPk = settlerPk_;

        for (uint256 i; i < 2; ++i) {
            _addActor(drivers, makeAddr(string.concat("driverEoa", vm.toString(i))), Kind.Eoa);
            _addActor(hosts, makeAddr(string.concat("hostEoa", vm.toString(i))), Kind.Eoa);
            _addActor(drivers, address(new ToggleReceiver(escrow_)), Kind.Toggle);
            _addActor(hosts, address(new ToggleReceiver(escrow_)), Kind.Toggle);
        }
        _addActor(hosts, address(new GasGriefer(escrow_)), Kind.Griefer);
        for (uint256 i; i < SLOT_POOL; ++i) {
            slots[i] = keccak256(abi.encode("slot", i));
        }
    }

    modifier track(bytes32 name) {
        calls[name]++;
        _;
        _sync();
    }

    // =====================================================================
    // Actions
    // =====================================================================

    /// @param seeds Hashed to choose driver, host, slot (small pool, so collisions are frequent) and id reuse.
    /// @param timeSeed Packed start offset (low 128 bits) and duration (high 128 bits).
    function reserve(uint256 seeds, uint32 requestedWh, uint128 price, uint256 timeSeed) external track("reserve") {
        IChargeMeshEscrow.ReservationQuote memory q = _buildQuote(seeds, requestedWh, price, timeSeed);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(settlerPk, escrow.hashQuote(q));
        if (!_submitReserve(q, abi.encodePacked(r, s, v))) return;

        bytes32 id = q.reservationId;
        successes["reserve"]++;
        ghostReserveCount[id]++;
        if (ghostReserveCount[id] > 1) {
            idReuses++;
            lastViolation = "reservationId reserved twice";
        }
        if (!known[id]) {
            known[id] = true;
            ids.push(id);
        }
        ghostSlotOf[id] = q.slotRef;
        ghostDepositOf[id] = q.depositWei;
        ghostDriverOf[id] = q.driver;
        ghostHostOf[id] = q.host;
        ghostDeposited += q.depositWei;
        ghostOpenDeposits += q.depositWei;
    }

    function startSession(uint256 idSeed) external track("startSession") {
        if (ids.length == 0) return;
        bytes32 id = _pickId(idSeed, IChargeMeshEscrow.Status.Reserved, IChargeMeshEscrow.Status.Reserved);
        vm.prank(settler);
        try escrow.startSession(id) {
            successes["startSession"]++;
        } catch {}
    }

    function settle(uint256 idSeed, uint32 deliveredWh, uint256 hashSeed) external track("settle") {
        if (ids.length == 0) return;
        bytes32 id = _pickId(idSeed, IChargeMeshEscrow.Status.Active, IChargeMeshEscrow.Status.Active);
        // 1 in 16 calls uses a zero session hash (must revert with ZeroSessionHash).
        bytes32 sessionHash = _roll(hashSeed, "zeroHash", 16) ? bytes32(0) : keccak256(abi.encode("session", hashSeed));
        // Over-delivery is common: deliveredWh is the full uint32 range half of the time.
        IChargeMeshEscrow.Reservation memory res = escrow.getReservation(id);
        if (_roll(hashSeed, "boundDelivered", 2) && res.requestedWh > 0) {
            deliveredWh = uint32(bound(deliveredWh, 0, uint256(res.requestedWh) * 2));
        }

        (uint256 hBal, uint256 hPend, uint256 dBal, uint256 dPend) = _snapshot(res.host, res.driver);

        vm.prank(settler);
        try escrow.settle(id, deliveredWh, sessionHash) {
            successes["settle"]++;
        } catch {
            return;
        }

        (, uint256 hostAmount, uint256 refund) =
            UnitsOracle.computeSettlement(res.requestedWh, deliveredWh, res.pricePerKwhWei, res.depositWei);
        ghostDeliveredArg[id] = deliveredWh;
        ghostOpenDeposits -= res.depositWei;
        _recordPayout(id, res.host, true, hostAmount, hBal, hPend, "settle: host payout mismatch");
        _recordPayout(id, res.driver, false, refund, dBal, dPend, "settle: driver payout mismatch");
    }

    function cancel(uint256 idSeed, uint256 callerSeed) external track("cancel") {
        if (ids.length == 0) return;
        bytes32 id = _pickId(idSeed, IChargeMeshEscrow.Status.Reserved, IChargeMeshEscrow.Status.Reserved);
        IChargeMeshEscrow.Reservation memory res = escrow.getReservation(id);
        // 1 in 8 calls come from a random (usually wrong) driver.
        address caller = _roll(callerSeed, "wrongCaller", 8) ? drivers[callerSeed % drivers.length] : res.driver;
        if (caller == address(0)) return;

        (,, uint256 dBal, uint256 dPend) = _snapshot(address(0), res.driver);
        bool ok;
        if (kindOf[caller] == Kind.Eoa) {
            vm.prank(caller);
            try escrow.cancel(id) {
                ok = true;
            } catch {}
        } else {
            try EscrowActor(caller).doCancel(id) {
                ok = true;
            } catch {}
        }
        if (!ok) return;
        successes["cancel"]++;
        _afterRefund(id, res, dBal, dPend, "cancel: driver deferral mismatch");
    }

    function expire(uint256 idSeed) external track("expire") {
        if (ids.length == 0) return;
        bytes32 id = _pickId(idSeed, IChargeMeshEscrow.Status.Reserved, IChargeMeshEscrow.Status.Active);
        IChargeMeshEscrow.Reservation memory res = escrow.getReservation(id);
        (,, uint256 dBal, uint256 dPend) = _snapshot(address(0), res.driver);
        try escrow.expire(id) {
            successes["expire"]++;
        } catch {
            return;
        }
        _afterRefund(id, res, dBal, dPend, "expire: driver deferral mismatch");
    }

    function withdraw(uint256 actorSeed) external track("withdraw") {
        address a = actors[actorSeed % actors.length];
        // 3 in 4 calls prefer an actor that is actually owed something.
        if (!_roll(actorSeed, "anyActor", 4)) {
            for (uint256 i; i < actors.length; ++i) {
                address c = actors[(actorSeed % actors.length + i) % actors.length];
                if (ghostPendingOf[c] > 0) {
                    a = c;
                    break;
                }
            }
        }
        // Half of the time a contract actor first "fixes" itself so that it can pull its funds.
        bool fix = _roll(actorSeed, "fix", 2);
        if (kindOf[a] == Kind.Toggle && fix) ToggleReceiver(payable(a)).setAccepting(true);
        if (kindOf[a] == Kind.Griefer && GasGriefer(payable(a)).griefing()) {
            // A griefing receiver would burn the whole call's gas; it cannot receive anyway.
            if (!fix) return;
            GasGriefer(payable(a)).setGriefing(false);
        }
        uint256 amount = escrow.pendingWithdrawal(a);
        uint256 balBefore = a.balance;
        bool ok;
        if (kindOf[a] == Kind.Eoa) {
            vm.prank(a);
            try escrow.withdraw() {
                ok = true;
            } catch {}
        } else {
            try EscrowActor(a).doWithdraw() {
                ok = true;
            } catch {}
        }
        if (!ok) return;
        successes["withdraw"]++;
        if (a.balance - balBefore != ghostPendingOf[a] || amount != ghostPendingOf[a]) {
            receiptMismatches++;
            lastViolation = "withdraw: amount mismatch";
        }
        ghostPaidOut += ghostPendingOf[a];
        ghostPendingWithdrawals -= ghostPendingOf[a];
        ghostPendingOf[a] = 0;
    }

    function toggle(uint256 actorSeed, bool accepting) external track("toggle") {
        address a = actors[actorSeed % actors.length];
        if (kindOf[a] == Kind.Toggle) ToggleReceiver(payable(a)).setAccepting(accepting);
        else if (kindOf[a] == Kind.Griefer) GasGriefer(payable(a)).setGriefing(!accepting);
        else return;
        successes["toggle"]++;
    }

    function warp(uint256 secs) external track("warp") {
        // Mostly short hops; 1 in 12 is long enough to cross endTime + SETTLEMENT_GRACE.
        secs = _roll(secs, "longWarp", 12) ? bound(secs, 1 days, 2 days) : bound(secs, 1, 90 minutes);
        vm.warp(vm.getBlockTimestamp() + secs);
        successes["warp"]++;
    }

    // =====================================================================
    // Views for the invariant contract
    // =====================================================================

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function actorsLength() external view returns (uint256) {
        return actors.length;
    }

    function slotPool() external view returns (bytes32[SLOT_POOL] memory) {
        return slots;
    }

    // =====================================================================
    // Internal
    // =====================================================================

    function _buildQuote(uint256 seeds, uint32 requestedWh, uint128 price, uint256 timeSeed)
        internal
        returns (IChargeMeshEscrow.ReservationQuote memory q)
    {
        uint256 h = uint256(keccak256(abi.encode(seeds, "reserve")));
        // 1 in 5: try to reuse an existing id (must fail with ReservationExists).
        if (ids.length > 0 && _roll(seeds, "reuseId", 5)) q.reservationId = ids[(h >> 32) % ids.length];
        else q.reservationId = keccak256(abi.encode("rid", nonce++));

        q.driver = drivers[(h & 0xff) % drivers.length];
        q.host = hosts[((h >> 8) & 0xff) % hosts.length];
        q.slotRef = slots[((h >> 16) & 0xff) % SLOT_POOL];
        q.requestedWh = uint32(bound(requestedWh, 1, 100_000));
        q.pricePerKwhWei = uint128(bound(price, 1, 1e20));
        q.depositWei = uint128(UnitsOracle.depositFor(q.requestedWh, q.pricePerKwhWei));
        uint64 nowTs = uint64(vm.getBlockTimestamp());
        q.startTime = nowTs + uint64(bound(uint128(timeSeed), 0, 3 hours));
        q.endTime = q.startTime + uint64(bound(timeSeed >> 128, 1, 4 hours));
        q.quoteExpiry = nowTs + 5 minutes;
    }

    function _submitReserve(IChargeMeshEscrow.ReservationQuote memory q, bytes memory sig) internal returns (bool) {
        if (kindOf[q.driver] == Kind.Eoa) {
            vm.deal(q.driver, q.driver.balance + q.depositWei);
            vm.prank(q.driver);
            try escrow.reserve{value: q.depositWei}(q, sig) {
                return true;
            } catch (bytes memory err) {
                reserveErrors[bytes4(err)]++;
                return false;
            }
        }
        vm.deal(address(this), address(this).balance + q.depositWei);
        try EscrowActor(q.driver).doReserve{value: q.depositWei}(q, sig) {
            return true;
        } catch (bytes memory err) {
            reserveErrors[bytes4(err)]++;
            return false;
        }
    }

    /// @dev 3 in 4 calls pick an id whose status is `a` or `b` (if any), otherwise any id.
    ///      This keeps the happy paths busy while still hitting InvalidStatus reverts.
    function _pickId(uint256 idSeed, IChargeMeshEscrow.Status a, IChargeMeshEscrow.Status b)
        internal
        view
        returns (bytes32)
    {
        uint256 n = ids.length;
        uint256 start = idSeed % n;
        if (!_roll(idSeed, "anyId", 4)) {
            for (uint256 i; i < n; ++i) {
                bytes32 id = ids[(start + i) % n];
                IChargeMeshEscrow.Status s = lastSeen[id];
                if (s == a || s == b) return id;
            }
        }
        return ids[start];
    }

    /// @dev True with probability 1/n, decorrelated from the raw seed (the fuzzer favours edge values
    ///      such as 0 and type(uint256).max, which would otherwise always hit the same branch).
    function _roll(uint256 seed, string memory salt, uint256 n) internal pure returns (bool) {
        return uint256(keccak256(abi.encode(seed, salt))) % n == 0;
    }

    function _addActor(address[] storage list, address a, Kind kind) internal {
        list.push(a);
        actors.push(a);
        kindOf[a] = kind;
    }

    function _accepts(address a) internal view returns (bool) {
        Kind k = kindOf[a];
        if (k == Kind.Toggle) return ToggleReceiver(payable(a)).accepting();
        if (k == Kind.Griefer) return !GasGriefer(payable(a)).griefing();
        return true;
    }

    /// @dev Predicts the effect of `_payOrDefer(to, amount)` without looking at the escrow.
    function _creditPredicted(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (_accepts(to)) {
            ghostPaidOut += amount;
        } else {
            ghostPendingOf[to] += amount;
            ghostPendingWithdrawals += amount;
        }
    }

    function _snapshot(address h, address d)
        internal
        view
        returns (uint256 hBal, uint256 hPend, uint256 dBal, uint256 dPend)
    {
        if (h != address(0)) (hBal, hPend) = (h.balance, escrow.pendingWithdrawal(h));
        if (d != address(0)) (dBal, dPend) = (d.balance, escrow.pendingWithdrawal(d));
    }

    /// @dev Updates the predicted ghosts for a payout of `amount` to `to`, stores what `to` actually
    ///      received (balance delta + pendingWithdrawal delta) and flags a wrong push/defer split.
    function _recordPayout(
        bytes32 id,
        address to,
        bool isHost,
        uint256 amount,
        uint256 balBefore,
        uint256 pendBefore,
        string memory what
    ) internal {
        _creditPredicted(to, amount);
        uint256 deferred = escrow.pendingWithdrawal(to) - pendBefore;
        uint256 total = (to.balance - balBefore) + deferred;
        if (isHost) ghostHostReceived[id] = total;
        else ghostDriverReceived[id] = total;
        if (deferred != (_accepts(to) ? 0 : amount) || total != amount) {
            receiptMismatches++;
            lastViolation = what;
        }
    }

    function _afterRefund(
        bytes32 id,
        IChargeMeshEscrow.Reservation memory res,
        uint256 dBal,
        uint256 dPend,
        string memory what
    ) internal {
        ghostOpenDeposits -= res.depositWei;
        _recordPayout(id, res.driver, false, res.depositWei, dBal, dPend, what);
    }

    /// @dev Records every status change since the last action and flags illegal transitions.
    function _sync() internal {
        delete statusCount;
        for (uint256 i; i < ids.length; ++i) {
            bytes32 id = ids[i];
            IChargeMeshEscrow.Status cur = escrow.getReservation(id).status;
            IChargeMeshEscrow.Status prev = lastSeen[id];
            if (cur != prev) {
                if (!_allowed(prev, cur)) {
                    badTransitions++;
                    lastViolation =
                        string.concat("illegal transition ", vm.toString(uint8(prev)), " -> ", vm.toString(uint8(cur)));
                }
                lastSeen[id] = cur;
            }
            statusCount[uint8(cur)]++;
        }
    }

    function _allowed(IChargeMeshEscrow.Status from, IChargeMeshEscrow.Status to) internal pure returns (bool) {
        if (from == IChargeMeshEscrow.Status.None) return to == IChargeMeshEscrow.Status.Reserved;
        if (from == IChargeMeshEscrow.Status.Reserved) {
            return to == IChargeMeshEscrow.Status.Active || to == IChargeMeshEscrow.Status.Cancelled
                || to == IChargeMeshEscrow.Status.Expired;
        }
        if (from == IChargeMeshEscrow.Status.Active) {
            return to == IChargeMeshEscrow.Status.Settled || to == IChargeMeshEscrow.Status.Expired;
        }
        return false; // Settled, Cancelled, Expired are terminal.
    }

    receive() external payable {}
}
