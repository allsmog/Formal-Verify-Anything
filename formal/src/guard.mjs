import { createHash } from 'node:crypto';

export class GuardError extends Error {
  constructor(message) { super(message); this.name = 'GuardError'; this.code = 'guard_rejected'; }
}

export const sha256 = text => createHash('sha256').update(text).digest('hex');
const identifier = /^[A-Za-z_][A-Za-z0-9_']*$/;
const prohibited = /\b(?:sorry|admit|sorryAx|axiom|unsafe|native_decide|ofReduceBool|ofReduceNat|trustCompiler|run_tac|run_elab|by_elab|elab|macro|macro_rules|syntax|initialize|builtin_initialize|set_option|attribute|import|export|namespace|section|end|opaque|constant|def|lemma|theorem|instance|deriving|termination_by|decreasing_by)\b/u;
const executableNamespace = /\b(?:IO|Lean|Meta|Elab|System)\s*\./u;

function rejectCodeEscapes(text, kind) {
  if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 32768)
    throw new GuardError(`${kind} must be nonempty text of at most 32768 bytes`);
  // Comments/strings/quotations are unnecessary in tactic proposals and can
  // hide tokens, spoof bridge output, or escape the locked source scaffold.
  if (/--|\/-|-\/|["`«»\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(text) || text.includes('#'))
    throw new GuardError(`${kind} contains a comment, quotation, control character, or command`);
  if (prohibited.test(text) || executableNamespace.test(text))
    throw new GuardError(`${kind} contains a forbidden declaration, escape, or proof shortcut`);
  if (/\bfva_[A-Za-z0-9_]*\b/u.test(text))
    throw new GuardError(`${kind} uses the reserved observation bridge namespace`);
}

export function validateTactic(tactic) {
  rejectCodeEscapes(tactic, 'Tactic');
  return tactic;
}

export function validateProblem(input) {
  if (!input || typeof input.id !== 'string' || !identifier.test(input.id)) throw new GuardError('A simple theorem identifier is required');
  if (typeof input.statement !== 'string') throw new GuardError('The original theorem statement is required');
  const header = new RegExp(`^theorem\\s+${input.id.replaceAll("'", "\\'")}(?=\\s|:|\\(|\\{|\\[)`);
  const match = input.statement.match(header);
  if (!match) throw new GuardError('The declaration name must match the problem identifier');
  const remainder = input.statement.slice(match[0].length);
  rejectCodeEscapes(remainder, 'Statement');
  if (remainder.includes(':=')) throw new GuardError('Supply a theorem type, without a proof or local definition');
  const imports = input.imports ?? ['Mathlib'];
  if (!Array.isArray(imports) || imports.some(x => typeof x !== 'string' ||
      (!/^(?:Mathlib(?:\.[A-Za-z0-9_]+)*|Std(?:\.[A-Za-z0-9_]+)*|Init)$/.test(x) && x !== 'FormalVerify.Examples.TokenModel')))
    throw new GuardError('Only pinned Mathlib, Std, Init, and the reviewed TokenModel definition module are admitted');
  const opens = input.opens ?? [];
  if (!Array.isArray(opens) || opens.some(x => typeof x !== 'string' || !/^[A-Za-z0-9_. ]+$/.test(x)))
    throw new GuardError('Invalid open namespaces');
  const actualHash = sha256(input.statement);
  // Every explicitly supplied provenance claim must agree. A newer alias
  // cannot suppress an older authoritative digest, and empty values are not
  // treated as if no integrity check had been requested.
  const hashClaims = [
    [input, 'statementHash', 'statementHash'],
    [input, 'statement_sha256', 'statement_sha256'],
    [input.provenance, 'statement_sha256', 'provenance.statement_sha256'],
    [input.provenance, 'statementSha256', 'provenance.statementSha256'],
  ];
  for (const [owner, key, label] of hashClaims) {
    if (owner == null || !Object.hasOwn(owner, key)) continue;
    const expectedHash = owner[key];
    if (typeof expectedHash !== 'string' || !/^[0-9a-f]{64}$/.test(expectedHash))
      throw new GuardError(`Invalid original statement hash in ${label}`);
    if (expectedHash !== actualHash)
      throw new GuardError(`Original statement hash mismatch in ${label}`);
  }
  return Object.freeze({ ...input, imports: Object.freeze([...imports]), opens: Object.freeze([...opens]), statementHash: actualHash });
}

export function sourcePrefix(problem, heartbeats) {
  if (!Number.isSafeInteger(heartbeats) || heartbeats < 1) throw new GuardError('Positive heartbeat budget required');
  return [...problem.imports.map(x => `import ${x}`), 'import FormalVerify.Bridge', '',
    ...problem.opens.map(x => `open ${x}`), `set_option maxHeartbeats ${heartbeats}`, '',
    `${problem.statement} := by`, ''].join('\n');
}

export function renderStandalone(problem, body, heartbeats) {
  validateTactic(body);
  return sourcePrefix(problem, heartbeats) + body.split('\n').map(x => `  ${x}`).join('\n') +
    `\n\n#fva_audit ${problem.id}\n`;
}

export function validateStandalone(problem, source, heartbeats) {
  const prefix = sourcePrefix(problem, heartbeats);
  const suffix = `\n\n#fva_audit ${problem.id}\n`;
  if (!source.startsWith(prefix) || !source.endsWith(suffix))
    throw new GuardError('The theorem, imports, budgets, or audit scaffold changed');
  if (/\b(?:sorry|admit|sorryAx|axiom)\b/u.test(source)) throw new GuardError('Forbidden proof token');
  const lines = source.slice(prefix.length, -suffix.length).split('\n');
  if (lines.some(x => !x.startsWith('  '))) throw new GuardError('Proof escaped its declaration');
  validateTactic(lines.map(x => x.slice(2)).join('\n'));
  return { statementHash: problem.statementHash, sourceHash: sha256(source), zeroPlaceholders: true };
}
