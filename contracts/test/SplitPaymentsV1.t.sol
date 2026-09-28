// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {SplitPaymentsV1 as Split} from "../src/SplitPaymentsV1.sol";
import {GroupEscrowV2 as Group} from "../src/GroupEscrowV2.sol";
import {PullCredit} from "../src/lib/PullCredit.sol";
import {SplitMath} from "../src/lib/SplitMath.sol";
import {MockToken} from "./MockToken.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

interface SplitVm {
    function chainId(uint256) external;
    function warp(uint256) external;
    function prank(address) external;
    function expectRevert() external;
    function expectRevert(bytes4) external;
}
contract SplitHarness {
    function allocate(uint256 amount, uint16[] memory bps) external pure returns (uint256[] memory) { return SplitMath.allocate(amount, bps); }
}
contract RecipientFreezeToken is ERC20 {
    address public frozen;
    constructor() ERC20("Local token", "LOCAL") {}
    function mint(address account, uint256 amount) external { _mint(account, amount); }
    function freeze(address account) external { frozen = account; }
    function _update(address from, address to, uint256 amount) internal override { require(to != frozen, "frozen"); super._update(from, to, amount); }
}
contract SplitPaymentsV1Test {
    SplitVm constant vm = SplitVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockToken token;
    Split split;
    SplitHarness math;
    address alice = address(0xA11);
    address bob = address(0xB11);
    address payer = address(0xC11);
    bytes32 id;
    function setUp() public {
        vm.chainId(10143); vm.warp(1000);
        token = new MockToken(); split = new Split(address(token), address(this)); math = new SplitHarness();
        id = split.createSplit(terms(), bytes32(0));
        token.mint(payer, 1_000_000); vm.prank(payer); token.approve(address(split), type(uint256).max);
    }
    function terms() internal view returns (Split.Terms memory t) {
        t.recipients = new address[](2); t.recipients[0] = alice; t.recipients[1] = bob;
        t.bps = new uint16[](2); t.bps[0] = 7000; t.bps[1] = 3000; t.metadataHash = keccak256("split");
    }
    function eq(uint256 a, uint256 b) internal pure { require(a == b, "mismatch"); }
    function conservation() internal view {
        eq(split.totalDeposited(), split.totalLocked()+split.totalCredits()+split.totalWithdrawn());
        require(token.balanceOf(address(split)) >= split.totalLocked()+split.totalCredits(), "insolvent");
    }
    function pay(uint256 amount, bytes32 nonce) internal returns (bytes32) { vm.prank(payer); return split.pay(id, amount, nonce); }
    function testFinalPaymentAndReceipt() public {
        bytes32 payment = pay(101, bytes32(0));
        eq(split.creditForBox(id, alice), 71); eq(split.creditForBox(id, bob), 30);
        eq(split.locked(id), 0); eq(split.getReceipt(payment).amount, 101);
        require(split.getReceipt(payment).payer == payer); require(split.getReceipt(payment).boxId == id);
        vm.prank(payer); split.withdrawFor(id, alice); eq(token.balanceOf(alice), 71); eq(token.balanceOf(payer), 999899); conservation();
    }
    function testGlobalPayerNonceCannotPaySameOrDifferentBoxTwice() public {
        pay(10, bytes32(0)); vm.expectRevert(PullCredit.AlreadyProcessed.selector); pay(10, bytes32(0));
        bytes32 other = split.createSplit(terms(), bytes32(uint256(2)));
        vm.expectRevert(PullCredit.AlreadyProcessed.selector); vm.prank(payer); split.pay(other, 10, bytes32(0));
        pay(10, bytes32(uint256(1))); conservation();
    }
    function testZeroAmountAndUnknownSplitReject() public {
        vm.expectRevert(PullCredit.InvalidTerms.selector); pay(0, bytes32(0)); require(!split.usedNonce(payer, bytes32(0)));
        vm.expectRevert(PullCredit.InvalidState.selector); split.pay(bytes32(uint256(4)), 1, bytes32(0));
    }
    function testCreateRejectsReplayButDomainsCreator() public {
        Split.Terms memory t = terms(); vm.expectRevert(PullCredit.AlreadyProcessed.selector); split.createSplit(t, bytes32(0));
        vm.prank(alice); require(split.createSplit(t, bytes32(0)) != id);
    }
    function testInvalidRecipientsAndWeights() public {
        Split.Terms memory t = terms(); t.recipients[0] = address(0); vm.expectRevert(SplitMath.InvalidSplit.selector); split.createSplit(t, bytes32(uint256(1)));
        t = terms(); t.recipients[0] = address(split); vm.expectRevert(SplitMath.InvalidSplit.selector); split.createSplit(t, bytes32(uint256(1)));
        t = terms(); t.recipients[1] = alice; vm.expectRevert(SplitMath.InvalidSplit.selector); split.createSplit(t, bytes32(uint256(1)));
        t = terms(); t.bps[0] = 0; vm.expectRevert(SplitMath.InvalidSplit.selector); split.createSplit(t, bytes32(uint256(1)));
        t = terms(); t.bps[0] = 6999; vm.expectRevert(SplitMath.InvalidSplit.selector); split.createSplit(t, bytes32(uint256(1)));
        t = terms(); t.bps = new uint16[](1); vm.expectRevert(SplitMath.InvalidSplit.selector); split.createSplit(t, bytes32(uint256(1)));
    }
    function testLengthLimitAndMetadata() public {
        Split.Terms memory t = terms(); t.recipients = new address[](21); t.bps = new uint16[](21);
        vm.expectRevert(SplitMath.InvalidSplit.selector); split.createSplit(t, bytes32(uint256(1)));
        t = terms(); t.metadataHash = 0; vm.expectRevert(PullCredit.InvalidTerms.selector); split.createSplit(t, bytes32(uint256(1)));
    }
    function testIntakePauseKeepsWithdrawals() public {
        pay(10, bytes32(0)); split.setIntakePaused(true);
        vm.expectRevert(PullCredit.IntakePaused.selector); pay(10, bytes32(uint256(1)));
        split.withdrawFor(id, alice); split.withdrawFor(id, bob); conservation();
        vm.expectRevert(PullCredit.NotAuthorized.selector); vm.prank(alice); split.setIntakePaused(false);
    }
    function testRejectedAndTaxedDepositRestoresNonceAndCredit() public {
        token.setFail(true); vm.expectRevert(); pay(10, bytes32(0)); require(!split.usedNonce(payer, bytes32(0)));
        token.setFail(false); token.setFee(true); vm.expectRevert(); pay(100, bytes32(0));
        require(!split.usedNonce(payer, bytes32(0))); eq(split.creditOf(alice), 0); conservation();
        token.setFee(false); pay(100, bytes32(0)); conservation();
    }
    function testTaxedWithdrawalRestoresCredit() public {
        pay(100, bytes32(0)); token.setFee(true); vm.expectRevert(); split.withdrawFor(id, alice);
        eq(split.creditOf(alice), 70); eq(split.withdrawnForBox(id, alice), 0); conservation();
    }
    function testOneFrozenRecipientDoesNotBlockAnother() public {
        RecipientFreezeToken t = new RecipientFreezeToken(); Split s = new Split(address(t), address(this));
        bytes32 key = s.createSplit(terms(), bytes32(0)); t.mint(address(this), 100); t.approve(address(s), 100); s.pay(key, 100, bytes32(0));
        t.freeze(alice); vm.expectRevert(); s.withdrawFor(key, alice); s.withdrawFor(key, bob);
        eq(t.balanceOf(bob), 30); eq(s.creditForBox(key, alice), 70); eq(s.totalWithdrawn(), 30);
    }
    function testTieBreakUsesFrozenOrder() public {
        uint16[] memory weights = new uint16[](2); weights[0] = 5000; weights[1] = 5000;
        uint256[] memory shares = math.allocate(1, weights); eq(shares[0], 1); eq(shares[1], 0);
    }
    function testTwentyRecipientsAndUint256Maximum() public {
        uint16[] memory weights = new uint16[](20); for (uint256 i; i < 20; ++i) weights[i] = 500;
        uint256[] memory shares = math.allocate(type(uint256).max, weights); uint256 sum;
        for (uint256 i; i < 20; ++i) sum += shares[i]; eq(sum, type(uint256).max);
        shares = math.allocate(1, weights); eq(shares[0], 1); eq(shares[19], 0);
    }
    function testFuzzLargestRemainderConservation(uint256 amount, uint16 seed) public {
        uint16[] memory weights = new uint16[](2); weights[0] = uint16(uint256(seed)%9999+1); weights[1] = 10000-weights[0];
        uint256[] memory shares = math.allocate(amount, weights); eq(shares[0]+shares[1], amount);
    }
    function testFuzzErrorBelowOneUnit(uint96 amount, uint16 seed) public {
        uint16[] memory weights = new uint16[](3); weights[0] = uint16(uint256(seed)%9998+1); weights[1] = 1; weights[2] = 9999-weights[0];
        uint256[] memory shares = math.allocate(amount, weights); uint256 sum;
        for (uint256 i; i < 3; ++i) { uint256 actual = shares[i]*10000; uint256 ideal = uint256(amount)*weights[i]; require(actual > ideal ? actual-ideal < 10000 : ideal-actual < 10000); sum += shares[i]; }
        eq(sum, amount);
    }
}

