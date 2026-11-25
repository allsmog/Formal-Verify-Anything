import { spawn } from 'node:child_process';
import { OutputExcerpt } from './support.mjs';
import { killOwnedGroup } from './process-group.mjs';

export const FINAL_VALIDATION_POLICY = 'lean-kernel-v2-unused-variable-lint';

// Match the complete pinned Lean linter diagnostic. Warnings outside this
// specific shape remain disqualifying; substrings never authorize admission.
const unusedVariableWarning = /^unused variable `[^`\r\n]+`\n\nNote: This linter can be disabled with `set_option linter\.unusedVariables false`$/u;

export function warningDisposition(diagnostic) {
  if (diagnostic?.severity !== 'warning') return null;
  return unusedVariableWarning.test(diagnostic.message)
    ? 'benign_unused_variable' : 'rejected_warning';
}

export async function runProcess(command, args, { cwd, timeoutMs = 10000, maxOutputBytes = 1048576, input } = {}) {
  const start = performance.now();
  const stdout = new OutputExcerpt(maxOutputBytes);
  const stderr = new OutputExcerpt(maxOutputBytes);
  return new Promise(resolve => {
    let timedOut = false;
    let launchError = null;
    const child = spawn(command, args, { cwd, shell: false, detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => {
      timedOut = true;
      try { killOwnedGroup(child); } catch (error) { launchError = error.message; }
    }, timeoutMs);
    child.stdout.on('data', chunk => stdout.append(chunk));
    child.stderr.on('data', chunk => stderr.append(chunk));
    child.on('error', error => { launchError = error.message; });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, timedOut, launchError, stdout: stdout.text, stderr: stderr.text,
        truncated: stdout.truncated || stderr.truncated, elapsedMs: Math.round(performance.now() - start) });
    });
  });
}

export function classifyMessage(message) {
  if (/FVA_PROBE_STOP:/.test(message)) return 'probe_stop';
  if (/FVA_AUDIT_REJECTED/.test(message)) return 'axiom_audit';
  if (/maximum.*heartbeat|deterministic timeout|maxRecDepth|maximum recursion/i.test(message)) return 'heartbeat_limit';
  if (/unknown tactic|unexpected token|unknown identifier|unknown constant/i.test(message)) return 'unknown_tactic_or_identifier';
  if (/unsolved goals/i.test(message)) return 'unsolved_goals';
  if (/type mismatch|application type mismatch/i.test(message)) return 'type_mismatch';
  if (/assumption.*failed|no applicable|failed to synthesize/i.test(message)) return 'missing_hypothesis_or_instance';
  if (/object file|unknown module|no such file|unknown package/i.test(message)) return 'environment';
  return 'compiler_error';
}

export function parseLeanOutput(stdout) {
  const diagnostics = [], states = [], closed = [], audits = [], unparsed = [];
  for (const line of stdout.split('\n').filter(x => x.trim())) {
    let item;
    try { item = JSON.parse(line); } catch { unparsed.push(line); continue; }
    if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.data !== 'string' ||
        !['error', 'warning', 'information'].includes(item.severity)) {
      unparsed.push(line); continue;
    }
    const diagnostic = { severity: item.severity, message: item.data, file: item.fileName ?? null,
      start: item.pos ?? null, end: item.endPos ?? null, category: classifyMessage(item.data) };
    diagnostics.push(diagnostic);
    for (const [prefix, destination] of [['FVA_STATE:', states], ['FVA_CLOSED:', closed], ['FVA_AUDIT:', audits]]) {
      if (item.severity === 'information' && item.data.startsWith(prefix)) {
        try {
          const payload = JSON.parse(item.data.slice(prefix.length));
          const object = payload && typeof payload === 'object' && !Array.isArray(payload);
          const node = object && typeof payload.node_id === 'string';
          const valid = prefix === 'FVA_AUDIT:'
            ? object && typeof payload.declaration === 'string' && Array.isArray(payload.axioms) && payload.axioms.every(x => typeof x === 'string')
            : prefix === 'FVA_CLOSED:' ? node
            : node && Array.isArray(payload.goals) && payload.goals.every(g => g && typeof g.target === 'string' &&
                typeof g.targetHead === 'string' && Array.isArray(g.hypotheses) &&
                g.hypotheses.every(h => h && typeof h.name === 'string' && typeof h.type === 'string'));
          if (!valid) throw new Error('Invalid bridge payload');
          destination.push(payload);
        }
        catch { unparsed.push(item.data); }
      }
    }
  }
  return { diagnostics, states, closed, audits, unparsed };
}

export async function compileLean(projectRoot, sourceFile, options = {}) {
  const raw = await runProcess(options.lake ?? 'lake', ['env', 'lean', '--json', '-j1', '-M2048', sourceFile], {
    cwd: projectRoot, timeoutMs: options.timeoutMs, maxOutputBytes: options.maxOutputBytes,
  });
  return { ...raw, ...parseLeanOutput(raw.stdout) };
}

export function observationFor(result, targetNodeId, generatedNodeIds) {
  if (result.timedOut || result.launchError || result.truncated || result.unparsed.length || result.stderr.trim())
    return { valid: false, failure: result.timedOut ? 'timeout' : result.launchError ? 'environment' : 'invalid_compiler_output' };
  // Every error must be one of our exact generated sentinels. A message that
  // merely contains the sentinel (or a state printed before an error) is not evidence.
  const errors = result.diagnostics.filter(x => x.severity === 'error');
  const unexpected = errors.filter(x => !generatedNodeIds.some(id => x.message === `FVA_PROBE_STOP:${id}`));
  if (unexpected.length) return { valid: false, failure: unexpected[0].category };
  const matching = result.states.filter(x => x.node_id === targetNodeId);
  if (result.exitCode !== 1 || matching.length !== 1 ||
      !errors.some(x => x.message === `FVA_PROBE_STOP:${targetNodeId}`) || !Array.isArray(matching[0].goals))
    return { valid: false, failure: 'invalid_observation' };
  return { valid: true, goals: matching[0].goals };
}

/** Kernel validity, transport completeness, and conservative warning policy. */
export function assessFinal(result, theoremName) {
  const audit = result.audits.filter(x => x.version === 1 && x.declaration === theoremName && x.kind === 'theorem' && x.kernel_checked === true && x.passed === true);
  const allowed = new Set(['propext', 'Classical.choice', 'Quot.sound']);
  const warnings = result.diagnostics.filter(x => x.severity === 'warning');
  const permittedWarnings = warnings.filter(x => warningDisposition(x) === 'benign_unused_variable');
  const rejectedWarnings = warnings.filter(x => warningDisposition(x) !== 'benign_unused_variable');
  const errors = result.diagnostics.filter(x => x.severity === 'error');
  const details = { policy: FINAL_VALIDATION_POLICY, permittedWarnings, rejectedWarnings };
  const refused = reason => ({ accepted: false, reason, audit: null, ...details });
  if (result.timedOut) return refused('timeout');
  if (result.launchError) return refused(result.failureCode ?? 'environment');
  if (result.truncated || result.unparsed.length || result.stderr.trim()) return refused('invalid_compiler_output');
  if (errors.length) return refused(errors[0].category ?? 'compiler_error');
  if (result.exitCode !== 0) return refused('compiler_exit');
  if (rejectedWarnings.length) return refused('rejected_warning');
  if (audit.length !== 1 || !Array.isArray(audit[0].axioms) || !audit[0].axioms.every(x => allowed.has(x)))
    return refused('axiom_audit');
  return { accepted: true, reason: null, audit: audit[0], ...details };
}

/** Backwards-compatible Boolean projection for CLI/recheck consumers. */
export const finalAcceptance = (result, theoremName) => assessFinal(result, theoremName).accepted;
