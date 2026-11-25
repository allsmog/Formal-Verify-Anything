import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export const FROZEN_HOLDOUT_SHA256 = 'c5180a561a72b0d069ef1bebc80b4163aa472ac076bc4d6128c9555682e821b3';
export const FROZEN_SELECTION_SHA256 = '65f24bc8fb7f18132b8a3afdee3a6c76ef3bf782e58d23d56ee7986b36ecff1c';

/** Load the frozen original declarations and the separately recorded execution environment. */
export async function loadHoldout(projectRoot = PROJECT_ROOT) {
  const read = async (name) => {
    const bytes = await readFile(path.join(projectRoot, 'benchmarks/v2', name));
    return { value: JSON.parse(bytes), sha256: sha256(bytes) };
  };
  const selection = await read('selection.json');
  const original = await read('holdout.json');
  const profiles = await read('execution-profiles.json');
  if (original.sha256 !== FROZEN_HOLDOUT_SHA256 || selection.sha256 !== FROZEN_SELECTION_SHA256) {
    throw new Error('Original frozen holdout or sampling bytes changed. Restore the recorded selection; do not resample.');
  }
  if (original.sha256 !== selection.value.holdoutManifestSha256) {
    throw new Error('Frozen holdout manifest changed. Restore its original bytes; do not resample.');
  }
  const priorBytes = await readFile(path.join(projectRoot, 'benchmarks/minif2f.json'));
  if (sha256(priorBytes) !== selection.value.v1ManifestSha256) throw new Error('The v1 manifest changed.');
  const priorIds = JSON.parse(priorBytes).problems.map((problem) => problem.id).sort();
  if (JSON.stringify(priorIds) !== JSON.stringify(selection.value.excludedV1Ids)) {
    throw new Error('The frozen exclusion list does not match the v1 dataset.');
  }
  if (original.value.problems.length !== 24 || new Set(original.value.problems.map((p) => p.id)).size !== 24) {
    throw new Error('The frozen suite must contain exactly 24 distinct declarations.');
  }
  const expectedPaths = [];
  for (const stratum of selection.value.strata) {
    if (stratum.take !== 8 || stratum.split !== 'Test') throw new Error('Unexpected frozen stratum.');
    const candidates = stratum.rankedCandidatePaths;
    if (candidates.length !== stratum.eligibleCount || new Set(candidates).size !== candidates.length) {
      throw new Error(`Invalid candidate inventory: ${stratum.category}`);
    }
    const ranked = [...candidates].sort((a, b) => {
      const aKey = sha256(`${selection.value.selectionSeed}\n${a}`);
      const bKey = sha256(`${selection.value.selectionSeed}\n${b}`);
      return aKey < bKey ? -1 : aKey > bKey ? 1 : a < b ? -1 : a > b ? 1 : 0;
    });
    if (JSON.stringify(ranked) !== JSON.stringify(candidates) ||
        JSON.stringify(ranked.slice(0, 8)) !== JSON.stringify(stratum.selectedPaths)) {
      throw new Error(`The frozen selection ranking changed: ${stratum.category}`);
    }
    expectedPaths.push(...stratum.selectedPaths);
  }
  if (JSON.stringify(expectedPaths) !== JSON.stringify(original.value.problems.map((p) => p.provenance.path))) {
    throw new Error('Selected theorem paths do not match the frozen sampling record.');
  }
  if (JSON.stringify(selection.value.selectedIds) !== JSON.stringify(original.value.problems.map((p) => p.id))) {
    throw new Error('Selected theorem identifiers do not match the frozen sampling record.');
  }
  const problems = original.value.problems.map((problem) => {
    if (priorIds.includes(problem.id)) throw new Error(`v1 overlap: ${problem.id}`);
    if (problem.provenance.split !== 'test' || problem.provenance.commit !== original.value.sourceCommit) {
      throw new Error(`Incorrect split or commit: ${problem.id}`);
    }
    if (sha256(problem.statement) !== problem.provenance.statementSha256) {
      throw new Error(`Original declaration changed: ${problem.id}`);
    }
    const profile = profiles.value.profiles[problem.id];
    if (!profile || JSON.stringify(profile.opens) !== JSON.stringify(problem.opens)) {
      throw new Error(`Original namespace openings must be preserved: ${problem.id}`);
    }
    if (!Array.isArray(profile.imports) || !profile.imports.length ||
        profile.imports.some((module) => !/^Mathlib\.[A-Za-z0-9_.]+$/.test(module))) {
      throw new Error(`Invalid fixed import profile: ${problem.id}`);
    }
    return {
      ...problem,
      imports: [...profile.imports],
      opens: [...profile.opens],
      provenance: {
        ...problem.provenance,
        executionProfileSha256: profiles.sha256,
        executionImportReason: profile.reason,
      },
    };
  });
  return {
    problems,
    suite: original.value,
    selection: selection.value,
    importPolicy: profiles.value.policy,
    inputHashes: {
      'benchmarks/v2/holdout.json': original.sha256,
      'benchmarks/v2/selection.json': selection.sha256,
      'benchmarks/v2/execution-profiles.json': profiles.sha256,
    },
  };
}
