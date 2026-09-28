// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev Fixed-asset accounting only. Derived modules define every entitlement and recipient.
abstract contract PullCredit is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant CHAIN_ID = 10143;
    IERC20 public immutable asset;
    address public immutable intakeAdmin;
    bool public intakePaused;
    mapping(bytes32 => uint256) public locked;
    mapping(bytes32 => mapping(address => uint256)) public creditForBox;
    mapping(bytes32 => mapping(address => uint256)) public withdrawnForBox;
    mapping(address => uint256) public creditOf;
    uint256 public totalDeposited;
    uint256 public totalLocked;
    uint256 public totalCredits;
    uint256 public totalWithdrawn;

    error InvalidTerms();
    error WrongChain();
    error NotAuthorized();
    error InvalidState();
    error WindowNotStarted();
    error WindowClosed();
    error AlreadyProcessed();
    error NothingToWithdraw();
    error TransferAmountMismatch();
    error IntakePaused();
    error InvalidSignature();

    event BoxCreated(bytes32 indexed boxId, address indexed creator, address indexed asset, uint256 version, bytes32 termsHash, bytes32 metadataHash);
    event Funded(bytes32 indexed boxId, address indexed payer, uint256 amount);
    event CreditAssigned(bytes32 indexed boxId, address indexed beneficiary, uint256 amount, bytes32 reason);
    event Withdrawal(bytes32 indexed boxId, address indexed beneficiary, uint256 amount);
    event IntakePauseChanged(bool paused);

    constructor(address token, address admin) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (token.code.length == 0 || admin == address(0)) revert InvalidTerms();
        asset = IERC20(token);
        intakeAdmin = admin;
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
    function _deposit(bytes32 id, address payer, uint256 amount) internal {
        if (amount == 0) revert InvalidTerms();
        locked[id] += amount; totalLocked += amount; totalDeposited += amount;
        uint256 beforeBalance = asset.balanceOf(address(this));
        asset.safeTransferFrom(payer, address(this), amount);
        if (asset.balanceOf(address(this)) != beforeBalance + amount) revert TransferAmountMismatch();
        emit Funded(id, payer, amount);
    }
    function _credit(bytes32 id, address recipient, uint256 amount, bytes32 reason) internal {
        if (amount == 0) return;
        locked[id] -= amount; totalLocked -= amount;
        creditForBox[id][recipient] += amount; creditOf[recipient] += amount; totalCredits += amount;
        emit CreditAssigned(id, recipient, amount, reason);
    }
    function withdrawFor(bytes32 id, address beneficiary) external nonReentrant {
        uint256 amount = creditForBox[id][beneficiary];
        if (amount == 0) revert NothingToWithdraw();
        creditForBox[id][beneficiary] = 0; creditOf[beneficiary] -= amount; totalCredits -= amount;
        withdrawnForBox[id][beneficiary] += amount; totalWithdrawn += amount;
        uint256 beforeSender = asset.balanceOf(address(this));
        uint256 beforeRecipient = asset.balanceOf(beneficiary);
        asset.safeTransfer(beneficiary, amount);
        if (asset.balanceOf(address(this)) != beforeSender - amount || asset.balanceOf(beneficiary) != beforeRecipient + amount)
            revert TransferAmountMismatch();
        emit Withdrawal(id, beneficiary, amount);
    }
}
