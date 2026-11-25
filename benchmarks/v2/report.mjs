import path from 'node:path';

const cell = (value) => String(value ?? 'unknown').replaceAll('|', '\\|').replaceAll('\n', ' ');
const number = (value, digits = 0) => Number.isFinite(value) ? value.toFixed(digits) : 'unknown';
const rate = (successes, total) => total ? `${successes}/${total} (${(100 * successes / total).toFixed(1)}%)` : 'not run';
const failure = (row) => typeof row.failure === 'string' ? row.failure : row.failure?.category ?? row.failure?.code ?? row.status;

export function summarize(rows) {
  const solved = rows.filter((row) => row.status === 'SOLVED');
  const sumMeasured = (values) => values.every(Number.isFinite) ? values.reduce((a, b) => a + b, 0) : null;
  const calls = rows.map((row) => row.metrics?.compilerCalls);
  const solvedCalls = solved.map((row) => row.metrics?.compilerCalls);
  const depths = rows.map((row) => row.metrics?.maxDepth).filter(Number.isFinite);
  const tokenTotals = rows.map((row) => row.metrics?.modelTokens);
  const knownTokens = rows.map((row) => row.metrics?.modelTokensKnown ?? row.metrics?.modelTokens).filter(Number.isFinite);
  return {
    attempted: rows.length,
    solved: solved.length,
    compilerCalls: sumMeasured(calls),
    meanSolvedCalls: solved.length && solvedCalls.every(Number.isFinite) ? sumMeasured(solvedCalls) / solved.length : null,
    maxDepth: depths.length ? Math.max(...depths) : null,
    modelTokens: sumMeasured(tokenTotals),
    knownModelTokens: knownTokens.reduce((a, b) => a + b, 0),
    usageComplete: rows.every((row) => row.metrics?.modelUsageComplete !== false && Number.isFinite(row.metrics?.modelTokens)),
  };
}

