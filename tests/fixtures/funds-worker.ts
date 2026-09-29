// Test-only funds server with a distinct loopback chain. Never deployed.
// Test-only entry: real Worker/D1 against fixed loopback Anvil. Never deployed.
import { createApp } from '../../src/worker/index';
import { makeCloudChain } from '../../src/shared/cloud/chain';
import { makeModuleChain } from '../../src/shared/modules/chain';
import { makeClient } from '../../src/shared/network';
import { createPublicClient, http } from 'viem';
const chain = makeClient().chain;
const client = createPublicClient({ chain, transport: http('http://127.0.0.1:18746') });
export default { fetch: createApp(makeCloudChain(client), makeModuleChain(client)).fetch };
