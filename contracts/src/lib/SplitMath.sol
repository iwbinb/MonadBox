// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

library SplitMath {
    error InvalidSplit();

    function validate(address[] memory recipients, uint16[] memory bps, address module) internal pure {
        uint256 count = recipients.length;
        if (count < 2 || count > 20 || bps.length != count) revert InvalidSplit();
        uint256 sum;
        for (uint256 i; i < count; ++i) {
            if (recipients[i] == address(0) || recipients[i] == module || bps[i] == 0) revert InvalidSplit();
            for (uint256 j; j < i; ++j) if (recipients[i] == recipients[j]) revert InvalidSplit();
            sum += bps[i];
        }
        if (sum != 10000) revert InvalidSplit();
    }

    /// @dev Largest remainder; ties go to the earlier frozen recipient. Safe for uint256.max.
    function allocate(uint256 amount, uint16[] memory bps) internal pure returns (uint256[] memory shares) {
        uint256 n = bps.length;
        if (n < 2 || n > 20) revert InvalidSplit();
        shares = new uint256[](n);
        uint256[] memory fractions = new uint256[](n);
        uint256 sum;
        uint256 weight;
        for (uint256 i; i < n; ++i) {
            if (bps[i] == 0) revert InvalidSplit();
            weight += bps[i];
            shares[i] = Math.mulDiv(amount, bps[i], 10000);
            fractions[i] = mulmod(amount, bps[i], 10000);
            sum += shares[i];
        }
        if (weight != 10000) revert InvalidSplit();
        uint256 remainder = amount - sum;
        for (uint256 k; k < remainder; ++k) {
            uint256 best;
            for (uint256 j = 1; j < n; ++j) if (fractions[j] > fractions[best]) best = j;
            ++shares[best];
            fractions[best] = 0;
        }
    }
}
