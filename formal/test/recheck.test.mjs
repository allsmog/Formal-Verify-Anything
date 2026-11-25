import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { validateCanonicalReport, recheckRecordedProofs } from '../scripts/recheck.mjs';

const expectedIds = Array.from({ length: 17 }, (_, i) => `benchmark_${i + 1}`);
const canonical = () => ({
  canonical: true,
  selectedIds: [...expectedIds],
  results: expectedIds.map(id => ({ id, status: 'FAILED' })),
});

test('canonical integrity gate accepts exactly the expected selected and result IDs', () => {
  assert.doesNotThrow(() => validateCanonicalReport(canonical(), expectedIds));
});

test('canonical integrity gate rejects a missing, false, or coerced canonical marker', () => {
  for (const value of [undefined, false, null, 1, 'true']) {
    const report = canonical();
    if (value === undefined) delete report.canonical;
    else report.canonical = value;
    assert.throws(() => validateCanonicalReport(report, expectedIds), /canonical/);
  }
  assert.throws(() => validateCanonicalReport(null, expectedIds), /canonical/);
});

test('canonical integrity gate rejects missing, extra, duplicate, and replaced IDs in either list', () => {
  const malformed = [
    expectedIds.slice(1),
    [...expectedIds, 'unexpected'],
    [...expectedIds.slice(0, -1), expectedIds[0]],
    [...expectedIds.slice(0, -1), 'unexpected'],
  ];
  for (const ids of malformed) {
    const selectionChanged = { ...canonical(), selectedIds: ids };
    assert.throws(() => validateCanonicalReport(selectionChanged, expectedIds), /selectedIds/);
    const resultsChanged = { ...canonical(), results: ids.map(id => ({ id, status: 'FAILED' })) };
    assert.throws(() => validateCanonicalReport(resultsChanged, expectedIds), /results/);
  }
  assert.throws(() => validateCanonicalReport({ ...canonical(), selectedIds: undefined }, expectedIds), /selectedIds/);
  assert.throws(() => validateCanonicalReport({ ...canonical(), results: undefined }, expectedIds), /results/);
  assert.throws(() => validateCanonicalReport({ ...canonical(), results: [null, ...canonical().results.slice(1)] }, expectedIds), /results/);
});

test('an incomplete or duplicate source manifest cannot redefine the expected denominator', () => {
  for (const ids of [expectedIds.slice(1), [...expectedIds, 'extra'], [...expectedIds.slice(0, -1), expectedIds[0]]])
    assert.throws(() => validateCanonicalReport(canonical(), ids), /Expected benchmark manifests/);
});

test('a missing canonical report rejects before any compiler can be called', async () => {
  const missing = path.join(os.tmpdir(), `fva-missing-report-${randomUUID()}.json`);
  await assert.rejects(recheckRecordedProofs(missing), /Canonical benchmark report not found/);
});
