// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Single-asset, immutable-rule group collection for Monad TESTNET ONLY.
/// @dev Credits are not wallet transfers. No upgrade, sweep or discretionary release method.
contract GroupEscrowV1 is ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant CHAIN_ID = 10143;
    uint32 public constant MAX_CAPACITY = 200;
    IERC20 public immutable asset;
    address public immutable intakeAdmin;
    bool public intakePaused;

    enum State { NONE, OPEN, READY, REFUNDABLE, CANCELLED, SETTLED }
    enum Position { NONE, ACTIVE, LEFT, REFUNDED }
    enum CreditReason { EXIT, REFUND, SETTLEMENT }

    struct Terms {
        address beneficiary;
        uint256 unitPrice;
        uint32 minParticipants;
        uint32 capacity;
        uint64 startsAt;
        uint64 fundingDeadline;
        uint64 settleNotBefore;
        bytes32 metadataHash;
    }
    struct Group {
        address creator;
        Terms terms;
        bytes32 termsHash;
        State state;
        uint32 activeCount;
        uint256 locked;
    }

    mapping(bytes32 => Group) private _groups;
    mapping(bytes32 => mapping(address => Position)) public positions;
    mapping(bytes32 => mapping(address => uint256)) public creditForBox;
    mapping(bytes32 => mapping(address => uint256)) public withdrawnForBox;
    mapping(address => uint256) public creditOf;
    uint256 public totalDeposited;
    uint256 public totalLocked;
    uint256 public totalCredits;
    uint256 public totalWithdrawn;

    error InvalidTerms();
    error WrongChain();
    error UnknownGroup();
    error NotAuthorized();
    error InvalidState();
    error WindowNotStarted();
    error WindowClosed();
    error CapacityReached();
    error AlreadyParticipated();
    error AlreadyProcessed();
    error NothingToWithdraw();
    error TransferAmountMismatch();
    error IntakePaused();

    event BoxCreated(bytes32 indexed boxId, address indexed creator, address indexed asset,
        address beneficiary, bytes32 termsHash, bytes32 metadataHash);
    event Funded(bytes32 indexed boxId, address indexed participant, uint256 amount);
    event ParticipantLeft(bytes32 indexed boxId, address indexed participant);
    event GroupFinalized(bytes32 indexed boxId, State state, uint32 activeCount);
    event GroupCancelled(bytes32 indexed boxId);
    event GroupSettled(bytes32 indexed boxId, uint256 amount);
    event CreditAssigned(bytes32 indexed boxId, address indexed beneficiary, uint256 amount, CreditReason reason);
    event Withdrawal(bytes32 indexed boxId, address indexed beneficiary, uint256 amount);
    event IntakePauseChanged(bool paused);

    constructor(address asset_, address intakeAdmin_) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (asset_.code.length == 0 || intakeAdmin_ == address(0)) revert InvalidTerms();
        asset = IERC20(asset_);
        intakeAdmin = intakeAdmin_;
    }

    modifier intakeOpen() {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (intakePaused) revert IntakePaused();
        _;
    }

    function setIntakePaused(bool paused) external {
        if (msg.sender != intakeAdmin) revert NotAuthorized();
        intakePaused = paused;
        emit IntakePauseChanged(paused);
    }

    function boxIdFor(address creator, bytes32 salt) public view returns (bytes32) {
        return keccak256(abi.encode(CHAIN_ID, address(this), creator, salt));
    }

    function createGroup(Terms calldata terms, bytes32 salt) external intakeOpen nonReentrant returns (bytes32 id) {
        if (terms.beneficiary == address(0) || terms.beneficiary == address(this)
            || terms.unitPrice == 0 || terms.minParticipants < 2
            || terms.capacity < terms.minParticipants || terms.capacity > MAX_CAPACITY
            || terms.unitPrice > type(uint256).max / terms.capacity
            || terms.startsAt < block.timestamp || terms.startsAt >= terms.fundingDeadline
            || terms.fundingDeadline > terms.settleNotBefore || terms.metadataHash == bytes32(0)) revert InvalidTerms();
        id = boxIdFor(msg.sender, salt);
        if (_groups[id].creator != address(0)) revert AlreadyProcessed();
        bytes32 hash = keccak256(abi.encode(uint256(1), CHAIN_ID, address(this), id, address(asset), msg.sender, terms));
        _groups[id] = Group(msg.sender, terms, hash, State.OPEN, 0, 0);
        emit BoxCreated(id, msg.sender, address(asset), terms.beneficiary, hash, terms.metadataHash);
    }

    function getGroup(bytes32 id) external view returns (Group memory) { return _group(id); }

    function effectiveState(bytes32 id) public view returns (State) {
        Group storage g = _group(id);
        if (g.state == State.OPEN && block.timestamp >= g.terms.fundingDeadline)
            return g.activeCount >= g.terms.minParticipants ? State.READY : State.REFUNDABLE;
        return g.state;
    }

    function contribute(bytes32 id) external intakeOpen nonReentrant {
        Group storage g = _group(id);
        if (g.state != State.OPEN) revert InvalidState();
        if (block.timestamp < g.terms.startsAt) revert WindowNotStarted();
        if (block.timestamp >= g.terms.fundingDeadline) revert WindowClosed();
        if (positions[id][msg.sender] != Position.NONE) revert AlreadyParticipated();
        if (g.activeCount >= g.terms.capacity) revert CapacityReached();
        positions[id][msg.sender] = Position.ACTIVE;
        ++g.activeCount;
        uint256 amount = g.terms.unitPrice;
        g.locked += amount;
        totalLocked += amount;
        totalDeposited += amount;
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(msg.sender, address(this), amount);
        if (asset.balanceOf(address(this)) != beforeBalance + amount) revert TransferAmountMismatch();
        emit Funded(id, msg.sender, amount);
    }

    function leave(bytes32 id) external nonReentrant {
        Group storage g = _group(id);
        if (g.state != State.OPEN) revert InvalidState();
        if (block.timestamp >= g.terms.fundingDeadline) revert WindowClosed();
        if (positions[id][msg.sender] != Position.ACTIVE) revert AlreadyProcessed();
        positions[id][msg.sender] = Position.LEFT;
        --g.activeCount;
        _credit(id, g, msg.sender, g.terms.unitPrice, CreditReason.EXIT);
        emit ParticipantLeft(id, msg.sender);
    }

    function finalize(bytes32 id) external nonReentrant returns (State) {
        Group storage g = _group(id);
        _finalize(id, g);
        return g.state;
    }

    function cancel(bytes32 id) external nonReentrant {
        Group storage g = _group(id);
        if (msg.sender != g.creator) revert NotAuthorized();
        if (g.state != State.OPEN && g.state != State.READY) revert InvalidState();
        g.state = State.CANCELLED;
        emit GroupCancelled(id);
    }

    function creditRefund(bytes32 id, address participant) external nonReentrant {
        Group storage g = _group(id);
        if (g.state == State.OPEN) _finalize(id, g);
        if (g.state != State.REFUNDABLE && g.state != State.CANCELLED) revert InvalidState();
        if (positions[id][participant] != Position.ACTIVE) revert AlreadyProcessed();
        positions[id][participant] = Position.REFUNDED;
        --g.activeCount;
        _credit(id, g, participant, g.terms.unitPrice, CreditReason.REFUND);
    }

    function settle(bytes32 id) external nonReentrant {
        Group storage g = _group(id);
        if (g.state == State.OPEN) _finalize(id, g);
        if (g.state != State.READY) revert InvalidState();
        if (block.timestamp < g.terms.settleNotBefore) revert WindowNotStarted();
        g.state = State.SETTLED;
        uint256 amount = g.locked;
        _credit(id, g, g.terms.beneficiary, amount, CreditReason.SETTLEMENT);
        emit GroupSettled(id, amount);
    }

    /// @notice Anyone may pay gas, but the recipient is always the credited address.
    function withdrawFor(bytes32 id, address beneficiary) external nonReentrant {
        uint256 amount = creditForBox[id][beneficiary];
        if (amount == 0) revert NothingToWithdraw();
        creditForBox[id][beneficiary] = 0;
        creditOf[beneficiary] -= amount;
        totalCredits -= amount;
        totalWithdrawn += amount;
        withdrawnForBox[id][beneficiary] += amount;
        uint256 beforeBalance = asset.balanceOf(address(this));
        uint256 beforeRecipient = asset.balanceOf(beneficiary);
        asset.safeTransfer(beneficiary, amount);
        if (asset.balanceOf(address(this)) != beforeBalance - amount
            || asset.balanceOf(beneficiary) != beforeRecipient + amount) revert TransferAmountMismatch();
        emit Withdrawal(id, beneficiary, amount);
    }

    function _group(bytes32 id) private view returns (Group storage g) {
        g = _groups[id];
        if (g.creator == address(0)) revert UnknownGroup();
    }

    function _finalize(bytes32 id, Group storage g) private {
        if (g.state != State.OPEN) revert InvalidState();
        if (block.timestamp < g.terms.fundingDeadline) revert WindowNotStarted();
        g.state = g.activeCount >= g.terms.minParticipants ? State.READY : State.REFUNDABLE;
        emit GroupFinalized(id, g.state, g.activeCount);
    }

    function _credit(bytes32 id, Group storage g, address beneficiary, uint256 amount, CreditReason reason) private {
        g.locked -= amount;
        totalLocked -= amount;
        totalCredits += amount;
        creditForBox[id][beneficiary] += amount;
        creditOf[beneficiary] += amount;
        emit CreditAssigned(id, beneficiary, amount, reason);
    }
}
