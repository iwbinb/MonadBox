// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {DeliveryEscrowV1 as Delivery} from "../src/DeliveryEscrowV1.sol";
import {AgreementCredit} from "../src/lib/AgreementCredit.sol";
import {PullCredit} from "../src/lib/PullCredit.sol";
import {MockToken} from "./MockToken.sol";
interface DeliveryVm {
    function chainId(uint256) external; function warp(uint256) external; function prank(address) external;
    function expectRevert() external; function expectRevert(bytes4) external;
    function addr(uint256) external returns(address); function sign(uint256,bytes32) external returns(uint8,bytes32,bytes32);
    function etch(address,bytes calldata) external;
}
contract DeliveryEscrowV1Test {
    DeliveryVm constant vm=DeliveryVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    Delivery delivery;MockToken token;address buyer;address seller;bytes32 id;
    bytes32 constant EVIDENCE=keccak256("private file digest");
    function setUp() public {
        vm.chainId(10143);vm.warp(1000);buyer=vm.addr(1);seller=vm.addr(2);
        token=new MockToken();delivery=new Delivery(address(token),address(this));
        vm.prank(seller);id=delivery.createOffer(terms(),bytes32(0));
        token.mint(buyer,1_000_000);vm.prank(buyer);token.approve(address(delivery),type(uint256).max);
    }
    function terms() internal view returns(Delivery.Terms memory){return Delivery.Terms(buyer,seller,100_000,2000,3600,3600,86400,keccak256("terms"));}
    function eq(uint256 a,uint256 b) internal pure {require(a==b,"mismatch");}
    function state(Delivery.State s) internal view {require(delivery.getOffer(id).state==s,"state");}
    function invariantFunds() internal view {
        eq(delivery.totalDeposited(),delivery.totalLocked()+delivery.totalCredits()+delivery.totalWithdrawn());
        require(token.balanceOf(address(delivery))>=delivery.totalLocked()+delivery.totalCredits(),"insolvent");
    }
    function fund() internal {vm.prank(buyer);delivery.fund(id);}
    function submit() internal {vm.prank(seller);delivery.submitDelivery(id,EVIDENCE);}
    function disputed() internal {fund();submit();vm.prank(buyer);delivery.dispute(id,keccak256("reason"));}
    function agreement() internal view returns(AgreementCredit.Agreement memory a){
        a.schemaVersion=1;a.boxId=id;a.orderId=id;a.termsHash=delivery.getOffer(id).termsHash;a.asset=address(token);
        a.remaining=100_000;a.buyer=buyer;a.seller=seller;a.buyerAmount=30000;a.sellerAmount=70000;
        a.deadline=delivery.getOffer(id).disputeDue;
    }
    function signature(uint256 key,bytes32 digest) internal returns(bytes memory){(uint8 v,bytes32 r,bytes32 s)=vm.sign(key,digest);return abi.encodePacked(r,s,v);}
    function resolve(AgreementCredit.Agreement memory a) internal {
        bytes32 h=delivery.agreementDigest(a);bytes memory first=signature(1,h);bytes memory second=signature(2,h);
        delivery.resolveByAgreement(a,first,second);
    }
    function resolveReverts(AgreementCredit.Agreement memory a,bytes4 expected) internal {
        bytes32 h=delivery.agreementDigest(a);bytes memory first=signature(1,h);bytes memory second=signature(2,h);
        vm.expectRevert(expected);delivery.resolveByAgreement(a,first,second);
    }
    function testBuyerOnlyFullFundAndNoRepeatedFunding() public {
        vm.expectRevert(PullCredit.NotAuthorized.selector);delivery.fund(id);fund();state(Delivery.State.FUNDED);eq(delivery.locked(id),100000);eq(delivery.getOffer(id).submitDue,4600);
        vm.expectRevert(PullCredit.InvalidState.selector);fund();invariantFunds();
    }
    function testInvalidPartiesAmountsAndDurations() public {
        Delivery.Terms memory t=terms();t.buyer=seller;vm.expectRevert(PullCredit.InvalidTerms.selector);delivery.createOffer(t,bytes32(uint256(1)));
        t=terms();t.seller=address(delivery);vm.expectRevert(PullCredit.InvalidTerms.selector);delivery.createOffer(t,bytes32(uint256(1)));
        t=terms();t.workDuration=3599;vm.expectRevert(PullCredit.InvalidTerms.selector);delivery.createOffer(t,bytes32(uint256(1)));
        t=terms();t.reviewDuration=7 days+1;vm.expectRevert(PullCredit.InvalidTerms.selector);delivery.createOffer(t,bytes32(uint256(1)));
        t=terms();t.disputeDuration=86399;vm.expectRevert(PullCredit.InvalidTerms.selector);delivery.createOffer(t,bytes32(uint256(1)));
        t=terms();t.amount=0;vm.expectRevert(PullCredit.InvalidTerms.selector);delivery.createOffer(t,bytes32(uint256(1)));
    }
    function testCreateRoleAndSameSaltCannotOverwrite() public {
        Delivery.Terms memory t=terms();vm.expectRevert(PullCredit.NotAuthorized.selector);delivery.createOffer(t,bytes32(uint256(1)));
        vm.expectRevert(PullCredit.AlreadyProcessed.selector);vm.prank(seller);delivery.createOffer(t,bytes32(0));
    }
    function testFundingDeadlineHasNoOverlapAndAnyoneCanExpire() public {
        vm.warp(2000);vm.expectRevert(PullCredit.WindowClosed.selector);fund();delivery.cancelOffer(id);state(Delivery.State.EXPIRED);invariantFunds();
    }
    function testCancellationBeforeFundingIsPartyOnlyAndFinal() public {
        vm.expectRevert(PullCredit.NotAuthorized.selector);delivery.cancelOffer(id);vm.prank(buyer);delivery.cancelOffer(id);state(Delivery.State.CANCELLED);
        vm.expectRevert(PullCredit.InvalidState.selector);fund();
    }
    function testNormalDeliveryAcceptanceCreditsOriginalSellerOnly() public {
        fund();vm.expectRevert(PullCredit.NotAuthorized.selector);delivery.submitDelivery(id,EVIDENCE);submit();
        vm.expectRevert(PullCredit.NotAuthorized.selector);delivery.accept(id);vm.prank(buyer);delivery.accept(id);state(Delivery.State.RELEASED);
        eq(delivery.creditOf(seller),100000);eq(delivery.creditOf(buyer),0);eq(token.balanceOf(seller),0);
        delivery.withdrawFor(id,seller);eq(token.balanceOf(seller),100000);vm.expectRevert(PullCredit.InvalidState.selector);delivery.settleAfterReview(id);invariantFunds();
    }
    function testMissingDeliveryBeforeAndAtBoundary() public {
        fund();vm.warp(4599);vm.expectRevert(PullCredit.WindowNotStarted.selector);delivery.refundAfterMissingDelivery(id);
        vm.warp(4600);vm.expectRevert(PullCredit.WindowClosed.selector);submit();delivery.refundAfterMissingDelivery(id);eq(delivery.creditOf(buyer),100000);state(Delivery.State.REFUNDED);invariantFunds();
    }
    function testRepeatedSubmissionCannotResetReviewClock() public {
        fund();submit();uint64 due=delivery.getOffer(id).reviewDue;vm.warp(2000);vm.expectRevert(PullCredit.InvalidState.selector);submit();eq(delivery.getOffer(id).reviewDue,due);
    }
    function testSilenceSettlementAndDisputeAreMutuallyExclusiveAtBoundary() public {
        fund();submit();vm.warp(4599);vm.expectRevert(PullCredit.WindowNotStarted.selector);delivery.settleAfterReview(id);
        vm.warp(4600);vm.expectRevert(PullCredit.WindowClosed.selector);vm.prank(buyer);delivery.dispute(id,EVIDENCE);
        delivery.settleAfterReview(id);state(Delivery.State.RELEASED);eq(delivery.creditOf(seller),100000);invariantFunds();
    }
    function testDisputeStopsReleaseAndRefundsAtExactTimeout() public {
        disputed();vm.warp(4600);vm.expectRevert(PullCredit.InvalidState.selector);delivery.settleAfterReview(id);vm.expectRevert(PullCredit.InvalidState.selector);vm.prank(buyer);delivery.accept(id);
        uint64 due=delivery.getOffer(id).disputeDue;vm.warp(due-1);vm.expectRevert(PullCredit.WindowNotStarted.selector);delivery.refundAfterDisputeTimeout(id);
        vm.warp(due);delivery.refundAfterDisputeTimeout(id);eq(delivery.creditOf(buyer),100000);vm.expectRevert(PullCredit.InvalidState.selector);delivery.refundAfterDisputeTimeout(id);invariantFunds();
    }
    function testSellerRefundWorksWhileIntakePaused() public {
        disputed();delivery.setIntakePaused(true);vm.expectRevert(PullCredit.NotAuthorized.selector);delivery.refundBySeller(id);
        vm.prank(seller);delivery.refundBySeller(id);delivery.withdrawFor(id,buyer);eq(token.balanceOf(buyer),1000000);invariantFunds();
    }
    function testPausedIntakeStillAllowsMissingDeliveryExit() public {
        fund();delivery.setIntakePaused(true);vm.warp(4600);delivery.refundAfterMissingDelivery(id);delivery.withdrawFor(id,buyer);invariantFunds();
    }
    function testWrongEvidenceAndReasonHashReject() public {
        fund();vm.expectRevert(PullCredit.InvalidTerms.selector);vm.prank(seller);delivery.submitDelivery(id,0);submit();
        vm.expectRevert(PullCredit.InvalidTerms.selector);vm.prank(buyer);delivery.dispute(id,0);
    }
    function testAgreementAllocatesWholeRemainderOnceWithoutThirdParty() public {
        disputed();AgreementCredit.Agreement memory a=agreement();resolve(a);state(Delivery.State.RESOLVED);
        eq(delivery.creditOf(buyer),30000);eq(delivery.creditOf(seller),70000);eq(delivery.settlementNonce(id),1);
        resolveReverts(a,PullCredit.InvalidState.selector);invariantFunds();
    }
    function testAgreementTamperingFailsDespiteOtherwiseValidSignatures() public {
        disputed();AgreementCredit.Agreement memory a=agreement();bytes32 h=delivery.agreementDigest(a);bytes memory first=signature(1,h);bytes memory second=signature(2,h);
        a.buyerAmount=1;a.sellerAmount=99999;vm.expectRevert(PullCredit.InvalidSignature.selector);delivery.resolveByAgreement(a,first,second);state(Delivery.State.DISPUTED);
        a=agreement();a.buyer=address(55);resolveReverts(a,PullCredit.InvalidTerms.selector);
        a=agreement();a.termsHash=bytes32(uint256(2));resolveReverts(a,PullCredit.InvalidTerms.selector);
        a=agreement();a.orderId=bytes32(uint256(3));resolveReverts(a,PullCredit.InvalidTerms.selector);
        a=agreement();a.remaining++;resolveReverts(a,PullCredit.InvalidTerms.selector);
        a=agreement();a.stageIndex=1;resolveReverts(a,PullCredit.InvalidTerms.selector);
        a=agreement();a.asset=buyer;resolveReverts(a,PullCredit.InvalidTerms.selector);invariantFunds();
    }
    function testAgreementNonceAmountAndDeadlineChecks() public {
        disputed();AgreementCredit.Agreement memory a=agreement();a.settlementNonce=1;resolveReverts(a,PullCredit.InvalidTerms.selector);
        a=agreement();a.sellerAmount++;resolveReverts(a,PullCredit.InvalidTerms.selector);
        a=agreement();a.deadline++;resolveReverts(a,PullCredit.WindowClosed.selector);
        a=agreement();vm.warp(a.deadline);resolveReverts(a,PullCredit.WindowClosed.selector);delivery.refundAfterDisputeTimeout(id);invariantFunds();
    }
    function testWrongSignerChainAndContractDomainReject() public {
        disputed();AgreementCredit.Agreement memory a=agreement();bytes32 digest=delivery.agreementDigest(a);bytes memory first=signature(1,digest);bytes memory second=signature(2,digest);
        vm.expectRevert(PullCredit.InvalidSignature.selector);delivery.resolveByAgreement(a,second,first);
        vm.chainId(143);vm.expectRevert(PullCredit.InvalidSignature.selector);delivery.resolveByAgreement(a,first,second);vm.chainId(10143);
        Delivery other=new Delivery(address(token),address(this));bytes32 wrongDomain=other.agreementDigest(a);first=signature(1,wrongDomain);second=signature(2,wrongDomain);
        vm.expectRevert(PullCredit.InvalidSignature.selector);delivery.resolveByAgreement(a,first,second);invariantFunds();
    }
    function testUnsupportedContractSignerAndMalformedSignaturesReject() public {
        disputed();AgreementCredit.Agreement memory a=agreement();vm.expectRevert();delivery.resolveByAgreement(a,hex"01",hex"02");
        vm.etch(buyer,hex"6000");resolveReverts(a,PullCredit.InvalidSignature.selector);invariantFunds();
    }
    function testTaxedDepositAndFailedWithdrawPreserveAccounting() public {
        token.setFee(true);vm.expectRevert(PullCredit.TransferAmountMismatch.selector);fund();state(Delivery.State.AWAITING_FUNDS);eq(delivery.locked(id),0);
        token.setFee(false);fund();submit();vm.prank(buyer);delivery.accept(id);token.setFail(true);vm.expectRevert();delivery.withdrawFor(id,seller);
        eq(delivery.creditOf(seller),100000);eq(delivery.withdrawnForBox(id,seller),0);token.setFail(false);delivery.withdrawFor(id,seller);invariantFunds();
    }
    function testFuzzAgreementConservesAllFunds(uint96 allocation) public {
        disputed();AgreementCredit.Agreement memory a=agreement();a.buyerAmount=uint256(allocation)%100001;a.sellerAmount=100000-a.buyerAmount;
        resolve(a);eq(delivery.creditOf(buyer)+delivery.creditOf(seller),100000);invariantFunds();
    }
}
