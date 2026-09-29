// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {PullCredit} from "./lib/PullCredit.sol";
import {SplitMath} from "./lib/SplitMath.sol";

/// @notice Group V1 exits remain at V1 addresses; this separate deployment freezes its split at creation.
contract GroupEscrowV2 is PullCredit {
    enum State { NONE, OPEN, READY, REFUNDABLE, CANCELLED, SETTLED }
    enum Position { NONE, ACTIVE, LEFT, REFUNDED }
    struct Terms {
        uint256 unitPrice; uint32 minParticipants; uint32 capacity;
        uint64 startsAt; uint64 fundingDeadline; uint64 settleNotBefore;
        address[] recipients; uint16[] bps; bytes32 metadataHash;
    }
    struct Group { address creator; bytes32 termsHash; State state; uint32 activeCount; Terms terms; }
    mapping(bytes32 => Group) private _groups;
    mapping(bytes32 => mapping(address => Position)) public positions;
    error CapacityReached();
    error AlreadyParticipated();
    event ParticipantLeft(bytes32 indexed boxId, address indexed participant);
    event GroupFinalized(bytes32 indexed boxId, State state, uint32 activeCount);
    event GroupCancelled(bytes32 indexed boxId);
    event GroupSettled(bytes32 indexed boxId, uint256 amount);
    constructor(address token, address admin) PullCredit(token, admin) {}
    function createGroup(Terms calldata terms, bytes32 salt) external intakeOpen nonReentrant returns (bytes32 id) {
        SplitMath.validate(terms.recipients, terms.bps, address(this));
        if (terms.unitPrice == 0 || terms.minParticipants < 2 || terms.capacity < terms.minParticipants || terms.capacity > 200
            || terms.unitPrice > type(uint256).max / terms.capacity || terms.startsAt < block.timestamp
            || terms.startsAt >= terms.fundingDeadline || terms.fundingDeadline > terms.settleNotBefore || terms.metadataHash == 0)
            revert InvalidTerms();
        id = boxIdFor(msg.sender, salt);
        if (_groups[id].creator != address(0)) revert AlreadyProcessed();
        bytes32 hash = keccak256(abi.encode(uint256(2), CHAIN_ID, address(this), id, address(asset), msg.sender, terms));
        _groups[id] = Group(msg.sender, hash, State.OPEN, 0, terms);
        emit BoxCreated(id, msg.sender, address(asset), 2, hash, terms.metadataHash);
    }
    function getGroup(bytes32 id) external view returns (Group memory) { return _group(id); }
    function effectiveState(bytes32 id) public view returns (State) {
        Group storage g = _group(id);
        if (g.state == State.OPEN && block.timestamp >= g.terms.fundingDeadline)
            return g.activeCount >= g.terms.minParticipants ? State.READY : State.REFUNDABLE;
        return g.state;
    }
    function contribute(bytes32 id) external payable intakeOpen nonReentrant {
        Group storage g = _group(id);
        if (g.state != State.OPEN) revert InvalidState();
        if (block.timestamp < g.terms.startsAt) revert WindowNotStarted();
        if (block.timestamp >= g.terms.fundingDeadline) revert WindowClosed();
        if (positions[id][msg.sender] != Position.NONE) revert AlreadyParticipated();
        if (g.activeCount >= g.terms.capacity) revert CapacityReached();
        positions[id][msg.sender] = Position.ACTIVE; ++g.activeCount;
        _deposit(id, msg.sender, g.terms.unitPrice);
    }
    function leave(bytes32 id) external nonReentrant {
        Group storage g = _group(id);
        if (g.state != State.OPEN) revert InvalidState();
        if (block.timestamp >= g.terms.fundingDeadline) revert WindowClosed();
        if (positions[id][msg.sender] != Position.ACTIVE) revert AlreadyProcessed();
        positions[id][msg.sender] = Position.LEFT; --g.activeCount;
        _credit(id, msg.sender, g.terms.unitPrice, keccak256("EXIT"));
        emit ParticipantLeft(id, msg.sender);
    }
    function finalize(bytes32 id) external nonReentrant { _finalize(id, _group(id)); }
    function cancel(bytes32 id) external nonReentrant {
        Group storage g = _group(id);
        if (msg.sender != g.creator) revert NotAuthorized();
        if (g.state != State.OPEN && g.state != State.READY) revert InvalidState();
        g.state = State.CANCELLED; emit GroupCancelled(id);
    }
    function creditRefund(bytes32 id, address participant) external nonReentrant {
        Group storage g = _group(id);
        if (g.state == State.OPEN) _finalize(id, g);
        if (g.state != State.REFUNDABLE && g.state != State.CANCELLED) revert InvalidState();
        if (positions[id][participant] != Position.ACTIVE) revert AlreadyProcessed();
        positions[id][participant] = Position.REFUNDED; --g.activeCount;
        _credit(id, participant, g.terms.unitPrice, keccak256("REFUND"));
    }
    function settle(bytes32 id) external nonReentrant {
        Group storage g = _group(id);
        if (g.state == State.OPEN) _finalize(id, g);
        if (g.state != State.READY) revert InvalidState();
        if (block.timestamp < g.terms.settleNotBefore) revert WindowNotStarted();
        g.state = State.SETTLED;
        uint256 amount = locked[id];
        uint256[] memory shares = SplitMath.allocate(amount, g.terms.bps);
        for (uint256 i; i < shares.length; ++i) _credit(id, g.terms.recipients[i], shares[i], keccak256("SETTLEMENT"));
        emit GroupSettled(id, amount);
    }
    function _finalize(bytes32 id, Group storage g) private {
        if (g.state != State.OPEN) revert InvalidState();
        if (block.timestamp < g.terms.fundingDeadline) revert WindowNotStarted();
        g.state = g.activeCount >= g.terms.minParticipants ? State.READY : State.REFUNDABLE;
        emit GroupFinalized(id, g.state, g.activeCount);
    }
    function _group(bytes32 id) private view returns (Group storage g) {
        g = _groups[id]; if (g.creator == address(0)) revert InvalidState();
    }
}
