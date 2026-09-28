// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {AttendanceBondV1 as Attend} from "../src/AttendanceBondV1.sol";
import {AgreementCredit} from "../src/lib/AgreementCredit.sol";
import {PullCredit} from "../src/lib/PullCredit.sol";
import {MockToken} from "./MockToken.sol";
interface AttendVm {function chainId(uint256) external;function warp(uint256) external;function prank(address) external;function expectRevert() external;function expectRevert(bytes4) external;function addr(uint256) external returns(address);function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);function etch(address,bytes calldata) external;}
contract AttendanceBondV1Test {
    AttendVm constant vm=AttendVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Attend attend;MockToken token;address organizer;address signer;address alice;address bob;address penalty;bytes32 id;
    function setUp() public {
        vm.chainId(10143);vm.warp(1000);organizer=vm.addr(10);signer=vm.addr(11);alice=vm.addr(1);bob=vm.addr(2);penalty=vm.addr(12);
        token=new MockToken();attend=new Attend(address(token),address(this));Attend.Terms memory t=terms();vm.prank(organizer);id=attend.createEvent(t,0);
        for(uint256 i=1;i<=3;i++){address user=vm.addr(i);token.mint(user,10000);vm.prank(user);token.approve(address(attend),type(uint256).max);}
    }
    function terms() internal view returns(Attend.Terms memory){return Attend.Terms(101,2,2000,4000,5000,3000,6000,8000,86400,3333,penalty,signer,keccak256("terms"));}
    function eq(uint256 a,uint256 b) internal pure {require(a==b,"mismatch");}
    function state(address user,Attend.Position expected) internal view {require(attend.getAttendance(id,user).state==expected,"state");}
    function invariantFunds() internal view {eq(attend.totalDeposited(),attend.totalLocked()+attend.totalCredits()+attend.totalWithdrawn());require(token.balanceOf(address(attend))>=attend.totalLocked()+attend.totalCredits(),"insolvent");}
    function reg(address user) internal {vm.prank(user);attend.register(id);}
    function signature(uint256 key,bytes32 digest) internal returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(key,digest);return abi.encodePacked(r,s,v);}
    function proof(address user) internal view returns(Attend.CheckIn memory){return Attend.CheckIn(1,id,attend.getEvent(id).termsHash,user,signer,3000,6000,0);}
    function checkin(address user) internal {Attend.CheckIn memory p=proof(user);bytes memory sig=signature(11,attend.checkInDigest(p));attend.checkIn(p,sig);}
    function challenge(address user) internal {vm.prank(user);attend.challengeNoShow(id,keccak256("evidence"));}
    function disputed() internal {reg(alice);reg(bob);vm.warp(6000);challenge(alice);}
    function agreement(address user) internal view returns(AgreementCredit.Agreement memory a){a.schemaVersion=1;a.boxId=id;a.orderId=attend.orderIdFor(id,user);a.termsHash=attend.getEvent(id).termsHash;a.asset=address(token);a.remaining=101;a.buyer=user;a.seller=penalty;a.buyerAmount=80;a.sellerAmount=21;a.deadline=attend.getAttendance(id,user).disputeDue;}
    function resolve(AgreementCredit.Agreement memory a) internal {bytes32 digest=attend.agreementDigest(a);bytes memory first=signature(1,digest);bytes memory second=signature(10,digest);attend.resolveByAgreement(a,first,second);}
    function testRegisterCapacityLeaveAndNeverRejoin() public {reg(alice);reg(bob);address third=vm.addr(3);vm.expectRevert(PullCredit.InvalidState.selector);reg(third);vm.prank(alice);attend.leave(id);state(alice,Attend.Position.LEFT);eq(attend.creditOf(alice),101);eq(attend.getEvent(id).activeCount,1);vm.expectRevert(PullCredit.AlreadyProcessed.selector);reg(alice);reg(third);eq(attend.getEvent(id).activeCount,2);invariantFunds();}
    function testRegistrationAndExitDeadlineExact() public {reg(alice);vm.warp(2000);vm.expectRevert(PullCredit.WindowClosed.selector);reg(bob);vm.expectRevert(PullCredit.WindowClosed.selector);vm.prank(alice);attend.leave(id);invariantFunds();}
    function testInvalidTimesPeopleAndDeposit() public {
        Attend.Terms memory t=terms();t.registrationDeadline=4001;vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
        t=terms();t.checkinStart=4001;vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
        t=terms();t.checkinDeadline=4999;vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
        t=terms();t.challengeDeadline=6000;vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
        t=terms();t.deposit=type(uint256).max;vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
        t=terms();t.capacity=201;vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
        t=terms();t.checkinSigner=address(attend);vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
        t=terms();t.noShowPenaltyBps=10001;vm.expectRevert(PullCredit.InvalidTerms.selector);attend.createEvent(t,0);
    }
    function testCheckinRefundsOnlyAttendeeAndPreventsLaterPenalty() public {reg(alice);vm.warp(3000);checkin(alice);state(alice,Attend.Position.CHECKED_IN);eq(attend.creditOf(alice),101);eq(attend.locked(id),0);eq(attend.getEvent(id).activeCount,1);Attend.CheckIn memory p=proof(alice);bytes memory sig=signature(11,attend.checkInDigest(p));vm.expectRevert(PullCredit.InvalidState.selector);attend.checkIn(p,sig);vm.warp(8000);vm.expectRevert(PullCredit.InvalidState.selector);attend.finalizeNoShow(id,alice);attend.withdrawFor(id,alice);eq(attend.withdrawnForBox(id,alice),101);invariantFunds();}
    function testCheckinWindowAndProofExpiryExact() public {
        reg(alice);Attend.CheckIn memory p=proof(alice);bytes memory sig=signature(11,attend.checkInDigest(p));
        vm.warp(2999);vm.expectRevert(PullCredit.WindowNotStarted.selector);attend.checkIn(p,sig);
        vm.warp(6000);vm.expectRevert(PullCredit.WindowClosed.selector);attend.checkIn(p,sig);
    }
    function testCheckinWrongSignerAndChangedParticipantRejected() public {
        reg(alice);reg(bob);vm.warp(3000);Attend.CheckIn memory p=proof(alice);bytes memory sig=signature(10,attend.checkInDigest(p));vm.expectRevert(PullCredit.InvalidSignature.selector);attend.checkIn(p,sig);
        sig=signature(11,attend.checkInDigest(p));p.attendee=bob;vm.expectRevert(PullCredit.InvalidSignature.selector);attend.checkIn(p,sig);
        p=proof(alice);p.nonce=1;sig=signature(11,attend.checkInDigest(p));vm.expectRevert(PullCredit.InvalidTerms.selector);attend.checkIn(p,sig);
    }
    function testProofWrongTermsFutureIssueAndOverlongDeadlineRejected() public {
        reg(alice);vm.warp(3000);Attend.CheckIn memory p=proof(alice);p.termsHash=bytes32(uint256(1));badProof(p);
        p=proof(alice);p.issuedAt=3001;badProof(p);p=proof(alice);p.deadline=6001;badProof(p);p=proof(alice);p.issuedAt=2999;badProof(p);
    }
    function badProof(Attend.CheckIn memory p) internal {bytes memory sig=signature(11,attend.checkInDigest(p));vm.expectRevert(PullCredit.InvalidTerms.selector);attend.checkIn(p,sig);}
    function testCheckinWrongChainAndContractRejected() public {
        reg(alice);vm.warp(3000);Attend.CheckIn memory p=proof(alice);bytes memory sig=signature(11,attend.checkInDigest(p));vm.chainId(1);vm.expectRevert(PullCredit.InvalidSignature.selector);attend.checkIn(p,sig);vm.chainId(10143);
        Attend other=new Attend(address(token),address(this));sig=signature(11,other.checkInDigest(p));vm.expectRevert(PullCredit.InvalidSignature.selector);attend.checkIn(p,sig);
    }
    function testCancellationDoesNotRefundPreviouslyCheckedInTwice() public {reg(alice);reg(bob);vm.warp(3000);checkin(alice);vm.prank(organizer);attend.cancelEvent(id);vm.expectRevert(PullCredit.InvalidState.selector);attend.creditRefund(id,alice);attend.creditRefund(id,bob);eq(attend.creditOf(alice),101);eq(attend.creditOf(bob),101);vm.expectRevert(PullCredit.InvalidState.selector);attend.creditRefund(id,bob);invariantFunds();}
    function testCancelPermissionsAndChallengeBoundary() public {vm.expectRevert(PullCredit.NotAuthorized.selector);attend.cancelEvent(id);vm.warp(8000);vm.expectRevert(PullCredit.WindowClosed.selector);vm.prank(organizer);attend.cancelEvent(id);}
    function testChallengeWindowOnlyParticipantAndNoEarlyNoShow() public {reg(alice);vm.warp(5999);vm.expectRevert(PullCredit.WindowNotStarted.selector);challenge(alice);vm.warp(6000);vm.expectRevert(PullCredit.InvalidState.selector);attend.challengeNoShow(id,keccak256("reason"));vm.expectRevert(PullCredit.WindowNotStarted.selector);attend.finalizeNoShow(id,alice);vm.warp(8000);vm.expectRevert(PullCredit.WindowClosed.selector);challenge(alice);attend.finalizeNoShow(id,alice);eq(attend.creditOf(penalty),33);eq(attend.creditOf(alice),68);invariantFunds();}
    function testIndividualDisputeDoesNotBlockOthersAndTimesOutInFull() public {disputed();vm.warp(8000);attend.finalizeNoShow(id,bob);eq(attend.creditOf(bob),68);eq(attend.locked(id),101);vm.expectRevert(PullCredit.InvalidState.selector);attend.finalizeNoShow(id,alice);vm.warp(92399);vm.expectRevert(PullCredit.WindowNotStarted.selector);attend.refundAfterDisputeTimeout(id,alice);vm.warp(92400);attend.refundAfterDisputeTimeout(id,alice);eq(attend.creditOf(alice),101);eq(attend.locked(id),0);invariantFunds();}
    function testOrganizerRefundIsParticipantSpecific() public {disputed();vm.expectRevert(PullCredit.NotAuthorized.selector);attend.refundDispute(id,alice);vm.prank(organizer);attend.refundDispute(id,alice);eq(attend.creditOf(alice),101);eq(attend.locked(id),101);state(bob,Attend.Position.REGISTERED);invariantFunds();}
    function testAgreementUsesOrganizerSignatureAndFixedPenaltyRecipient() public {disputed();resolve(agreement(alice));eq(attend.creditOf(alice),80);eq(attend.creditOf(penalty),21);eq(attend.creditOf(organizer),0);eq(attend.locked(id),101);AgreementCredit.Agreement memory a=agreement(alice);bytes32 digest=attend.agreementDigest(a);bytes memory first=signature(1,digest);bytes memory second=signature(10,digest);vm.expectRevert(PullCredit.InvalidState.selector);attend.resolveByAgreement(a,first,second);invariantFunds();}
    function testAgreementCannotSwapParticipantOrRecipientOrRemaining() public {
        disputed();AgreementCredit.Agreement memory a=agreement(alice);a.seller=organizer;badAgreement(a);a=agreement(alice);a.orderId=id;badAgreement(a);a=agreement(alice);a.remaining=102;a.buyerAmount=81;badAgreement(a);a=agreement(alice);a.stageIndex=1;badAgreement(a);
    }
    function badAgreement(AgreementCredit.Agreement memory a) internal {bytes32 digest=attend.agreementDigest(a);bytes memory first=signature(1,digest);bytes memory second=signature(10,digest);vm.expectRevert(PullCredit.InvalidTerms.selector);attend.resolveByAgreement(a,first,second);}
    function testCancellationRefundsDisputeAndInvalidatesPreviouslySignedAgreement() public {disputed();AgreementCredit.Agreement memory a=agreement(alice);bytes32 digest=attend.agreementDigest(a);bytes memory first=signature(1,digest);bytes memory second=signature(10,digest);vm.prank(organizer);attend.cancelEvent(id);vm.expectRevert(PullCredit.InvalidState.selector);attend.resolveByAgreement(a,first,second);attend.creditRefund(id,alice);attend.creditRefund(id,bob);eq(attend.totalCredits(),202);invariantFunds();}
    function testPausedIntakeKeepsCheckinChallengeCancelAndRefundOpen() public {reg(alice);reg(bob);attend.setIntakePaused(true);vm.expectRevert(PullCredit.IntakePaused.selector);attend.register(id);vm.warp(3000);checkin(alice);vm.warp(6000);challenge(bob);vm.prank(organizer);attend.refundDispute(id,bob);attend.withdrawFor(id,alice);attend.withdrawFor(id,bob);invariantFunds();}
    function testMaxNoShowAmount() public {testFuzzNoShowConservesFullUint256(type(uint256).max,10000);}
    function testFuzzNoShowConservesFullUint256(uint256 amount,uint16 bps) public {if(amount==0)return;token=new MockToken();attend=new Attend(address(token),address(this));bps=uint16(uint256(bps)%10001);Attend.Terms memory t=terms();t.deposit=amount;t.capacity=1;t.noShowPenaltyBps=bps;vm.prank(organizer);bytes32 other=attend.createEvent(t,bytes32(uint256(1)));address user=vm.addr(33);token.mint(user,amount);vm.prank(user);token.approve(address(attend),amount);vm.prank(user);attend.register(other);vm.warp(8000);attend.finalizeNoShow(other,user);eq(attend.creditForBox(other,user)+attend.creditForBox(other,penalty),amount);eq(attend.locked(other),0);invariantFunds();}
}
