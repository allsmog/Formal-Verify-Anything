import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateProblem, validateStandalone } from '../src/guard.mjs';
import { compileLean, finalAcceptance } from '../src/compiler.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** A canonical report accounts for every locked benchmark exactly once. */
export function validateCanonicalReport(report, expectedIds) {
  if (!Array.isArray(expectedIds) || expectedIds.length !== 17 ||
      expectedIds.some(id => typeof id !== 'string') || new Set(expectedIds).size !== 17)
    throw new Error('Expected benchmark manifests must contain exactly 17 unique theorem IDs');
  if (!report || report.canonical !== true)
    throw new Error('The proof integrity gate requires a canonical report with canonical === true');
  const expected = new Set(expectedIds);
  const requireExactIds = (ids, field) => {
    if (!Array.isArray(ids) || ids.length !== expected.size ||
        new Set(ids).size !== expected.size || ids.some(id => !expected.has(id)))
      throw new Error(`Canonical ${field} must contain every expected theorem ID exactly once, without missing or extra IDs`);
  };
  requireExactIds(report.selectedIds, 'selectedIds');
  requireExactIds(Array.isArray(report.results) ? report.results.map(result => result?.id) : null, 'results');
}

export async function recheckRecordedProofs(reportArgument = 'benchmarks/results.json') {
  const reportPath = path.resolve(root, reportArgument);
  let source;
  try { source = await readFile(reportPath, 'utf8'); }
  catch (error) {
    if (error.code === 'ENOENT') throw new Error(`Canonical benchmark report not found: ${reportPath}`);
    throw error;
  }
  const report = JSON.parse(source);
  const problems = new Map();
  const expectedIds = [];
  for (const filename of ['tier1.json', 'minif2f.json']) {
    const dataset = JSON.parse(await readFile(path.join(root, 'benchmarks', filename), 'utf8'));
    for (const record of dataset.problems) {
      expectedIds.push(record.id);
      problems.set(record.id, validateProblem(record));
    }
  }
  validateCanonicalReport(report, expectedIds);
  let checked = 0;
  for (const result of report.results) {
    if (result.status !== 'SOLVED') continue;
    const problem = problems.get(result.id);
    if (!problem) throw new Error(`Unknown benchmark ${result.id}`);
    const file = path.resolve(root, result.proofFile);
    if (!file.startsWith(root)) throw new Error('Proof path escaped the repository');
    const original = await readFile(file, 'utf8');
    const guard = validateStandalone(problem, original, report.budget.heartbeats);
    if (guard.sourceHash !== result.verification.sourceHash) throw new Error(`Proof hash changed: ${result.id}`);
    const compilation = await compileLean(root, file, { timeoutMs: report.budget.callTimeoutMs });
    if (!finalAcceptance(compilation, problem.id) || await readFile(file, 'utf8') !== original)
      throw new Error(`Independent recheck failed: ${result.id}: ${compilation.stdout || compilation.stderr}`);
    checked++;
    console.log(`VERIFIED ${result.id} (${compilation.elapsedMs} ms)`);
  }
  console.log(`Rechecked ${checked} independently compiled proof files; all other outcomes remain failures.`);
  return checked;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  recheckRecordedProofs(process.argv[2]).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
