#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadHoldout, PROJECT_ROOT, sha256 } from './suite.mjs';

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write('Usage: node benchmarks/v2/verify-source.mjs --source /path/to/miniF2F-lean4\nRead-only verification of frozen sampling, original source/declaration hashes, imports and licenses. No Lean jobs or provider calls.\n');
    return;
  }
  if (args.length !== 2 || args[0] !== '--source') throw new Error('--source requires the pinned upstream Git checkout.');
  const source = path.resolve(args[1]);
  const frozen = await loadHoldout();
  const commit = frozen.suite.sourceCommit;
  const git = (command) => execFileSync('git', ['-C', source, ...command], { maxBuffer: 4 * 1024 * 1024 });
  const inventory = git(['ls-tree', '-r', '--name-only', commit, 'MiniF2F/Test']).toString('utf8').trim().split('\n');
  for (const stratum of frozen.selection.strata) {
    const expected = inventory.filter((file) => file.startsWith(`MiniF2F/Test/${stratum.prefix}`) && file.endsWith('.lean') &&
      !frozen.selection.excludedV1Ids.includes(path.basename(file, '.lean'))).sort();
    if (JSON.stringify(expected) !== JSON.stringify([...stratum.rankedCandidatePaths].sort())) {
      throw new Error(`Candidate corpus differs from the pinned source: ${stratum.category}`);
    }
  }
  for (const problem of frozen.problems) {
    const bytes = git(['show', `${commit}:${problem.provenance.path}`]);
    if (sha256(bytes) !== problem.provenance.sourceFileSha256) throw new Error(`Source hash differs: ${problem.id}`);
    const sourceText = bytes.toString('utf8');
    const start = sourceText.indexOf(`theorem ${problem.id}`);
    const end = sourceText.indexOf(':= by', start);
    if (start < 0 || end < 0 || sourceText.slice(start, end) !== problem.statement) {
      throw new Error(`Exact original declaration differs: ${problem.id}`);
    }
    const prefix = sourceText.slice(0, start);
    const imports = [...prefix.matchAll(/^import (.+)$/gm)].map((match) => match[1]);
    const opens = [...prefix.matchAll(/^open (.+)$/gm)].map((match) => match[1]);
    if (JSON.stringify(imports) !== JSON.stringify(problem.provenance.originalImports) ||
        JSON.stringify(opens) !== JSON.stringify(problem.provenance.originalOpens)) {
      throw new Error(`Original import/open provenance differs: ${problem.id}`);
    }
    process.stdout.write(`Verified ${problem.id}\n`);
  }
  const oldManifest = JSON.parse(await readFile(path.join(PROJECT_ROOT, 'benchmarks/minif2f.json'), 'utf8'));
  for (const license of oldManifest.licenses) {
    if (sha256(await readFile(path.join(PROJECT_ROOT, 'benchmarks', license.path))) !== license.sha256) {
      throw new Error(`Preserved benchmark license differs: ${license.path}`);
    }
  }
  process.stdout.write('Verified all24 frozen declarations, complete candidate inventories, disjointness, original namespace openings, and preserved license hashes. No proof bodies were saved or supplied to a proposer.\n');
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
