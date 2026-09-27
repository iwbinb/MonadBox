// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {M0CProbe} from "../src/M0CProbe.sol";
import {MockToken,WrongDecimalsToken} from "./MockToken.sol";
interface Vm {
    function chainId(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}
contract M0CProbeTest {
    Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockToken token;M0CProbe probe;
    address payer=address(0xB11);address other=address(0xB22);
    function setUp() public {vm.chainId(10143);token=new MockToken();probe=new M0CProbe(address(token));token.mint(payer,2_000_000);vm.prank(payer);token.approve(address(probe),2_000_000);}
    function eq(uint256 a,uint256 b) internal pure {require(a==b,"not equal");}
    function funded(uint256 n,uint256 salt) internal returns(bytes32 id){vm.prank(payer);id=probe.fund(bytes32(salt),n);}
    function testFundRefundToPayerOnly() public {bytes32 id=funded(100_000,1);eq(probe.totalLocked(),100_000);vm.prank(other);probe.refund(id);eq(token.balanceOf(other),0);eq(token.balanceOf(payer),2_000_000);eq(probe.totalLocked(),0);}
    function testRepeatRefundRejected() public {bytes32 id=funded(100,1);probe.refund(id);vm.expectRevert(M0CProbe.NothingToRefund.selector);probe.refund(id);}
    function testUsedNonceCannotReenterAfterRefund() public {bytes32 id=funded(100,1);probe.refund(id);vm.expectRevert(M0CProbe.AlreadyUsed.selector);vm.prank(payer);probe.fund(bytes32(uint256(1)),100);}
    function testSameNonceDifferentPayersIsolated() public {bytes32 a=funded(100,1);token.mint(other,100);vm.prank(other);token.approve(address(probe),100);vm.prank(other);bytes32 b=probe.fund(bytes32(uint256(1)),100);require(a!=b);probe.refund(a);eq(probe.lockedBy(other),100);}
    function testZeroAndExcessRejected() public {vm.expectRevert(M0CProbe.InvalidAmount.selector);vm.prank(payer);probe.fund(bytes32(0),0);vm.expectRevert(M0CProbe.InvalidAmount.selector);vm.prank(payer);probe.fund(bytes32(0),1_000_001);}
    function testOutstandingCap() public {funded(600_000,1);vm.expectRevert(M0CProbe.InvalidAmount.selector);vm.prank(payer);probe.fund(bytes32(uint256(2)),400_001);eq(probe.totalLocked(),600_000);}
    function testTransferFailurePreservesRefund() public {bytes32 id=funded(100,1);token.setFail(true);vm.expectRevert();probe.refund(id);(,,bool done)=probe.payments(id);require(!done);eq(probe.lockedBy(payer),100);token.setFail(false);probe.refund(id);eq(probe.totalLocked(),0);}
    function testTransferFailureRollsBackFunding() public {token.setFail(true);vm.expectRevert();vm.prank(payer);probe.fund(bytes32(uint256(1)),100);eq(probe.totalLocked(),0);token.setFail(false);funded(100,1);}
    function testFeeTokenRejected() public {token.setFee(true);vm.expectRevert(M0CProbe.TransferAmountMismatch.selector);vm.prank(payer);probe.fund(bytes32(uint256(1)),100);eq(probe.totalLocked(),0);eq(token.balanceOf(payer),2_000_000);}
    function testRefundFeeRollsBack() public {bytes32 id=funded(100,1);token.setFee(true);vm.expectRevert(M0CProbe.TransferAmountMismatch.selector);probe.refund(id);(,,bool done)=probe.payments(id);require(!done);eq(probe.totalLocked(),100);token.setFee(false);probe.refund(id);eq(token.balanceOf(payer),2_000_000);}
    function testReentrantFundingBlocked() public {token.setReenter(true);funded(100,1);require(!token.reentered());eq(probe.totalLocked(),100);}
    function testUnknownRefundRejected() public {vm.expectRevert(M0CProbe.NothingToRefund.selector);probe.refund(bytes32(uint256(50)));}
    function testMainnetDeploymentBlocked() public {vm.chainId(143);vm.expectRevert(M0CProbe.WrongChain.selector);new M0CProbe(address(token));}
    function testMainnetFundingBlocked() public {vm.chainId(143);vm.expectRevert(M0CProbe.WrongChain.selector);vm.prank(payer);probe.fund(bytes32(0),100);}
    function testBadTokenRejected() public {vm.expectRevert(M0CProbe.InvalidToken.selector);new M0CProbe(address(0));WrongDecimalsToken bad=new WrongDecimalsToken();vm.expectRevert(M0CProbe.InvalidToken.selector);new M0CProbe(address(bad));}
    function testUnsolicitedTransferDoesNotCreateClaim() public {vm.prank(payer);token.transfer(address(probe),100);eq(probe.totalLocked(),0);vm.expectRevert();probe.refund(bytes32(0));}
    function testFuzzConservation(uint96 raw) public {uint256 n=uint256(raw)%1_000_000+1;bytes32 id=funded(n,1);eq(token.balanceOf(address(probe)),probe.totalLocked());eq(token.balanceOf(payer)+probe.totalLocked(),2_000_000);probe.refund(id);eq(token.balanceOf(payer),2_000_000);eq(probe.totalLocked(),0);eq(probe.lockedBy(payer),0);}
    function testFuzzSequence(uint64 seed) public {uint256 n=uint256(seed)%100_000+1;bytes32[8] memory ids;for(uint256 i;i<8;i++){ids[i]=funded(n,i);eq(token.balanceOf(address(probe)),probe.totalLocked());}for(uint256 i;i<8;i++){probe.refund(ids[7-i]);eq(token.balanceOf(address(probe)),probe.totalLocked());}eq(token.balanceOf(payer),2_000_000);}
}
