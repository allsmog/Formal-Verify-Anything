// A real subprocess fixture for the persistent transport's failure boundaries.
import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const delay = Number(process.argv[2] ?? 0);
setTimeout(() => emit({ type: 'ready', protocol: 1, leanVersion: '4.24.0' }), delay);
const input = createInterface({ input: process.stdin });
input.on('line', line => {
  const request = JSON.parse(line);
  if (request.source === 'hang') return;
  if (request.source === 'crash') process.exit(7);
  if (request.source === 'malformed') { process.stdout.write('not JSON\n'); return; }
  if (request.source === 'malformed-utf8') { process.stdout.write(Buffer.from([123, 34, 255, 34, 58, 48, 125, 10])); return; }
  if (request.source === 'overflow') { process.stdout.write('x'.repeat(131072)); return; }
  if (request.source === 'stderr') { process.stderr.write('unexpected worker diagnostics\n'); return; }
  if (request.source.startsWith('child:')) {
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    writeFileSync(request.source.slice(6), String(child.pid));
    return;
  }
  const messages = request.source === 'error' ? [{ severity: 'error', data: 'unknown tactic',
    fileName: request.sourceFile, pos: { line: 3, column: 2 }, endPos: { line: 3, column: 9 } }] : [];
  emit({ type: 'result', protocol: 1, id: request.source === 'wrong-id' ? request.id + 1 : request.id,
    exitCode: request.source === 'error' || request.source === 'inconsistent' ? 1 : 0,
    messages, truncated: false, cacheHit: false, importMs: 0, elaborationMs: 0, artifactCount: 0 });
});
