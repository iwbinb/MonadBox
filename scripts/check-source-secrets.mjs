import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const names = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
  .trim()
  .split('\n')
  .filter(Boolean);
const forbidden =
  /(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16})/;
const matches = [];
for (const file of new Set(names)) {
  const text = readFileSync(file, 'utf8');
  if (forbidden.test(text)) matches.push(file);
  if (/(?:^|\/)(?:\.env|\.dev\.vars)(?:\.|$)/.test(file) && !file.endsWith('.example'))
    matches.push(file);
}
if (matches.length)
  throw Error(
    'Potential credential material; inspect locally without printing values: ' +
      [...new Set(matches)].join(', '),
  );
console.log(
  `Source credential-pattern check: ${new Set(names).size} repository files checked; no matches. This is a bounded pattern check, not proof that no secret exists.`,
);
