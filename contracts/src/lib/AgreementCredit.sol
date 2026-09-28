// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {PullCredit} from "./PullCredit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @dev Each module must compare every agreement field with its still-disputed order before consuming it.
abstract contract AgreementCredit is PullCredit {
    // Standard EIP-712 encoding with a fixed name/version; avoid Cancun-only helpers in the pinned OZ package.
    bytes32 public immutable domainNameHash;
    bytes32 private constant DOMAIN_TYPEHASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    struct Agreement {
        uint256 schemaVersion; bytes32 boxId; bytes32 orderId; bytes32 termsHash; address asset;
        uint256 remaining; address buyer; address seller; uint256 buyerAmount; uint256 sellerAmount;
        uint256 settlementNonce; uint64 deadline; uint256 stageIndex;
    }
    bytes32 public constant AGREEMENT_TYPEHASH = keccak256("Agreement(uint256 schemaVersion,bytes32 boxId,bytes32 orderId,bytes32 termsHash,address asset,uint256 remaining,address buyer,address seller,uint256 buyerAmount,uint256 sellerAmount,uint256 settlementNonce,uint64 deadline,uint256 stageIndex)");
    mapping(bytes32 => uint256) public settlementNonce;
    event ActionExecuted(bytes32 indexed boxId, address indexed actor, bytes32 action, uint256 stageIndex);
    event AgreementResolved(bytes32 indexed boxId, bytes32 indexed orderId, uint256 buyerAmount, uint256 sellerAmount, uint256 nonce, uint256 stageIndex);
    constructor(address token, address admin, string memory name) PullCredit(token, admin) { domainNameHash = keccak256(bytes(name)); }
    function domainSeparator() public view returns(bytes32) { return keccak256(abi.encode(DOMAIN_TYPEHASH,domainNameHash,keccak256("1"),block.chainid,address(this))); }
    function agreementDigest(Agreement calldata a) public view returns(bytes32) {
        // All Agreement members are static ABI types, so encoding the struct equals their ordered concatenation.
        return keccak256(abi.encodePacked(hex"1901",domainSeparator(),keccak256(abi.encode(AGREEMENT_TYPEHASH, a))));
    }
    function _consumeAgreement(Agreement calldata a, bytes calldata first, bytes calldata second, address signerA, address signerB, uint64 disputeDue) internal {
        if (a.schemaVersion != 1 || a.asset != address(asset) || a.remaining == 0 || a.buyerAmount > a.remaining
            || a.sellerAmount != a.remaining-a.buyerAmount || a.settlementNonce != settlementNonce[a.orderId]) revert InvalidTerms();
        if (a.deadline > disputeDue || block.timestamp >= a.deadline || block.timestamp >= disputeDue) revert WindowClosed();
        if (signerA.code.length != 0 || signerB.code.length != 0) revert InvalidSignature();
        bytes32 digest = agreementDigest(a);
        if (ECDSA.recover(digest,first) != signerA || ECDSA.recover(digest,second) != signerB) revert InvalidSignature();
        ++settlementNonce[a.orderId];
        _credit(a.boxId,a.buyer,a.buyerAmount,keccak256("AGREEMENT"));
        _credit(a.boxId,a.seller,a.sellerAmount,keccak256("AGREEMENT"));
        emit AgreementResolved(a.boxId,a.orderId,a.buyerAmount,a.sellerAmount,a.settlementNonce,a.stageIndex);
    }
    function _action(bytes32 id, string memory name, uint256 stage) internal { emit ActionExecuted(id,msg.sender,keccak256(bytes(name)),stage); }
    function _durations(uint64 work, uint64 review, uint64 dispute) internal pure {
        if (work < 1 hours || work > 30 days || review < 1 hours || review > 7 days || dispute < 1 days || dispute > 30 days) revert InvalidTerms();
    }
}
