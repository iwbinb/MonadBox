// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {AgreementCredit} from "./lib/AgreementCredit.sol";

contract DeliveryEscrowV1 is AgreementCredit {
    enum State { NONE, AWAITING_FUNDS, FUNDED, SUBMITTED, DISPUTED, RELEASED, REFUNDED, RESOLVED, CANCELLED, EXPIRED }
    struct Terms {
        address buyer; address seller; uint256 amount; uint64 fundBy;
        uint64 workDuration; uint64 reviewDuration; uint64 disputeDuration; bytes32 metadataHash;
    }
    struct Offer {
        address creator; bytes32 termsHash; State state; Terms terms;
        uint64 submitDue; uint64 reviewDue; uint64 disputeDue; uint64 settledAt;
        bytes32 evidenceHash; bytes32 reasonHash;
    }
    mapping(bytes32 => Offer) private _offers;
    event DeliverySubmitted(bytes32 indexed boxId, bytes32 evidenceHash, uint64 reviewDue, uint256 stageIndex);
    event Disputed(bytes32 indexed boxId, bytes32 reasonHash, uint64 disputeDue, uint256 stageIndex);
    constructor(address token,address admin) AgreementCredit(token,admin,"DeliveryEscrowV1") {}
    function createOffer(Terms calldata t, bytes32 salt) external intakeOpen nonReentrant returns(bytes32 id) {
        _durations(t.workDuration,t.reviewDuration,t.disputeDuration);
        if(t.buyer==address(0)||t.seller==address(0)||t.buyer==t.seller||t.buyer==address(this)||t.seller==address(this)
            || t.amount==0||t.fundBy<=block.timestamp||t.metadataHash==0) revert InvalidTerms();
        if(msg.sender!=t.buyer&&msg.sender!=t.seller) revert NotAuthorized();
        id=boxIdFor(msg.sender,salt);
        if(_offers[id].creator!=address(0)) revert AlreadyProcessed();
        Offer storage o=_offers[id];o.creator=msg.sender;o.terms=t;o.state=State.AWAITING_FUNDS;
        o.termsHash=keccak256(abi.encode(uint256(1),CHAIN_ID,address(this),id,address(asset),msg.sender,t));
        emit BoxCreated(id,msg.sender,address(asset),1,o.termsHash,t.metadataHash);
    }
    function getOffer(bytes32 id) external view returns(Offer memory){return _offer(id);}
    function fund(bytes32 id) external intakeOpen nonReentrant {
        Offer storage o=_offer(id);
        if(o.state!=State.AWAITING_FUNDS) revert InvalidState();
        if(msg.sender!=o.terms.buyer) revert NotAuthorized();
        if(block.timestamp>=o.terms.fundBy) revert WindowClosed();
        o.state=State.FUNDED;o.submitDue=uint64(block.timestamp)+o.terms.workDuration;
        _deposit(id,msg.sender,o.terms.amount);_action(id,"fund",0);
    }
    function cancelOffer(bytes32 id) external nonReentrant {
        Offer storage o=_offer(id);if(o.state!=State.AWAITING_FUNDS)revert InvalidState();
        if(block.timestamp>=o.terms.fundBy)o.state=State.EXPIRED;
        else {if(msg.sender!=o.terms.buyer&&msg.sender!=o.terms.seller)revert NotAuthorized();o.state=State.CANCELLED;}
        o.settledAt=uint64(block.timestamp);_action(id,"cancelOffer",0);
    }
    function submitDelivery(bytes32 id,bytes32 evidenceHash) external nonReentrant {
        Offer storage o=_offer(id);
        if(o.state!=State.FUNDED)revert InvalidState();
        if(msg.sender!=o.terms.seller)revert NotAuthorized();
        if(block.timestamp>=o.submitDue)revert WindowClosed();
        if(evidenceHash==0)revert InvalidTerms();
        o.state=State.SUBMITTED;o.evidenceHash=evidenceHash;o.reviewDue=uint64(block.timestamp)+o.terms.reviewDuration;
        emit DeliverySubmitted(id,evidenceHash,o.reviewDue,0);_action(id,"submitDelivery",0);
    }
    function accept(bytes32 id) external nonReentrant {
        Offer storage o=_offer(id);if(o.state!=State.SUBMITTED)revert InvalidState();
        if(msg.sender!=o.terms.buyer)revert NotAuthorized();
        _release(id,o);_action(id,"accept",0);
    }
    function settleAfterReview(bytes32 id) external nonReentrant {
        Offer storage o=_offer(id);if(o.state!=State.SUBMITTED)revert InvalidState();
        if(block.timestamp<o.reviewDue)revert WindowNotStarted();
        _release(id,o);_action(id,"settleAfterReview",0);
    }
    function dispute(bytes32 id,bytes32 reasonHash) external nonReentrant {
        Offer storage o=_offer(id);if(o.state!=State.SUBMITTED)revert InvalidState();
        if(msg.sender!=o.terms.buyer)revert NotAuthorized();
        if(block.timestamp>=o.reviewDue)revert WindowClosed();
        if(reasonHash==0)revert InvalidTerms();
        o.state=State.DISPUTED;o.reasonHash=reasonHash;o.disputeDue=uint64(block.timestamp)+o.terms.disputeDuration;
        emit Disputed(id,reasonHash,o.disputeDue,0);_action(id,"dispute",0);
    }
    function refundBySeller(bytes32 id) external nonReentrant {
        Offer storage o=_offer(id);if(msg.sender!=o.terms.seller)revert NotAuthorized();
        if(o.state!=State.FUNDED&&o.state!=State.SUBMITTED&&o.state!=State.DISPUTED)revert InvalidState();
        _refund(id,o);_action(id,"refundBySeller",0);
    }
    function refundAfterMissingDelivery(bytes32 id) external nonReentrant {
        Offer storage o=_offer(id);if(o.state!=State.FUNDED)revert InvalidState();
        if(block.timestamp<o.submitDue)revert WindowNotStarted();
        _refund(id,o);_action(id,"refundAfterMissingDelivery",0);
    }
    function refundAfterDisputeTimeout(bytes32 id) external nonReentrant {
        Offer storage o=_offer(id);if(o.state!=State.DISPUTED)revert InvalidState();
        if(block.timestamp<o.disputeDue)revert WindowNotStarted();
        _refund(id,o);_action(id,"refundAfterDisputeTimeout",0);
    }
    function resolveByAgreement(Agreement calldata a,bytes calldata buyerSignature,bytes calldata sellerSignature) external nonReentrant {
        Offer storage o=_offer(a.boxId);if(o.state!=State.DISPUTED)revert InvalidState();
        if(a.orderId!=a.boxId||a.termsHash!=o.termsHash||a.buyer!=o.terms.buyer||a.seller!=o.terms.seller
            ||a.remaining!=locked[a.boxId]||a.stageIndex!=0)revert InvalidTerms();
        o.state=State.RESOLVED;o.settledAt=uint64(block.timestamp);
        _consumeAgreement(a,buyerSignature,sellerSignature,o.terms.buyer,o.terms.seller,o.disputeDue);
        _action(a.boxId,"resolveByAgreement",0);
    }
    function _release(bytes32 id,Offer storage o) private {
        o.state=State.RELEASED;o.settledAt=uint64(block.timestamp);_credit(id,o.terms.seller,locked[id],keccak256("RELEASE"));
    }
    function _refund(bytes32 id,Offer storage o) private {
        o.state=State.REFUNDED;o.settledAt=uint64(block.timestamp);_credit(id,o.terms.buyer,locked[id],keccak256("REFUND"));
    }
    function _offer(bytes32 id) private view returns(Offer storage o){o=_offers[id];if(o.creator==address(0))revert InvalidState();}
}
