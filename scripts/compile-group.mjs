import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { createHash } from 'node:crypto';
// Compilation only: no network, credentials, deployment or signatures.
export function compileGroup() {
  if (!solc.version().startsWith('0.8.28+')) throw Error('Expected pinned solc 0.8.28');
  const source = fs.readFileSync('contracts/src/GroupEscrowV1.sol', 'utf8');
  const input = {
    language: 'Solidity',
    sources: { 'GroupEscrowV1.sol': { content: source } },
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
  const c = output.contracts['GroupEscrowV1.sol'].GroupEscrowV1;
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
  fs.mkdirSync('artifacts/group', { recursive: true });
  fs.writeFileSync('artifacts/group/GroupEscrowV1.json', JSON.stringify(artifact, null, 2) + '\n');
  fs.mkdirSync('src/shared/group/generated', { recursive: true });
  fs.writeFileSync(
    'src/shared/group/generated/group.ts',
    'export const groupArtifact = ' + JSON.stringify(artifact) + ' as const;\n',
  );
  return artifact;
}
compileGroup();
