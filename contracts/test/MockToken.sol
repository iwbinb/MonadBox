// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;
// LOCAL TEST ONLY. Never deployed by the application or on Monad.
contract MockToken {
    function name() external pure returns (string memory) { return "Local test AUSD"; }
    function symbol() external pure returns (string memory) { return "AUSD"; }
    function decimals() external pure virtual returns (uint8) { return 6; }
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public fail;
    bool public fee;
    bool public reenter;
    bool public reentered;
    event Transfer(address indexed from,address indexed to,uint256 amount);
    event Approval(address indexed owner,address indexed spender,uint256 value);
    function mint(address to,uint256 n) external {balanceOf[to]+=n;emit Transfer(address(0),to,n);}
    function setFail(bool v) external { fail=v; }
    function setFee(bool v) external { fee=v; }
    function setReenter(bool v) external { reenter=v; }
    function approve(address spender,uint256 n) external returns(bool) {allowance[msg.sender][spender]=n;emit Approval(msg.sender,spender,n);return true;}
    function transfer(address to,uint256 n) external returns(bool) {if(fail)return false;move(msg.sender,to,n);return true;}
    function transferFrom(address from,address to,uint256 n) external returns(bool) {
        if(fail)return false;
        require(allowance[from][msg.sender]>=n,"allowance");allowance[from][msg.sender]-=n;
        if(reenter){(bool ok,)=msg.sender.call(abi.encodeWithSignature("fund(bytes32,uint256)",bytes32(uint256(500)),1));reentered=ok;}
        move(from,to,n);return true;
    }
    function move(address from,address to,uint256 n) internal {require(balanceOf[from]>=n,"balance");balanceOf[from]-=n;uint256 delivered=fee?n-1:n;balanceOf[to]+=delivered;emit Transfer(from,to,delivered);}
}
contract WrongDecimalsToken is MockToken {function decimals() external pure override returns(uint8){return 18;}}
