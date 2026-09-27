// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Test-only payment/refund probe. Not a MonadBox business escrow.
/// No admin, upgrade, alternate refund address, fee or expiry. No mainnet deployment.
contract M0CProbe is ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant CHAIN_ID = 10143;
    uint256 public constant MAX_AMOUNT = 1_000_000; // At most 1 test token per wallet outstanding.
    IERC20 public immutable token;
    struct Payment { address payer; uint256 amount; bool refunded; }
    mapping(bytes32 => Payment) public payments;
    mapping(address => uint256) public lockedBy;
    uint256 public totalLocked;

    error WrongChain();
    error InvalidToken();
    error InvalidAmount();
    error AlreadyUsed();
    error NothingToRefund();
    error TransferAmountMismatch();
    event Funded(bytes32 indexed id, address indexed payer, uint256 amount);
    event Refunded(bytes32 indexed id, address indexed payer, uint256 amount);

    constructor(address asset) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (asset.code.length == 0 || IERC20Metadata(asset).decimals() != 6) revert InvalidToken();
        token = IERC20(asset);
    }

    function paymentId(address payer, bytes32 nonce) public view returns (bytes32) {
        return keccak256(abi.encode(CHAIN_ID, address(this), payer, nonce));
    }

    function fund(bytes32 nonce, uint256 amount) external nonReentrant returns (bytes32 id) {
        if (block.chainid != CHAIN_ID) revert WrongChain();
        if (amount == 0 || amount > MAX_AMOUNT || lockedBy[msg.sender] + amount > MAX_AMOUNT) {
            revert InvalidAmount();
        }
        id = paymentId(msg.sender, nonce);
        if (payments[id].payer != address(0)) revert AlreadyUsed();
        payments[id] = Payment(msg.sender, amount, false);
        lockedBy[msg.sender] += amount;
        totalLocked += amount;
        uint256 beforeBalance = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), amount);
        if (token.balanceOf(address(this)) != beforeBalance + amount) revert TransferAmountMismatch();
        emit Funded(id, msg.sender, amount);
    }

    /// @notice Anyone may pay the gas; tokens ALWAYS return to the original payer.
    /// State and transfers are atomic; a failed token transfer preserves the claim.
    function refund(bytes32 id) external nonReentrant {
        Payment storage payment = payments[id];
        if (payment.payer == address(0) || payment.refunded) revert NothingToRefund();
        payment.refunded = true;
        lockedBy[payment.payer] -= payment.amount;
        totalLocked -= payment.amount;
        uint256 beforeBalance = token.balanceOf(address(this));
        uint256 beforeRecipient = token.balanceOf(payment.payer);
        token.safeTransfer(payment.payer, payment.amount);
        if (token.balanceOf(payment.payer) != beforeRecipient + payment.amount) revert TransferAmountMismatch();
        if (token.balanceOf(address(this)) + payment.amount != beforeBalance) revert TransferAmountMismatch();
        emit Refunded(id, payment.payer, payment.amount);
    }
}
