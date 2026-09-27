#!/usr/bin/env bash
# Pinned official Linux tools for local/CI tests. Never downloads or executes a remote shell script.
set -euo pipefail
[[ "$(uname -s)-$(uname -m)" == "Linux-x86_64" ]] || { echo 'CI installer supports Linux x86_64 only; install Foundry 1.8.3 separately on other platforms.' >&2; exit 1; }
mkdir -p tools
curl -fLsS --retry 2 'https://github.com/foundry-rs/foundry/releases/download/v1.8.3/foundry_v1.8.3_linux_amd64.tar.gz' -o tools/foundry.tar.gz
printf '%s  %s\n' '7ca48e6ca3cac1bce1403ca67e5bc1dc3bc1fd818199c9957c7165079c228568' 'tools/foundry.tar.gz' | sha256sum -c -
tar -xzf tools/foundry.tar.gz -C tools forge cast anvil
curl -fLsS --retry 2 'https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/linux-amd64/solc-linux-amd64-v0.8.28+commit.7893614a' -o tools/solc
printf '%s  %s\n' '9a0fb7e0db2c0641dbae1c5cc645dc686820c83af516226abb1c0a2f76636f25' 'tools/solc' | sha256sum -c -
chmod 755 tools/solc
rm tools/foundry.tar.gz
