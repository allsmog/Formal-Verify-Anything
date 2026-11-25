#!/usr/bin/env node
// Fetch pinned source bytes, verify them, retain only original theorem declarations.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetPath = path.join(projectRoot, 'benchmarks', 'minif2f.json');
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`Source fetch failed (${response.status}): ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function main() {
  let check = false;
  let sourceDir = null;
  for (let index = 2; index < process.argv.length; index++) {
    const arg = process.argv[index];
    if (arg === '--check') check = true;
    else if (arg === '--source') sourceDir = process.argv[++index];
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('Usage: node scripts/fetch-minif2f.mjs [--check] [--source LOCAL_GIT_CHECKOUT]\nChecks pinned source-file and statement hashes. Full upstream proof bodies are never saved.\n');
      return;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (process.argv.includes('--source') && !sourceDir) throw new Error('--source needs a local Git checkout.');
  const dataset = JSON.parse(await readFile(datasetPath, 'utf8'));
  const prefix = `${dataset.sourceRepository.replace('https://github.com/', 'https://raw.githubusercontent.com/')}/${dataset.sourceCommit}`;
  for (const problem of dataset.problems) {
    const provenance = problem.provenance;
    if (provenance.commit !== dataset.sourceCommit || provenance.repository !== dataset.sourceRepository) {
      throw new Error(`Inconsistent dataset provenance for ${problem.id}.`);
    }
    const bytes = sourceDir
      ? execFileSync('git', ['-C', path.resolve(sourceDir), 'show', `${dataset.sourceCommit}:${provenance.path}`], { maxBuffer: 2 * 1024 * 1024 })
      : await download(`${prefix}/${provenance.path}`);
    if (hash(bytes) !== provenance.sourceFileSha256) throw new Error(`Source hash mismatch: ${problem.id}`);
    const source = bytes.toString('utf8');
    const start = source.indexOf(`theorem ${problem.id}\n`);
    const end = source.indexOf(':= by', start);
    if (start < 0 || end < 0) throw new Error(`Pinned source declaration not found: ${problem.id}`);
    const statement = source.slice(start, end);
    if (hash(statement) !== provenance.statementSha256) throw new Error(`Statement hash mismatch: ${problem.id}`);
    if (check && statement !== problem.statement) throw new Error(`Local declaration changed: ${problem.id}`);
    problem.statement = statement;
    process.stdout.write(`Verified ${problem.id}\n`);
  }
  for (const license of dataset.licenses) {
    const local = path.join(projectRoot, 'benchmarks', license.path);
    // --source is also useful for entirely offline verification of checked-in license bytes.
    const bytes = sourceDir ? await readFile(local) : await download(license.url);
    if (hash(bytes) !== license.sha256) throw new Error(`License hash mismatch: ${license.path}`);
    if (check) {
      if (hash(await readFile(local)) !== license.sha256) throw new Error(`Local license changed: ${license.path}`);
    } else await writeFile(local, bytes);
  }
  if (!check) await writeFile(datasetPath, `${JSON.stringify(dataset, null, 2)}\n`);
  process.stdout.write(`Verified ${dataset.problems.length} exact statement signatures at ${dataset.sourceCommit}; upstream proof bodies were not saved.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
