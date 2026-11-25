// Send SIGKILL to a detached child's process group, or to the child on Windows.
// The caller must still hold the unreaped ChildProcess: that handle is what
// proves the group ID has not been reused.
//
// ESRCH means the group is already gone. Darwin also reports EPERM when every
// member has exited but the leader has not been reaped yet, because zombies
// cannot be signaled. Linux reports success in that state. Both mean there is
// nothing left to kill, so neither is a cleanup failure.
export function killOwnedGroup(child) {
  if (process.platform === 'win32') {
    child.kill('SIGKILL');
    return;
  }
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (error) {
    if (error.code === 'ESRCH') return;
    if (error.code === 'EPERM' && process.platform === 'darwin') return;
    throw error;
  }
}
