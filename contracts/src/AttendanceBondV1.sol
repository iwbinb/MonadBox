// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {AgreementCredit} from "./lib/AgreementCredit.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract AttendanceBondV1 is AgreementCredit {
    enum Position { NONE, REGISTERED, LEFT, CHECKED_IN, DISPUTED, SETTLED }
    struct Terms {
        uint256 deposit; uint16 capacity; uint64 registrationDeadline; uint64 eventStart; uint64 eventEnd;
        uint64 checkinStart; uint64 checkinDeadline; uint64 challengeDeadline; uint64 disputeDuration;
        uint16 noShowPenaltyBps; address penaltyBeneficiary; address checkinSigner; bytes32 metadataHash;
    }
    struct EventData { address creator; bytes32 termsHash; Terms terms; uint16 activeCount; bool cancelled; }
    struct Attendance {Position state; uint64 disputeDue; bytes32 reasonHash;}
    struct CheckIn {
        uint256 schemaVersion; bytes32 boxId; bytes32 termsHash; address attendee; address signer;
        uint64 issuedAt; uint64 deadline; uint256 nonce;
    }
    bytes32 public constant CHECKIN_TYPEHASH=keccak256("CheckIn(uint256 schemaVersion,bytes32 boxId,bytes32 termsHash,address attendee,address signer,uint64 issuedAt,uint64 deadline,uint256 nonce)");
    mapping(bytes32=>EventData) private _events;
    mapping(bytes32=>mapping(address=>Attendance)) private _attendees;
    mapping(bytes32=>uint256) public checkinNonce;
    event CheckInAccepted(bytes32 indexed boxId,address indexed attendee,uint256 nonce);
    event NoShowFinalized(bytes32 indexed boxId,address indexed attendee,uint256 penalty,uint256 refund);
    event AttendanceChanged(bytes32 indexed boxId,address indexed attendee,Position state,uint64 disputeDue);
    event EventCancelled(bytes32 indexed boxId);
    constructor(address token,address admin) AgreementCredit(token,admin,"AttendanceBondV1"){}
    function orderIdFor(bytes32 id,address attendee) public pure returns(bytes32){return keccak256(abi.encode(id,attendee));}
    function createEvent(Terms calldata t,bytes32 salt) external intakeOpen nonReentrant returns(bytes32 id){
        if(t.deposit==0||t.capacity==0||t.capacity>200||t.deposit>type(uint256).max/t.capacity
            ||t.registrationDeadline<=block.timestamp||t.registrationDeadline>t.eventStart||t.eventStart>=t.eventEnd
            ||t.checkinStart>t.eventStart||t.checkinDeadline<t.eventEnd||t.challengeDeadline<=t.checkinDeadline
            ||t.disputeDuration<1 days||t.disputeDuration>30 days||t.noShowPenaltyBps>10000
            ||t.penaltyBeneficiary==address(0)||t.penaltyBeneficiary==address(this)||t.checkinSigner==address(0)
            ||t.checkinSigner.code.length!=0||t.metadataHash==0)revert InvalidTerms();
        id=boxIdFor(msg.sender,salt);if(_events[id].creator!=address(0))revert AlreadyProcessed();
        EventData storage e=_events[id];e.creator=msg.sender;e.terms=t;
        e.termsHash=keccak256(abi.encode(uint256(1),CHAIN_ID,address(this),id,address(asset),msg.sender,t));
        emit BoxCreated(id,msg.sender,address(asset),1,e.termsHash,t.metadataHash);
    }
    function getEvent(bytes32 id) external view returns(EventData memory){return _event(id);}
    function getAttendance(bytes32 id,address participant) external view returns(Attendance memory){_event(id);return _attendees[id][participant];}
    function register(bytes32 id) external intakeOpen nonReentrant {
        EventData storage e=_event(id);if(e.cancelled)revert InvalidState();if(block.timestamp>=e.terms.registrationDeadline)revert WindowClosed();
        Attendance storage a=_attendees[id][msg.sender];if(a.state!=Position.NONE)revert AlreadyProcessed();if(e.activeCount>=e.terms.capacity)revert InvalidState();
        a.state=Position.REGISTERED;++e.activeCount;_deposit(id,msg.sender,e.terms.deposit);_changed(id,msg.sender,"register");
    }
    function leave(bytes32 id) external nonReentrant {
        EventData storage e=_event(id);if(block.timestamp>=e.terms.registrationDeadline)revert WindowClosed();
        Attendance storage a=_attendees[id][msg.sender];if(a.state!=Position.REGISTERED)revert InvalidState();
        a.state=Position.LEFT;--e.activeCount;_credit(id,msg.sender,e.terms.deposit,keccak256("LEFT"));_changed(id,msg.sender,"leave");
    }
    function checkInDigest(CheckIn calldata p) public view returns(bytes32){return keccak256(abi.encodePacked(hex"1901",domainSeparator(),keccak256(abi.encode(CHECKIN_TYPEHASH,p))));}
    function checkIn(CheckIn calldata p,bytes calldata signature) external nonReentrant {
        EventData storage e=_event(p.boxId);Attendance storage a=_attendees[p.boxId][p.attendee];
        if(e.cancelled||a.state!=Position.REGISTERED)revert InvalidState();
        if(block.timestamp<e.terms.checkinStart)revert WindowNotStarted();
        if(block.timestamp>=e.terms.checkinDeadline||block.timestamp>=p.deadline)revert WindowClosed();
        bytes32 order=orderIdFor(p.boxId,p.attendee);
        if(p.schemaVersion!=1||p.termsHash!=e.termsHash||p.signer!=e.terms.checkinSigner||p.nonce!=checkinNonce[order]
            ||p.issuedAt<e.terms.checkinStart||p.issuedAt>block.timestamp||p.deadline>e.terms.checkinDeadline||p.deadline<=p.issuedAt)revert InvalidTerms();
        if(p.signer.code.length!=0||ECDSA.recover(checkInDigest(p),signature)!=p.signer)revert InvalidSignature();
        ++checkinNonce[order];a.state=Position.CHECKED_IN;_credit(p.boxId,p.attendee,e.terms.deposit,keccak256("CHECKED_IN"));
        emit CheckInAccepted(p.boxId,p.attendee,p.nonce);_changed(p.boxId,p.attendee,"checkIn");
    }
    function cancelEvent(bytes32 id) external nonReentrant {
        EventData storage e=_event(id);if(msg.sender!=e.creator)revert NotAuthorized();if(e.cancelled)revert AlreadyProcessed();
        if(block.timestamp>=e.terms.challengeDeadline)revert WindowClosed();e.cancelled=true;emit EventCancelled(id);_action(id,"cancelEvent",0);
    }
    function creditRefund(bytes32 id,address participant) external nonReentrant {
        EventData storage e=_event(id);Attendance storage a=_attendees[id][participant];
        if(!e.cancelled||(a.state!=Position.REGISTERED&&a.state!=Position.DISPUTED))revert InvalidState();
        _refund(id,participant,e.terms.deposit);_changed(id,participant,"creditRefund");
    }
    function challengeNoShow(bytes32 id,bytes32 reasonHash) external nonReentrant {
        EventData storage e=_event(id);Attendance storage a=_attendees[id][msg.sender];
        if(e.cancelled||a.state!=Position.REGISTERED)revert InvalidState();
        if(block.timestamp<e.terms.checkinDeadline)revert WindowNotStarted();if(block.timestamp>=e.terms.challengeDeadline)revert WindowClosed();
        if(reasonHash==0)revert InvalidTerms();a.state=Position.DISPUTED;a.reasonHash=reasonHash;a.disputeDue=uint64(block.timestamp)+e.terms.disputeDuration;
        _changed(id,msg.sender,"challengeNoShow");
    }
    function finalizeNoShow(bytes32 id,address participant) external nonReentrant {
        EventData storage e=_event(id);Attendance storage a=_attendees[id][participant];
        if(e.cancelled||a.state!=Position.REGISTERED)revert InvalidState();if(block.timestamp<e.terms.challengeDeadline)revert WindowNotStarted();
        // Quotient/remainder form avoids multiplying a full uint256 deposit by bps.
        uint256 penalty=e.terms.deposit/10000*e.terms.noShowPenaltyBps+(e.terms.deposit%10000)*e.terms.noShowPenaltyBps/10000;
        a.state=Position.SETTLED;_credit(id,e.terms.penaltyBeneficiary,penalty,keccak256("NO_SHOW"));_credit(id,participant,e.terms.deposit-penalty,keccak256("NO_SHOW_REFUND"));
        emit NoShowFinalized(id,participant,penalty,e.terms.deposit-penalty);_changed(id,participant,"finalizeNoShow");
    }
    function refundDispute(bytes32 id,address participant) external nonReentrant {
        EventData storage e=_event(id);if(msg.sender!=e.creator)revert NotAuthorized();if(_attendees[id][participant].state!=Position.DISPUTED)revert InvalidState();
        _refund(id,participant,e.terms.deposit);_changed(id,participant,"refundDispute");
    }
    function refundAfterDisputeTimeout(bytes32 id,address participant) external nonReentrant {
        EventData storage e=_event(id);Attendance storage a=_attendees[id][participant];if(a.state!=Position.DISPUTED)revert InvalidState();
        if(block.timestamp<a.disputeDue)revert WindowNotStarted();_refund(id,participant,e.terms.deposit);_changed(id,participant,"refundAfterDisputeTimeout");
    }
    function resolveByAgreement(Agreement calldata agreement,bytes calldata attendeeSignature,bytes calldata organizerSignature) external nonReentrant {
        EventData storage e=_event(agreement.boxId);Attendance storage a=_attendees[agreement.boxId][agreement.buyer];
        if(e.cancelled||a.state!=Position.DISPUTED)revert InvalidState();
        if(agreement.orderId!=orderIdFor(agreement.boxId,agreement.buyer)||agreement.termsHash!=e.termsHash||agreement.seller!=e.terms.penaltyBeneficiary||agreement.remaining!=e.terms.deposit||agreement.stageIndex!=0)revert InvalidTerms();
        a.state=Position.SETTLED;_consumeAgreement(agreement,attendeeSignature,organizerSignature,agreement.buyer,e.creator,a.disputeDue);_changed(agreement.boxId,agreement.buyer,"resolveByAgreement");
    }
    function _refund(bytes32 id,address participant,uint256 amount) private {_attendees[id][participant].state=Position.SETTLED;_credit(id,participant,amount,keccak256("REFUND"));}
    function _changed(bytes32 id,address participant,string memory action) private {Attendance storage a=_attendees[id][participant];emit AttendanceChanged(id,participant,a.state,a.disputeDue);_action(id,action,0);}
    function _event(bytes32 id) private view returns(EventData storage e){e=_events[id];if(e.creator==address(0))revert InvalidState();}
}
