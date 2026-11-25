// Deliberate protocol fixture. It is not an LLM and establishes no live-provider result.
import { writeFileSync, readFileSync, chmodSync } from 'node:fs';
const [mode, capture, ...args] = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli TEST-FIXTURE'); process.exit(0); }
if (args[0] === 'mcp') { console.log(JSON.stringify([{ name: 'configured.server' }])); process.exit(0); }
const input = readFileSync(0, 'utf8');
writeFileSync(capture, JSON.stringify({ args, input, cwd: process.cwd() }));
if (mode === 'timeout') await new Promise(resolve => setTimeout(resolve, 10000));
if (mode === 'readonly') { process.stderr.write('Read-only file system (os error 30)\n'); process.exit(1); }
const events = [
  { type: 'thread.started', thread_id: 'fixture' },
  { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', phase: 'final', text: mode === 'malformed' ? 'not JSON' : JSON.stringify({ proposals: [{ kind: 'tactic', tactic: 'trivial' }] }) } },
  { type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 5 } },
];
for (const event of events) console.log(JSON.stringify(event));
if (mode === 'cleanup') chmodSync(process.cwd(), 0o500);

