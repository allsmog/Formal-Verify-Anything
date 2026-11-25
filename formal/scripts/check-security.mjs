import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { sha256, validateProblem } from '../src/guard.mjs';
import { compileLean, assessFinal } from '../src/compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function recheckSecurity() {
  const modelFile = path.join(root, 'FormalVerify/Examples/TokenModel.lean');
  const model = await readFile(modelFile, 'utf8');
  for (const name of ['token-conservation', 'token-at-most-once']) {
    const manifest = validateProblem(JSON.parse(await readFile(path.join(root, `examples/security/${name}.json`), 'utf8')));
    if (manifest.provenance.trustedModelSha256 !== sha256(model))
      throw new Error(`The reviewed security model no longer matches ${name}'s recorded hash`);
  }
  const file = path.join(root, 'examples/security/AtomicToken.lean');
  const original = await readFile(file, 'utf8');
  if (/\b(?:sorry|admit|sorryAx|axiom)\b/u.test(original)) throw new Error('A forbidden proof token appears in the security example');
  const compiled = await compileLean(root, file, { timeoutMs: 30000 });
  const names = ['token_trace_conservation', 'token_authorization_at_most_once',
    'spent_token_never_authorizes', 'two_successful_authorizations_are_impossible'];
  for (const name of names) {
    const assessment = assessFinal(compiled, name);
    if (!assessment.accepted) throw new Error(`Security proof ${name} rejected: ${assessment.reason}`);
    console.log(`VERIFIED ${name}`);
  }
  if (await readFile(file, 'utf8') !== original || await readFile(modelFile, 'utf8') !== model)
    throw new Error('A security source changed during verification');
  console.log(`Rechecked ${names.length} abstract security-model proofs with the independent kernel audit.`);
  return names.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  recheckSecurity().catch(error => { console.error(error.message); process.exitCode = 1; });
}
