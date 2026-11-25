# Security policy

## Reporting a vulnerability

Report suspected vulnerabilities privately with **Report a vulnerability** on
this repository's Security tab. Do not open a public issue for a security
problem. Include the affected commit, the steps to reproduce, and what you
expected the runner to refuse.

Fixes go to the latest release.

## What counts

In scope: any way to get a proof marked `SOLVED` without a real kernel-checked
proof of the original statement. Examples include changing the theorem
statement, smuggling in `sorry`, `admit`, a new axiom or a trust shortcut past
the final gate, escaping the input guards, or causing the dependency audit to
accept a declaration it should reject. Bugs that make the recorded evidence
disagree with what actually ran are also in scope.

Out of scope: the runner is not an operating-system sandbox. Lean, the pinned
Mathlib artifacts, the observation bridge, and any proposer command you
configure are trusted. Hostile Lean plugins, compromised imports, or a hostile
local proposer command can affect the host, and that is documented behavior.
