// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
import {PullCredit} from "./lib/PullCredit.sol";

contract RewardsDistributorV1 is PullCredit {
    struct Terms { address[] recipients; uint256[] amounts; uint64 claimStart; uint64 claimDeadline; bytes32 metadataHash; }
    struct Batch { address creator; bytes32 termsHash; Terms terms; uint256 totalAmount; uint256 claimedAmount; uint16 claimedCount; bool reclaimed; }
    mapping(bytes32 => Batch) private _batches;
    mapping(bytes32 => mapping(address => uint256)) public allocation;
    mapping(bytes32 => mapping(address => bool)) public claimed;
    event RewardClaimed(bytes32 indexed boxId,address indexed recipient,uint256 amount);
    event ExpiredReclaimed(bytes32 indexed boxId,address indexed creator,uint256 amount);
    constructor(address token,address admin) PullCredit(token,admin) {}
    function createAndFundBatch(Terms calldata t,bytes32 salt) external payable intakeOpen nonReentrant returns(bytes32 id) {
        uint256 count=t.recipients.length;
        if(count==0||count>100||count!=t.amounts.length||t.claimStart>=t.claimDeadline||t.claimDeadline<=block.timestamp||t.metadataHash==0)revert InvalidTerms();
        id=boxIdFor(msg.sender,salt);if(_batches[id].creator!=address(0))revert AlreadyProcessed();
        uint256 total;address previous;
        for(uint256 n;n<count;++n){
            address recipient=t.recipients[n];uint256 amount=t.amounts[n];
            if(uint160(recipient)<=uint160(previous)||recipient==address(this)||amount==0)revert InvalidTerms();
            previous=recipient;total+=amount;allocation[id][recipient]=amount;
        }
        Batch storage b=_batches[id];b.creator=msg.sender;b.terms=t;b.totalAmount=total;
        b.termsHash=keccak256(abi.encode(uint256(1),CHAIN_ID,address(this),id,address(asset),msg.sender,t));
        _deposit(id,msg.sender,total);
        emit BoxCreated(id,msg.sender,address(asset),1,b.termsHash,t.metadataHash);
    }
    function getBatch(bytes32 id) external view returns(Batch memory){return _batch(id);}
    function claimFor(bytes32 id,address recipient) external nonReentrant {
        Batch storage b=_batch(id);
        if(block.timestamp<b.terms.claimStart)revert WindowNotStarted();
        if(block.timestamp>=b.terms.claimDeadline)revert WindowClosed();
        uint256 amount=allocation[id][recipient];if(amount==0)revert NotAuthorized();
        if(claimed[id][recipient]||b.reclaimed)revert AlreadyProcessed();
        claimed[id][recipient]=true;++b.claimedCount;b.claimedAmount+=amount;
        _credit(id,recipient,amount,keccak256("REWARD"));emit RewardClaimed(id,recipient,amount);
    }
    function reclaimExpired(bytes32 id) external nonReentrant {
        Batch storage b=_batch(id);if(msg.sender!=b.creator)revert NotAuthorized();
        if(block.timestamp<b.terms.claimDeadline)revert WindowNotStarted();
        uint256 amount=locked[id];if(b.reclaimed||amount==0)revert AlreadyProcessed();
        b.reclaimed=true;_credit(id,b.creator,amount,keccak256("EXPIRED_REWARDS"));emit ExpiredReclaimed(id,b.creator,amount);
    }
    function _batch(bytes32 id) private view returns(Batch storage b){b=_batches[id];if(b.creator==address(0))revert InvalidState();}
}
