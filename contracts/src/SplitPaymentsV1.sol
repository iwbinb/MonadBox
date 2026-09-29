// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {PullCredit} from "./lib/PullCredit.sol";
import {SplitMath} from "./lib/SplitMath.sol";

contract SplitPaymentsV1 is PullCredit {
    struct Terms { address[] recipients; uint16[] bps; bytes32 metadataHash; }
    struct Split { address creator; bytes32 termsHash; Terms terms; }
    struct Receipt { bytes32 boxId; address payer; uint256 amount; bytes32 paymentNonce; }
    mapping(bytes32 => Split) private _splits;
    mapping(bytes32 => Receipt) private _receipts;
    mapping(address => mapping(bytes32 => bool)) public usedNonce;
    event SplitPaid(bytes32 indexed boxId, bytes32 indexed paymentId, address indexed payer, uint256 amount, bytes32 paymentNonce);
    constructor(address token, address admin) PullCredit(token, admin) {}
    function createSplit(Terms calldata terms, bytes32 salt) external intakeOpen nonReentrant returns (bytes32 id) {
        SplitMath.validate(terms.recipients, terms.bps, address(this));
        if (terms.metadataHash == 0) revert InvalidTerms();
        id = boxIdFor(msg.sender, salt);
        if (_splits[id].creator != address(0)) revert AlreadyProcessed();
        bytes32 hash = keccak256(abi.encode(uint256(1), CHAIN_ID, address(this), id, address(asset), msg.sender, terms));
        _splits[id] = Split(msg.sender, hash, terms);
        emit BoxCreated(id, msg.sender, address(asset), 1, hash, terms.metadataHash);
    }
    function getSplit(bytes32 id) external view returns (Split memory) { return _split(id); }
    function getReceipt(bytes32 id) external view returns (Receipt memory) { return _receipts[id]; }
    function pay(bytes32 id, uint256 amount, bytes32 paymentNonce) external payable intakeOpen nonReentrant returns (bytes32 paymentId) {
        Split storage s = _split(id);
        if (usedNonce[msg.sender][paymentNonce]) revert AlreadyProcessed();
        usedNonce[msg.sender][paymentNonce] = true;
        paymentId = keccak256(abi.encode(CHAIN_ID, address(this), msg.sender, paymentNonce));
        _receipts[paymentId] = Receipt(id, msg.sender, amount, paymentNonce);
        _deposit(id, msg.sender, amount);
        uint256[] memory shares = SplitMath.allocate(amount, s.terms.bps);
        for (uint256 i; i < shares.length; ++i) _credit(id, s.terms.recipients[i], shares[i], keccak256("FINAL_PAYMENT"));
        emit SplitPaid(id, paymentId, msg.sender, amount, paymentNonce);
    }
    function _split(bytes32 id) private view returns (Split storage s) {
        s = _splits[id];
        if (s.creator == address(0)) revert InvalidState();
    }
}
