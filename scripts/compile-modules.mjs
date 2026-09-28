import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { createHash } from 'node:crypto';

// Deterministic local compilation. Group V1 retains its original, separate compiler input.
export const modules = ['SplitPaymentsV1', 'GroupEscrowV2', 'DeliveryEscrowV1'];
export function compileModules() {
  if (!solc.version().startsWith('0.8.28+')) throw Error('Expected pinned solc 0.8.28');
  const sources = Object.fromEntries(
    modules.map((name) => [
      name + '.sol',
      {
        content: fs.readFileSync(`contracts/src/${name}.sol`, 'utf8'),
      },
    ]),
  );
  const input = {
    language: 'Solidity',
    sources,
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
      import: (name) => {
        if (name.includes('..')) return { error: 'Import not permitted' };
        const file = name.startsWith('@openzeppelin/contracts/')
          ? path.join('node_modules', name)
          : /^lib\/[A-Za-z0-9]+\.sol$/.test(name)
            ? path.join('contracts/src', name)
            : null;
        return file
          ? { contents: fs.readFileSync(file, 'utf8') }
          : { error: 'Import not permitted' };
      },
    }),
  );
  const errors = (output.errors ?? []).filter((entry) => entry.severity === 'error');
  if (errors.length) throw Error(errors.map((entry) => entry.formattedMessage).join('\n'));
  fs.mkdirSync('artifacts/modules', { recursive: true });
  fs.mkdirSync('src/shared/modules/generated', { recursive: true });
  for (const name of modules) {
    const c = output.contracts[name + '.sol'][name];
    if (c.evm.deployedBytecode.object.length / 2 > 24576)
      throw Error(name + ' exceeds runtime size limit');
    const artifact = {
      compiler: solc.version(),
      evmVersion: 'paris',
      optimizerRuns: 200,
      sourceSha256: createHash('sha256')
        .update(sources[name + '.sol'].content)
        .digest('hex'),
      abi: c.abi,
      bytecode: '0x' + c.evm.bytecode.object,
      runtime: '0x' + c.evm.deployedBytecode.object,
      immutableReferences: c.evm.deployedBytecode.immutableReferences,
    };
    fs.writeFileSync(`artifacts/modules/${name}.json`, JSON.stringify(artifact, null, 2) + '\n');
    fs.writeFileSync(
      `src/shared/modules/generated/${name}.ts`,
      'export const artifact = ' + JSON.stringify(artifact) + ' as const;\n',
    );
  }
}
compileModules();
