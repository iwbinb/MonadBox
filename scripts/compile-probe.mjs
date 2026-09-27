import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { createHash } from 'node:crypto';
// Build output only. This script never connects to a chain or uses signing credentials.
export function compileProbe() {
  if (!solc.version().startsWith('0.8.28+')) throw Error('Expected pinned solc 0.8.28');
  const source = fs.readFileSync('contracts/src/M0CProbe.sol', 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'M0CProbe.sol': { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: 'paris',
      outputSelection: {
        '*': {
          '*': [
            'abi',
            'evm.bytecode.object',
            'evm.deployedBytecode.object',
            'evm.deployedBytecode.immutableReferences',
          ],
        },
      },
    },
  };
  const output = JSON.parse(
    solc.compile(JSON.stringify(input), {
      import: (p) => {
        if (!p.startsWith('@openzeppelin/contracts/') || p.includes('..'))
          return { error: 'Import not permitted' };
        return { contents: fs.readFileSync(path.join('node_modules', p), 'utf8') };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) throw Error(errors.map((e) => e.formattedMessage).join('\n'));
  const c = output.contracts['M0CProbe.sol'].M0CProbe;
  const artifact = {
    compiler: solc.version(),
    evmVersion: 'paris',
    optimizerRuns: 200,
    sourceSha256: createHash('sha256').update(source).digest('hex'),
    abi: c.abi,
    bytecode: '0x' + c.evm.bytecode.object,
    runtime: '0x' + c.evm.deployedBytecode.object,
    immutableReferences: c.evm.deployedBytecode.immutableReferences,
  };
  fs.mkdirSync('src/shared/lab/generated', { recursive: true });
  fs.writeFileSync('src/shared/lab/generated/probe.json', JSON.stringify(artifact, null, 2) + '\n');
  return artifact;
}
compileProbe();
