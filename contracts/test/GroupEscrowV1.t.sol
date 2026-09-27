// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {GroupEscrowV1 as Group} from "../src/GroupEscrowV1.sol";
import {MockToken} from "./MockToken.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface GroupVm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}
contract CallbackToken is ERC20 {
    address public target;
    bytes public payload;
    bool public callbackSucceeded;
    constructor() ERC20("Local callback token", "TEST") {}
    function mint(address a, uint256 n) external { _mint(a,n); }
    function configure(address t, bytes calldata p) external {target=t;payload=p;}
    function transferFrom(address a,address b,uint256 n) public override returns(bool) {
        (callbackSucceeded,)=target.call(payload);
        return super.transferFrom(a,b,n);
    }
    function transfer(address b,uint256 n) public override returns(bool) {
        (callbackSucceeded,)=target.call(payload);
        return super.transfer(b,n);
    }
}

contract GroupEscrowV1Test {
    GroupVm constant vm = GroupVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockToken token;
    Group group;
    address alice=address(0xA11);
    address bob=address(0xB11);
    address carol=address(0xC11);
    address recipient=address(0xD11);
    bytes32 id;

    function setUp() public {
        vm.chainId(10143); vm.warp(1_000);
        token=new MockToken(); group=new Group(address(token),address(this));
        id=group.createGroup(terms(100_000,2,3),bytes32(uint256(1)));
        for(uint256 i=0;i<3;i++) {
            address a=i==0?alice:i==1?bob:carol;
            token.mint(a,10_000_000); vm.prank(a); token.approve(address(group),type(uint256).max);
        }
    }
    function terms(uint256 price,uint32 minimum,uint32 capacity) internal view returns(Group.Terms memory) {
        return Group.Terms(recipient,price,minimum,capacity,1000,2000,3000,keccak256("public terms"));
    }
    function eq(uint256 a,uint256 b) internal pure {require(a==b,"mismatch");}
    function join(address a) internal {vm.prank(a);group.contribute(id);}
    function invariantCheck() internal view {
        eq(group.totalDeposited(),group.totalLocked()+group.totalCredits()+group.totalWithdrawn());
        require(token.balanceOf(address(group))>=group.totalLocked()+group.totalCredits(),"insolvent");
        eq(group.creditOf(alice)+group.creditOf(bob)+group.creditOf(carol)+group.creditOf(recipient),group.totalCredits());
    }
    function testSuccessTimeLockAndFixedRecipient() public {
        join(alice);join(bob);vm.warp(2000);
        eq(uint256(group.effectiveState(id)),uint256(Group.State.READY));
        vm.expectRevert(Group.WindowNotStarted.selector);group.settle(id);
        vm.warp(3000);vm.prank(carol);group.settle(id);
        eq(group.totalLocked(),0);eq(group.creditOf(recipient),200_000);eq(token.balanceOf(recipient),0);
        vm.prank(carol);group.withdrawFor(id,recipient);
        eq(token.balanceOf(recipient),200_000);eq(token.balanceOf(carol),10_000_000);invariantCheck();
    }
    function testRefundForFailedGroupWithoutSeparateFinalize() public {
        join(alice);vm.warp(2000);vm.prank(carol);group.creditRefund(id,alice);
        eq(token.balanceOf(alice),9_900_000);eq(group.creditOf(alice),100_000);
        group.withdrawFor(id,alice);eq(token.balanceOf(alice),10_000_000);invariantCheck();
    }
    function testReadyDoesNotProveRealWorldDelivery() public {
        join(alice);join(bob);vm.warp(3000);group.settle(id);
        vm.expectRevert(Group.InvalidState.selector);group.creditRefund(id,alice);
    }
    function testCanLeaveAfterTargetBeforeDeadline() public {
        join(alice);join(bob);vm.warp(1999);vm.prank(bob);group.leave(id);
        eq(group.getGroup(id).activeCount,1);eq(group.totalLocked(),100_000);
        vm.warp(2000);group.finalize(id);eq(uint256(group.effectiveState(id)),uint256(Group.State.REFUNDABLE));invariantCheck();
    }
    function testDeadlineEqualityRejectsJoinAndLeave() public {
        join(alice);vm.warp(2000);vm.expectRevert(Group.WindowClosed.selector);vm.prank(bob);group.contribute(id);
        vm.expectRevert(Group.WindowClosed.selector);vm.prank(alice);group.leave(id);group.creditRefund(id,alice);invariantCheck();
    }
    function testDeadlineMinusOneJoinAndPlusOneRefund() public {
        vm.warp(1999);join(alice);vm.warp(2001);group.creditRefund(id,alice);invariantCheck();
    }
    function testBeforeStartCannotContribute() public {
        Group.Terms memory t=terms(100_000,2,3);t.startsAt=1500;bytes32 futureId=group.createGroup(t,bytes32(uint256(2)));
        vm.expectRevert(Group.WindowNotStarted.selector);vm.prank(alice);group.contribute(futureId);
    }
    function testNoEarlyFinalizeOrRefund() public {
        join(alice);vm.expectRevert(Group.WindowNotStarted.selector);group.finalize(id);
        vm.expectRevert(Group.WindowNotStarted.selector);group.creditRefund(id,alice);
    }
    function testReadyRefundForbidden() public {
        join(alice);join(bob);vm.warp(2000);vm.expectRevert(Group.InvalidState.selector);group.creditRefund(id,alice);
        eq(group.totalLocked(),200_000);invariantCheck();
    }
    function testCapacityAndDuplicateJoin() public {
        join(alice);vm.expectRevert(Group.AlreadyParticipated.selector);join(alice);join(bob);join(carol);
        address fourth=address(0xF11);vm.expectRevert(Group.CapacityReached.selector);vm.prank(fourth);group.contribute(id);
    }
    function testLeftCannotRejoinOrDoubleCredit() public {
        join(alice);vm.prank(alice);group.leave(id);
        vm.expectRevert(Group.AlreadyParticipated.selector);join(alice);
        vm.expectRevert(Group.AlreadyProcessed.selector);vm.prank(alice);group.leave(id);
        group.cancel(id);vm.expectRevert(Group.AlreadyProcessed.selector);group.creditRefund(id,alice);invariantCheck();
    }
    function testCancelledGroupRefundsOnlyOutstandingPositions() public {
        join(alice);join(bob);vm.prank(alice);group.leave(id);group.cancel(id);group.creditRefund(id,bob);
        group.withdrawFor(id,alice);group.withdrawFor(id,bob);eq(group.totalLocked(),0);eq(group.totalCredits(),0);invariantCheck();
    }
    function testOnlyCreatorCanCancel() public {
        join(alice);vm.expectRevert(Group.NotAuthorized.selector);vm.prank(alice);group.cancel(id);
    }
    function testCancelWinsRace() public {
        join(alice);join(bob);vm.warp(3000);group.cancel(id);
        vm.expectRevert(Group.InvalidState.selector);group.settle(id);group.creditRefund(id,alice);invariantCheck();
    }
    function testSettleWinsRace() public {
        join(alice);join(bob);vm.warp(3000);group.settle(id);
        vm.expectRevert(Group.InvalidState.selector);group.cancel(id);
        vm.expectRevert(Group.InvalidState.selector);group.settle(id);invariantCheck();
    }
    function testRepeatedFinalizationDoesNotChangeRights() public {
        join(alice);vm.warp(2000);group.finalize(id);
        vm.expectRevert(Group.InvalidState.selector);group.finalize(id);group.creditRefund(id,alice);invariantCheck();
    }
    function testRepeatedRefundAndWithdrawRejected() public {
        join(alice);group.cancel(id);group.creditRefund(id,alice);
        vm.expectRevert(Group.AlreadyProcessed.selector);group.creditRefund(id,alice);
        group.withdrawFor(id,alice);vm.expectRevert(Group.NothingToWithdraw.selector);group.withdrawFor(id,alice);invariantCheck();
    }
    function testAdminPauseOnlyNewBusiness() public {
        join(alice);group.setIntakePaused(true);
        vm.expectRevert(Group.IntakePaused.selector);join(bob);
        Group.Terms memory t=terms(1,2,2);vm.expectRevert(Group.IntakePaused.selector);group.createGroup(t,bytes32(uint256(2)));
        vm.prank(alice);group.leave(id);group.withdrawFor(id,alice);group.setIntakePaused(false);join(bob);invariantCheck();
    }
    function testPauseDoesNotStopCancellationRefund() public {
        join(alice);group.setIntakePaused(true);group.cancel(id);group.creditRefund(id,alice);group.withdrawFor(id,alice);invariantCheck();
    }
    function testPauseDoesNotStopSettlement() public {
        join(alice);join(bob);group.setIntakePaused(true);vm.warp(3000);group.settle(id);group.withdrawFor(id,recipient);invariantCheck();
    }
    function testPauseRequiresFixedAdmin() public {
        vm.expectRevert(Group.NotAuthorized.selector);vm.prank(alice);group.setIntakePaused(true);
    }
    function testTokenFailureRollsBackContribution() public {
        token.setFail(true);vm.expectRevert();join(alice);eq(group.getGroup(id).activeCount,0);eq(group.totalDeposited(),0);
        token.setFail(false);join(alice);invariantCheck();
    }
    function testIncomingFeeRejected() public {
        token.setFee(true);vm.expectRevert(Group.TransferAmountMismatch.selector);join(alice);eq(group.totalLocked(),0);eq(token.balanceOf(alice),10_000_000);
    }
    function testWithdrawalFailureKeepsCreditAndOtherPeopleCanWait() public {
        join(alice);join(bob);group.cancel(id);group.creditRefund(id,alice);group.creditRefund(id,bob);
        token.setFail(true);vm.expectRevert();group.withdrawFor(id,alice);eq(group.creditOf(alice),100_000);eq(group.withdrawnForBox(id,alice),0);
        token.setFail(false);group.withdrawFor(id,bob);group.withdrawFor(id,alice);invariantCheck();
    }
    function testOutgoingFeeRejectedAndCreditRestored() public {
        join(alice);vm.prank(alice);group.leave(id);token.setFee(true);
        vm.expectRevert(Group.TransferAmountMismatch.selector);group.withdrawFor(id,alice);eq(group.creditOf(alice),100_000);
        token.setFee(false);group.withdrawFor(id,alice);invariantCheck();
    }
    function testDifferentBoxesIsolateCredits() public {
        bytes32 otherId=group.createGroup(terms(250_000,2,3),bytes32(uint256(2)));
        join(alice);vm.prank(alice);group.contribute(otherId);
        group.cancel(id);group.creditRefund(id,alice);group.withdrawFor(id,alice);
        eq(group.getGroup(otherId).locked,250_000);eq(group.creditForBox(otherId,alice),0);invariantCheck();
    }
    function testCreatorMayBeBeneficiaryAndParticipantWithoutDoubleClaim() public {
        Group.Terms memory t=terms(100_000,2,3);t.beneficiary=alice;
        vm.prank(alice);bytes32 own=group.createGroup(t,bytes32(0));
        vm.prank(alice);group.contribute(own);vm.prank(bob);group.contribute(own);
        vm.warp(3000);group.settle(own);group.withdrawFor(own,alice);eq(token.balanceOf(alice),10_100_000);invariantCheck();
    }
    function testDirectDonationNeverCreatesCredit() public {
        vm.prank(alice);token.transfer(address(group),7);eq(group.totalDeposited(),0);
        vm.expectRevert(Group.NothingToWithdraw.selector);group.withdrawFor(id,alice);invariantCheck();
    }
    function testSaltReplayAndCreatorDomain() public {
        Group.Terms memory t=terms(100_000,2,3);vm.expectRevert(Group.AlreadyProcessed.selector);group.createGroup(t,bytes32(uint256(1)));
        vm.prank(alice);bytes32 other=group.createGroup(t,bytes32(uint256(1)));require(other!=id);
    }
    function testUnknownGroupCannotBeReadOrFunded() public {
        vm.expectRevert(Group.UnknownGroup.selector);group.getGroup(bytes32(0));
        vm.expectRevert(Group.UnknownGroup.selector);group.contribute(bytes32(0));
    }
    function testInvalidAddressesAndAmounts() public {
        Group.Terms memory t=terms(0,2,3);vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t=terms(1,2,3);t.beneficiary=address(0);vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t.beneficiary=address(group);vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t=terms(type(uint256).max,2,3);vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
    }
    function testInvalidCapacityAndTimes() public {
        Group.Terms memory t=terms(1,1,3);vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t=terms(1,4,3);vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t=terms(1,2,201);vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t=terms(1,2,3);t.startsAt=999;vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t.startsAt=2000;vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t.startsAt=1000;t.settleNotBefore=1999;vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
        t.settleNotBefore=3000;t.metadataHash=0;vm.expectRevert(Group.InvalidTerms.selector);group.createGroup(t,bytes32(0));
    }
    function testMainnetIntakeAndDeploymentRejected() public {
        vm.chainId(143);vm.expectRevert(Group.WrongChain.selector);new Group(address(token),address(this));
        vm.expectRevert(Group.WrongChain.selector);join(alice);
    }
    function testBadConstructorRejected() public {
        vm.expectRevert(Group.InvalidTerms.selector);new Group(address(0),address(this));
        vm.expectRevert(Group.InvalidTerms.selector);new Group(address(token),address(0));
    }
    function testReentrancyCannotJoinOrWithdrawTwice() public {
        CallbackToken c=new CallbackToken();Group g=new Group(address(c),address(this));
        bytes32 key=g.createGroup(terms(10,2,2),bytes32(0));c.mint(alice,100);
        vm.prank(alice);c.approve(address(g),100);c.configure(address(g),abi.encodeCall(g.contribute,(key)));
        vm.prank(alice);g.contribute(key);require(!c.callbackSucceeded());
        g.cancel(key);g.creditRefund(key,alice);c.configure(address(g),abi.encodeCall(g.withdrawFor,(key,alice)));
        g.withdrawFor(key,alice);require(!c.callbackSucceeded());eq(c.balanceOf(alice),100);eq(g.totalWithdrawn(),10);
    }
    function testFuzzFailureConservation(uint96 raw) public {
        uint256 amount=uint256(raw)%1_000_000+1;
        bytes32 key=group.createGroup(terms(amount,3,3),bytes32(uint256(7)));
        vm.prank(alice);group.contribute(key);vm.prank(bob);group.contribute(key);vm.warp(2000);
        group.creditRefund(key,alice);invariantCheck();group.creditRefund(key,bob);invariantCheck();
        group.withdrawFor(key,alice);group.withdrawFor(key,bob);invariantCheck();eq(group.totalCredits(),0);eq(group.totalLocked(),0);
    }
    function testFuzzRandomActionSequence(uint256 seed) public {
        for(uint256 i=0;i<40;i++) {
            seed=uint256(keccak256(abi.encode(seed,i)));
            address actor=seed%3==0?alice:seed%3==1?bob:carol;
            uint256 action=(seed/3)%6;
            vm.prank(actor);
            if(action==0) {try group.contribute(id) {} catch {}}
            else if(action==1) {try group.leave(id) {} catch {}}
            else if(action==2) {try group.creditRefund(id,actor) {} catch {}}
            else if(action==3) {try group.withdrawFor(id,actor) {} catch {}}
            else if(action==4) {try group.settle(id) {} catch {}}
            else {try group.cancel(id) {} catch {}}
            if(i==20) vm.warp(2000);
            if(i==30) vm.warp(3000);
            invariantCheck();
        }
        Group.State state=group.effectiveState(id);
        if(state==Group.State.READY) group.settle(id);
        else if(state==Group.State.REFUNDABLE || state==Group.State.CANCELLED) {
            address[3] memory actors=[alice,bob,carol];
            for(uint256 i;i<3;i++) if(group.positions(id,actors[i])==Group.Position.ACTIVE) group.creditRefund(id,actors[i]);
        }
        address[4] memory all=[alice,bob,carol,recipient];
        for(uint256 i;i<4;i++) if(group.creditForBox(id,all[i])>0) group.withdrawFor(id,all[i]);
        invariantCheck();eq(group.totalLocked(),0);eq(group.totalCredits(),0);
    }
}