export function renderComparison(evaluation, reportDir, projectRoot) {
  const link = (filename) => {
    if (!filename) return null;
    const absolute = path.isAbsolute(filename) ? filename : path.join(projectRoot, filename);
    return path.relative(reportDir, absolute).split(path.sep).map(encodeURIComponent).join('/');
  };
  const lines = [
    '# Formal Verify Anything v2 — provider comparison',
    '',
    `Run: \`${evaluation.runId}\`. Started ${evaluation.startedAt}; finished ${evaluation.finishedAt ?? 'not completed'}.`,
    '',
    `Scope: **${evaluation.comparisonStatus === 'INCOMPLETE' ? 'incomplete run; scheduling stopped and these partial results are not a complete holdout score' : evaluation.blockedProviders?.length ? 'provider comparison unavailable; results below cover only providers that actually ran' : evaluation.canonicalComparison ? 'complete paired 24-problem holdout comparison' : 'diagnostic or single-provider run; not the complete paired comparison'}**.`,
    '',
    '## Protocol',
    '',
    'Each provider receives one bounded search invocation per selected theorem. pass@1 means success of that complete invocation, including its internal proposals, recursive subgoals, and backtracking. It is not a first-tactic score or an estimate over repeated model samples. The deterministic and model runs receive the same original theorem, fixed import environment, compiler mode, compiler-call ceiling, search-step ceiling, recursion depth, heartbeat limit, and per-theorem wall-time budget.',
    '',
    'When selected, the model provider uses the actual Codex CLI adapter, which requires an already-authenticated CLI. Before any holdout model invocation, one real availability check uses a non-holdout True goal. An unavailable provider is blocked once; no doomed per-theorem calls are made, and its unattempted theorems are not scored as failures. Preflight usage, if reported, is recorded separately from theorem usage. After successful preflight, a theorem invocation that encounters a provider error, timeout, exhausted budget, or acceptance failure stays in the denominator. Missing token usage remains unknown.',
    '',
    'The order alternates by the theorem’s frozen index: deterministic first on even indices and Codex first on odd indices. Each invocation has isolated search state and output. No provider receives another provider’s proof or transcript. Both use the same configured exploration compiler, while successful final proofs are validated by fresh standalone compiler processes.',
    '',
    '| Shared resource limit | Value |',
    '| --- | ---: |',
    ...Object.entries(evaluation.sharedBudget).map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`),
    '',
    `Exploration compiler: \`${cell(evaluation.compilerMode)}\`. Model-token admission allowance per Codex invocation: **${evaluation.modelTokenBudget}**; deterministic allowance: **0**. This is not a provider billing cap: an already-running request can exceed the remaining allowance; its actual usage is still charged and its proposals are rejected.`,
    `Requested model: ${evaluation.modelRequest ? `\`${cell(evaluation.modelRequest)}\`` : 'the configured Codex default; resolved identity is recorded where reported by the provider'}.`,
    '',
    'The original statement strings and namespace openings are preserved. Fixed declaration-based Mathlib imports replace the upstream blanket import. This is an import-restricted configuration, not a claim of identical execution conditions to the full upstream benchmark. The selection was frozen before v2 evaluation, is disjoint from all twelve v1 miniF2F IDs, and contains eight Test algebra, eight Test number-theory, and all eight Test induction problems.',
    '',
    '## Results',
    '',
  ];
  if (evaluation.halt) lines.push(`Scheduling stopped: **${cell(evaluation.halt.category)}** — ${cell(evaluation.halt.message)}. The run is incomplete and cannot replace the canonical report.`, '');
  if (evaluation.providerPreflight) {
    const preflightPath = `benchmarks/v2/runs/${evaluation.runId}/provider-preflight.json`;
    lines.push(`Codex availability: **${cell(evaluation.providerPreflight.status)}**. [Actual preflight evidence](${link(preflightPath)}).`, '');
    if (evaluation.providerPreflight.status === 'BLOCKED') {
      lines.push(`Recorded blocker: ${cell(evaluation.providerPreflight.error?.code ?? 'provider_error')} — ${cell(evaluation.providerPreflight.error?.message).slice(0, 2000)}.`,
        '', '**No model holdout score exists for this run.** Deterministic outcomes below remain measured results; they are not evidence of model failure.', '');
    }
  }
  lines.push('| Provider | SOLVED / attempted (pass@1) | Compiler calls | Mean calls per solved theorem | Maximum explored depth | Model tokens |',
    '| --- | ---: | ---: | ---: | ---: | ---: |');
  for (const method of evaluation.methods) {
    if (evaluation.providerAvailability?.[method] === 'BLOCKED') {
      lines.push(`| ${cell(method)} | **BLOCKED — 0 theorem attempts; no score** | not attempted | not applicable | not applicable | see preflight evidence |`);
      continue;
    }
    const summary = summarize(evaluation.results.filter((row) => row.method === method));
    const tokens = summary.usageComplete ? number(summary.modelTokens) : `unknown (known subtotal ${summary.knownModelTokens})`;
    lines.push(`| ${cell(method)} | ${rate(summary.solved, summary.attempted)} | ${number(summary.compilerCalls)} | ${number(summary.meanSolvedCalls, 2)} | ${number(summary.maxDepth)} | ${tokens} |`);
  }
  lines.push('', '| Stratum | Provider | SOLVED / attempted |', '| --- | --- | ---: |');
  for (const category of ['algebra', 'number_theory', 'induction']) {
    for (const method of evaluation.methods) {
      if (evaluation.providerAvailability?.[method] === 'BLOCKED') {
        lines.push(`| ${cell(category)} | ${cell(method)} | BLOCKED — not attempted |`);
        continue;
      }
      const summary = summarize(evaluation.results.filter((row) => row.method === method && row.category === category));
      lines.push(`| ${cell(category)} | ${cell(method)} | ${rate(summary.solved, summary.attempted)} |`);
    }
  }
  if (evaluation.methods.length === 2 && !evaluation.blockedProviders?.length) {
    const comparison = { both: 0, deterministicOnly: 0, codexOnly: 0, neither: 0, incompletePairs: 0 };
    for (const id of evaluation.selectedIds) {
      const a = evaluation.results.find((row) => row.id === id && row.method === 'deterministic-v2');
      const b = evaluation.results.find((row) => row.id === id && row.method === 'codex');
      if (!a || !b) comparison.incompletePairs++;
      else if (a.status === 'SOLVED' && b.status === 'SOLVED') comparison.both++;
      else if (a.status === 'SOLVED') comparison.deterministicOnly++;
      else if (b.status === 'SOLVED') comparison.codexOnly++;
      else comparison.neither++;
    }
    lines.push('', `Paired outcomes: both **${comparison.both}**, deterministic only **${comparison.deterministicOnly}**, Codex only **${comparison.codexOnly}**, neither **${comparison.neither}**, incomplete pairs **${comparison.incompletePairs}**.`);
  }
  lines.push('', '## Per-theorem evidence', '',
    '| Theorem | Stratum | Provider | Status | Calls | Steps | Depth | Tokens | Evidence |',
    '| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |');
  for (const row of evaluation.results) {
    const details = link(row.detailsFile);
    const proof = link(row.proofFile);
    const evidence = proof ? `[proof](${proof}) · [trace](${details})` : `[${cell(failure(row))}](${details})`;
    lines.push(`| ${cell(row.id)} | ${cell(row.category)} | ${cell(row.method)} | ${cell(row.status)} | ${number(row.metrics?.compilerCalls)} | ${number(row.metrics?.steps)} | ${number(row.metrics?.maxDepth)} | ${number(row.metrics?.modelTokens)} | ${evidence} |`);
  }
  lines.push('', '## Failure and provider telemetry', '', '| Provider | Final category | Invocations |', '| --- | --- | ---: |');
  const failures = new Map();
  for (const row of evaluation.results.filter((result) => result.status !== 'SOLVED')) {
    const key = `${row.method}\t${failure(row)}`;
    failures.set(key, (failures.get(key) ?? 0) + 1);
  }
  if (!failures.size) lines.push('| All | No final failures observed | 0 |');
  for (const [key, count] of [...failures].sort()) {
    const [method, category] = key.split('\t');
    lines.push(`| ${cell(method)} | ${cell(category)} | ${count} |`);
  }
  lines.push('',
    'The per-invocation details preserve compiler attempts, branch restoration records, proposer rounds, actual provider metadata/usage/error records, and final candidate audits. Diagnostic severity matters: a warning or informational audit message is not a mathematical compiler error merely because a broad category string says `compiler_error`.',
    '',
    '## Provenance and limits',
    '',
    `Selection frozen at **${evaluation.selectionFrozenAt}**. Upstream miniF2F commit: \`${evaluation.sourceCommit}\`.`,
    `Local source commit at run start: \`${cell(evaluation.environment.gitCommit)}\`; working tree dirty: \`${cell(evaluation.environment.gitDirty)}\`.`,
    `Node \`${evaluation.environment.node}\`; Lean toolchain \`${evaluation.environment.leanToolchain}\`.`,
    `Execution/input byte checks at completion: **${evaluation.protocolIntegrity?.valid === true ? 'unchanged' : 'not established; this run is not promoted as the canonical comparison'}**.`,
    '',
    '| Frozen input | SHA-256 |',
    '| --- | --- |',
    ...Object.entries(evaluation.inputHashes).map(([filename, hash]) => `| ${cell(filename)} | \`${hash}\` |`),
    '',
    'The run JSON also captures source and runtime artifact hashes. These identify observed bytes; they are not a signed attestation or proof of source-to-binary equivalence. v1 results remain unchanged and are not pooled with this disjoint holdout. Different problems and the v2 validation policy prevent interpreting a v1-to-v2 percentage difference as a controlled improvement measurement.',
    '',
    'This is a small public holdout. “Holdout” means withheld from this project’s v1 run and selected before v2 evaluation; it does not establish absence from any model’s training data. No repeated-sampling confidence claim is made. Wall time is recorded, but CPU time, peak memory, cache warmth, provider-side resource allocation, and dollar cost are not measured. Standard library lemmas are available through the fixed imports; benchmark theorem modules and their proof bodies are never imported.',
    '',
    '## Reproduce',
    '',
    '```sh',
    'node benchmarks/v2/verify-source.mjs --source /path/to/miniF2F-lean4',
    'node benchmarks/v2/run.mjs --provider both --compiler worker',
    'node benchmarks/v2/verify-results.mjs',
    '```',
    '',
    'The Codex CLI must already be authenticated and able to initialize its runtime. The adapter uses its configured model unless an explicit `--model` is supplied. If preflight is blocked, the command records the blocker, runs any available deterministic jobs, and exits with code 2. `--only ID` and single-provider runs write diagnostic reports in their own directories and cannot replace the full-holdout report.',
    '',
  );
  return lines.join('\n');
}