contract GroupEscrowV2Test {
    SplitVm constant vm = SplitVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    MockToken token; Group group; bytes32 id;
    address alice = address(0xA11); address bob = address(0xB11); address seller = address(0xD11); address partner = address(0xE11);
    function setUp() public {
        vm.chainId(10143); vm.warp(1000); token = new MockToken(); group = new Group(address(token), address(this));
        id = group.createGroup(terms(), bytes32(0));
        token.mint(alice, 1000); token.mint(bob, 1000);
        vm.prank(alice); token.approve(address(group), 1000); vm.prank(bob); token.approve(address(group), 1000);
    }
    function terms() internal view returns (Group.Terms memory t) {
        t.unitPrice = 101; t.minParticipants = 2; t.capacity = 3; t.startsAt = 1000; t.fundingDeadline = 2000; t.settleNotBefore = 3000;
        t.recipients = new address[](2); t.recipients[0] = seller; t.recipients[1] = partner;
        t.bps = new uint16[](2); t.bps[0] = 7000; t.bps[1] = 3000; t.metadataHash = keccak256("group split");
    }
    function join(address who) internal { vm.prank(who); group.contribute(id); }
    function eq(uint256 a, uint256 b) internal pure { require(a == b, "mismatch"); }
    function conservation() internal view { eq(group.totalDeposited(), group.totalLocked()+group.totalCredits()+group.totalWithdrawn()); }
    function testSuccessAtomicFrozenSplit() public {
        join(alice); join(bob); vm.warp(3000); group.settle(id);
        eq(group.creditForBox(id, seller), 141); eq(group.creditForBox(id, partner), 61); eq(group.locked(id), 0);
        vm.expectRevert(PullCredit.InvalidState.selector); group.settle(id);
        vm.expectRevert(PullCredit.InvalidState.selector); group.cancel(id);
        group.withdrawFor(id, seller); group.withdrawFor(id, partner); conservation();
    }
    function testUnsuccessfulGroupNeverCreditsSplitRecipients() public {
        join(alice); vm.warp(2000); group.creditRefund(id, alice);
        eq(group.creditForBox(id, seller), 0); eq(group.creditForBox(id, partner), 0); eq(group.creditForBox(id, alice), 101);
        vm.expectRevert(PullCredit.InvalidState.selector); group.settle(id); conservation();
    }
    function testTargetDoesNotRemoveExitAndCannotRejoin() public {
        join(alice); join(bob); vm.warp(1999); vm.prank(bob); group.leave(id);
        eq(group.getGroup(id).activeCount, 1); eq(group.locked(id), 101);
        vm.expectRevert(Group.AlreadyParticipated.selector); join(bob);
        vm.warp(2000); group.creditRefund(id, alice); conservation();
    }
    function testDeadlineBoundariesAndSettlementLock() public {
        join(alice); join(bob); vm.warp(2000);
        vm.expectRevert(PullCredit.WindowClosed.selector); vm.prank(alice); group.leave(id);
        vm.expectRevert(PullCredit.WindowNotStarted.selector); group.settle(id);
        vm.expectRevert(PullCredit.InvalidState.selector); group.creditRefund(id, alice);
        vm.warp(3000); group.settle(id); conservation();
    }
    function testCancelRefundPauseAndDuplicate() public {
        join(alice); join(bob); group.setIntakePaused(true); group.cancel(id);
        group.creditRefund(id, alice); group.creditRefund(id, bob); group.withdrawFor(id, alice);
        vm.expectRevert(PullCredit.AlreadyProcessed.selector); group.creditRefund(id, alice);
        eq(group.creditOf(seller), 0); conservation();
    }
    function testTermsHashIncludesOrderAndWeights() public {
        Group.Terms memory t = terms(); t.bps[0] = 6000; t.bps[1] = 4000;
        bytes32 second = group.createGroup(t, bytes32(uint256(1)));
        require(group.getGroup(second).termsHash != group.getGroup(id).termsHash);
        bytes32 expected = keccak256(abi.encode(uint256(2), uint256(10143), address(group), second, address(token), address(this), t));
        require(group.getGroup(second).termsHash == expected);
    }
}
