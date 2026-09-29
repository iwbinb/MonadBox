// Test-only entry: real Worker/D1 against fixed loopback Anvil. Never deployed.
import { createApp } from '../../src/worker/index';
import { makeCloudChain } from '../../src/shared/cloud/chain';
import { makeClient } from '../../src/shared/network';
import { createPublicClient, http } from 'viem';
const chain = makeClient().chain;
const client = createPublicClient({ chain, transport: http('http://127.0.0.1:18745') });
export default { fetch: createApp(makeCloudChain(client)).fetch };
