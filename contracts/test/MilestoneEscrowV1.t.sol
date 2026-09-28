// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {MilestoneEscrowV1 as Milestone} from "../src/MilestoneEscrowV1.sol";
import {AgreementCredit} from "../src/lib/AgreementCredit.sol";
import {PullCredit} from "../src/lib/PullCredit.sol";
import {MockToken} from "./MockToken.sol";
interface MilestoneVm {
    function chainId(uint256) external; function warp(uint256) external; function prank(address) external;
    function expectRevert() external; function expectRevert(bytes4) external;
    function addr(uint256) external returns(address); function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);
}
contract MilestoneEscrowV1Test {
    MilestoneVm constant vm=MilestoneVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Milestone milestone;MockToken token;address buyer;address seller;bytes32 id;
    bytes32 constant EVIDENCE=keccak256("proof");
    function setUp() public {
        vm.chainId(10143);vm.warp(1000);buyer=vm.addr(1);seller=vm.addr(2);
        token=new MockToken();milestone=new Milestone(address(token),address(this));
        vm.prank(seller);id=milestone.createOffer(terms(),bytes32(0));
        token.mint(buyer,1000000);vm.prank(buyer);token.approve(address(milestone),type(uint256).max);
    }
    function terms() internal view returns(Milestone.Terms memory t){
        t.buyer=buyer;t.seller=seller;t.fundBy=2000;t.disputeDuration=86400;t.metadataHash=EVIDENCE;
        t.stages=new Milestone.Stage[](3);
        t.stages[0]=Milestone.Stage(30000,3600,3600);t.stages[1]=Milestone.Stage(40000,7200,3600);t.stages[2]=Milestone.Stage(30000,10800,3600);
    }
    function eq(uint256 a,uint256 b) internal pure {require(a==b,"mismatch");}
    function state(Milestone.State s) internal view {require(milestone.getOffer(id).state==s,"state");}
    function invariantFunds() internal view {
        eq(milestone.totalDeposited(),milestone.totalLocked()+milestone.totalCredits()+milestone.totalWithdrawn());
        require(token.balanceOf(address(milestone))>=milestone.totalLocked()+milestone.totalCredits(),"insolvent");
    }
    function fund() internal {vm.prank(buyer);milestone.fund(id);}
    function submit(uint256 index) internal {vm.prank(seller);milestone.submitDelivery(id,index,EVIDENCE);}
    function accept(uint256 index) internal {vm.prank(buyer);milestone.accept(id,index);}
    function disputedSecond() internal {fund();submit(0);accept(0);submit(1);vm.prank(buyer);milestone.dispute(id,1,EVIDENCE);}
    function signature(uint256 key,bytes32 digest) internal returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(key,digest);return abi.encodePacked(r,s,v);}
    function agreement() internal view returns(AgreementCredit.Agreement memory a){
        a.schemaVersion=1;a.boxId=id;a.orderId=id;a.termsHash=milestone.getOffer(id).termsHash;a.asset=address(token);
        a.remaining=70000;a.buyer=buyer;a.seller=seller;a.buyerAmount=30000;a.sellerAmount=40000;
        a.deadline=milestone.getOffer(id).disputeDue;a.stageIndex=1;
    }
    function resolve(AgreementCredit.Agreement memory a,bool fails) internal {
        bytes32 h=milestone.agreementDigest(a);bytes memory first=signature(1,h);bytes memory second=signature(2,h);
        if(fails)vm.expectRevert();milestone.resolveByAgreement(a,first,second);
    }
    function testFullFundingAndSequentialCompletion() public {
        fund();eq(milestone.locked(id),100000);eq(milestone.getOffer(id).submitDue,4600);
        for(uint256 n;n<3;++n){submit(n);accept(n);invariantFunds();}
        state(Milestone.State.COMPLETED);eq(milestone.locked(id),0);eq(milestone.creditOf(seller),100000);eq(milestone.getOffer(id).released,100000);
        milestone.withdrawFor(id,seller);eq(token.balanceOf(seller),100000);invariantFunds();
    }
    function testNextClockStartsAtActualReleaseAndProofIsReset() public {
        fund();submit(0);vm.warp(4200);accept(0);
        Milestone.Offer memory o=milestone.getOffer(id);eq(o.currentStage,1);eq(o.submitDue,11400);eq(o.reviewDue,0);require(o.evidenceHash==0,"old proof");eq(o.released,30000);eq(milestone.locked(id),70000);
    }
    function testFutureAndStaleStageActionsFail() public {
        fund();vm.expectRevert(PullCredit.InvalidState.selector);submit(1);vm.expectRevert(PullCredit.InvalidState.selector);accept(1);
        submit(0);accept(0);vm.expectRevert(PullCredit.InvalidState.selector);accept(0);vm.expectRevert(PullCredit.InvalidState.selector);submit(0);
        vm.expectRevert(PullCredit.InvalidState.selector);milestone.refundAfterMissingDelivery(id,0);invariantFunds();
    }
    function testStageCountAmountSumAndDurationsValidated() public {
        Milestone.Terms memory t=terms();t.stages=new Milestone.Stage[](1);vm.expectRevert();vm.prank(buyer);milestone.createOffer(t,EVIDENCE);
        t=terms();t.stages=new Milestone.Stage[](11);vm.expectRevert();vm.prank(buyer);milestone.createOffer(t,EVIDENCE);
        t=terms();t.stages[1].amount=0;vm.expectRevert();vm.prank(buyer);milestone.createOffer(t,EVIDENCE);
        t=terms();t.stages[1].amount=type(uint256).max;vm.expectRevert();vm.prank(buyer);milestone.createOffer(t,EVIDENCE);
        t=terms();t.stages[1].workDuration=3599;vm.expectRevert();vm.prank(buyer);milestone.createOffer(t,EVIDENCE);
        t=terms();t.stages[1].reviewDuration=7 days+1;vm.expectRevert();vm.prank(buyer);milestone.createOffer(t,EVIDENCE);
        t=terms();t.disputeDuration=86399;vm.expectRevert();vm.prank(buyer);milestone.createOffer(t,EVIDENCE);
    }
    function testCreatePartyAndSaltAreFixed() public {
        Milestone.Terms memory t=terms();vm.expectRevert(PullCredit.NotAuthorized.selector);milestone.createOffer(t,EVIDENCE);
        vm.expectRevert(PullCredit.AlreadyProcessed.selector);vm.prank(seller);milestone.createOffer(t,0);
        t.buyer=seller;vm.expectRevert();vm.prank(seller);milestone.createOffer(t,EVIDENCE);
    }
    function testUnfundedCancelAndExpiry() public {
        vm.expectRevert(PullCredit.NotAuthorized.selector);milestone.cancelOffer(id);
        vm.warp(2000);vm.expectRevert(PullCredit.WindowClosed.selector);fund();milestone.cancelOffer(id);state(Milestone.State.EXPIRED);
        vm.expectRevert(PullCredit.InvalidState.selector);fund();invariantFunds();
    }
    function testOnlyBuyerFundsAndOnlySellerSubmits() public {
        vm.expectRevert(PullCredit.NotAuthorized.selector);milestone.fund(id);fund();
        vm.expectRevert(PullCredit.InvalidState.selector);fund();vm.expectRevert(PullCredit.NotAuthorized.selector);milestone.submitDelivery(id,0,EVIDENCE);
        submit(0);vm.expectRevert(PullCredit.NotAuthorized.selector);milestone.accept(id,0);
    }
    function testSubmissionDeadlineAndFullMissingRefund() public {
        fund();vm.warp(4600);vm.expectRevert(PullCredit.WindowClosed.selector);submit(0);milestone.refundAfterMissingDelivery(id,0);
        state(Milestone.State.TERMINATED);eq(milestone.creditOf(buyer),100000);invariantFunds();
    }
    function testRepeatedSubmissionCannotResetReview() public {
        fund();submit(0);vm.warp(2000);vm.expectRevert(PullCredit.InvalidState.selector);submit(0);eq(milestone.getOffer(id).reviewDue,4600);
    }
    function testSilenceBoundaryReleasesCurrentOnly() public {
        fund();submit(0);vm.warp(4599);vm.expectRevert(PullCredit.WindowNotStarted.selector);milestone.settleAfterReview(id,0);
        vm.warp(4600);vm.expectRevert(PullCredit.WindowClosed.selector);vm.prank(buyer);milestone.dispute(id,0,EVIDENCE);
        milestone.settleAfterReview(id,0);state(Milestone.State.FUNDED);eq(milestone.creditOf(seller),30000);eq(milestone.locked(id),70000);eq(milestone.getOffer(id).submitDue,11800);invariantFunds();
    }
    function testMissingLaterStageRefundsRemainderAndPreservesReleasedCredit() public {
        fund();submit(0);accept(0);vm.warp(8200);milestone.refundAfterMissingDelivery(id,1);
        state(Milestone.State.TERMINATED);eq(milestone.creditOf(buyer),70000);eq(milestone.creditOf(seller),30000);eq(milestone.getOffer(id).released,30000);invariantFunds();
    }
    function testSellerTerminationNeverClawsBackWithdrawnStage() public {
        fund();submit(0);accept(0);milestone.withdrawFor(id,seller);vm.prank(seller);milestone.refundBySeller(id,1);
        eq(token.balanceOf(seller),30000);eq(milestone.creditOf(buyer),70000);invariantFunds();
    }
    function testDisputeStopsFurtherStagesAndRefundsAllRemainingAtBoundary() public {
        disputedSecond();vm.expectRevert(PullCredit.InvalidState.selector);accept(1);vm.expectRevert(PullCredit.InvalidState.selector);submit(2);
        uint256 due=milestone.getOffer(id).disputeDue;vm.warp(due-1);vm.expectRevert(PullCredit.WindowNotStarted.selector);milestone.refundAfterDisputeTimeout(id,1);
        vm.warp(due);milestone.refundAfterDisputeTimeout(id,1);eq(milestone.creditOf(buyer),70000);eq(milestone.creditOf(seller),30000);state(Milestone.State.TERMINATED);invariantFunds();
    }
    function testAgreementConsumesEntireRemainderAndDoesNotResume() public {
        disputedSecond();AgreementCredit.Agreement memory a=agreement();resolve(a,false);
        state(Milestone.State.RESOLVED);eq(milestone.creditOf(buyer),30000);eq(milestone.creditOf(seller),70000);eq(milestone.locked(id),0);eq(milestone.settlementNonce(id),1);
        resolve(a,true);vm.expectRevert(PullCredit.InvalidState.selector);submit(1);invariantFunds();
    }
    function testAgreementCannotSettleOnlyCurrentStageOrChangeIdentity() public {
        disputedSecond();AgreementCredit.Agreement memory a=agreement();a.remaining=40000;a.buyerAmount=0;resolve(a,true);
        a=agreement();a.stageIndex=0;resolve(a,true);a=agreement();a.buyer=seller;resolve(a,true);
        a=agreement();a.termsHash=0;resolve(a,true);a=agreement();a.orderId=0;resolve(a,true);
        a=agreement();a.settlementNonce=1;resolve(a,true);a=agreement();a.deadline++;resolve(a,true);invariantFunds();
    }
    function testWrongDomainSignatureAndTamperingReject() public {
        disputedSecond();AgreementCredit.Agreement memory a=agreement();bytes32 h=milestone.agreementDigest(a);bytes memory first=signature(1,h);bytes memory second=signature(2,h);
        vm.chainId(143);vm.expectRevert();milestone.resolveByAgreement(a,first,second);vm.chainId(10143);
        a.buyerAmount=1;a.sellerAmount=69999;vm.expectRevert();milestone.resolveByAgreement(a,first,second);invariantFunds();
    }
    function testPauseDoesNotBlockDeliveryReleaseOrTermination() public {
        fund();milestone.setIntakePaused(true);submit(0);accept(0);vm.prank(seller);milestone.refundBySeller(id,1);milestone.withdrawFor(id,buyer);milestone.withdrawFor(id,seller);invariantFunds();
    }
    function testTaxedDepositAndFailedWithdrawalRollBack() public {
        token.setFee(true);vm.expectRevert();fund();state(Milestone.State.AWAITING_FUNDS);eq(milestone.locked(id),0);
        token.setFee(false);fund();submit(0);accept(0);token.setFail(true);vm.expectRevert();milestone.withdrawFor(id,seller);eq(milestone.creditOf(seller),30000);invariantFunds();
    }
    function testFuzzStagesConserveEveryAmount(uint96 seed,uint8 countSeed,uint8 stopSeed) public {
        uint256 count=2+uint256(countSeed)%9;uint256 stop=uint256(stopSeed)%(count+1);
        Milestone.Terms memory t=terms();t.stages=new Milestone.Stage[](count);uint256 total;
        for(uint256 n;n<count;++n){uint256 amount=uint256(seed)+n+1;t.stages[n]=Milestone.Stage(amount,3600,3600);total+=amount;}
        vm.prank(buyer);id=milestone.createOffer(t,EVIDENCE);token.mint(buyer,total);fund();uint256 released;
        for(uint256 n;n<stop;++n){submit(n);accept(n);released+=t.stages[n].amount;}
        if(stop<count){vm.prank(seller);milestone.refundBySeller(id,stop);}
        eq(milestone.creditForBox(id,seller),released);eq(milestone.creditForBox(id,buyer),total-released);eq(milestone.locked(id),0);invariantFunds();
    }
}
