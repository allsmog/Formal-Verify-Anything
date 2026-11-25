#!/usr/bin/env python3
"""Measure equivalent completed process/worker solves, sequentially, on Linux or macOS.

Uses only Python's standard library. CPU counters cover the Node child and its
reaped descendants only. Killing Lake and Lean together can omit the Lean
worker's CPU, so these counters are incomplete and not comparable across modes.
Memory is the sampled sum of resident sets across the live process family;
shared pages may be counted more than once. This is a sampled RSS high-water
estimate, not an exact physical-memory peak.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time


def source_hashes(root):
    files = [
        "lean-toolchain", "lakefile.toml", "lake-manifest.json",
        "FormalVerify/Bridge.lean", "FormalVerify/Worker.lean",
        "formal/src/engine.mjs", "formal/src/compiler.mjs", "formal/src/guard.mjs",
        "formal/src/lean-session.mjs", "formal/src/support.mjs",
        "formal/scripts/measure-worker.mjs", "formal/scripts/measure-worker-resources.py",
    ]
    return {name: hashlib.sha256((root / name).read_bytes()).hexdigest() for name in files}


def process_table():
    """Map every visible PID to (parent PID, resident bytes).

    Linux reads /proc. Other systems, including macOS, read one `ps` snapshot,
    which reports resident size in KiB.
    """
    processes = {}
    proc = Path("/proc")
    if proc.is_dir():
        page_size = os.sysconf("SC_PAGE_SIZE")
        for entry in proc.iterdir():
            if not entry.name.isdecimal():
                continue
            try:
                fields = (entry / "stat").read_text().rpartition(")")[2].split()
                processes[int(entry.name)] = (int(fields[1]), int(fields[21]) * page_size)
            except (FileNotFoundError, ProcessLookupError):
                pass
        return processes
    snapshot = subprocess.run(["ps", "-A", "-o", "pid=,ppid=,rss="],
                              capture_output=True, text=True, check=True).stdout
    for line in snapshot.splitlines():
        pid, parent, rss_kib = (int(field) for field in line.split())
        processes[pid] = (parent, rss_kib * 1024)
    return processes


def family_rss(pid):
    """Resolve parent IDs, then aggregate only our still-owned process family.

    Some container kernels do not expose /proc/PID/task/TID/children. Missing
    that optional interface must never be confused with an empty child list.
    """
    processes = process_table()
    by_parent = {}
    for child, (parent, _) in processes.items():
        by_parent.setdefault(parent, []).append(child)
    pending, seen, rss = [pid], set(), 0
    while pending:
        current = pending.pop()
        if current in seen:
            continue
        seen.add(current)
        rss += processes.get(current, (0, 0))[1]
        pending.extend(by_parent.get(current, []))
    return rss, len(seen)


def measure(mode, root, output):
    transcript = output / f"{mode}.stdout.json"
    errors = output / f"{mode}.stderr.txt"
    started = time.monotonic()
    peak, max_processes, samples, timed_out = 0, 0, 0, False
    with transcript.open("w") as stdout, errors.open("w") as stderr:
        process = subprocess.Popen(
            ["node", "formal/scripts/measure-worker.mjs", mode, str(output / mode)],
            cwd=root, stdout=stdout, stderr=stderr, start_new_session=True,
        )
        while True:
            waited, status, usage = os.wait4(process.pid, os.WNOHANG)
            if waited:
                process.returncode = os.waitstatus_to_exitcode(status)
                break
            rss, count = family_rss(process.pid)
            peak, max_processes = max(peak, rss), max(max_processes, count)
            samples += 1
            if time.monotonic() - started > 300 and not timed_out:
                # The leader is unreaped, so its process-group identity is owned.
                timed_out = True
                os.killpg(process.pid, signal.SIGKILL)
            time.sleep(0.02)
    result = {
        "mode": mode, "exitCode": process.returncode, "timedOut": timed_out,
        "wallMs": round((time.monotonic() - started) * 1000),
        "waitedUserCpuMs": round(usage.ru_utime * 1000),
        "waitedSystemCpuMs": round(usage.ru_stime * 1000),
        "cpuMeasurementComplete": False, "cpuComparableAcrossModes": False,
        "cpuMeasurementScope": "wait4 on Node and its reaped descendants; process-group termination can omit Lean worker CPU",
        "sampledPeakFamilyRssBytes": peak if max_processes >= 2 else None,
        "familyMemoryObserved": max_processes >= 2, "samplingIntervalMs": 20,
        "samples": samples, "maxLiveProcesses": max_processes,
    }
    if process.returncode == 0:
        result["solve"] = json.loads(transcript.read_text())
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path, help="new output directory")
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=False)
    root = Path(__file__).resolve().parents[2]
    hashes = source_hashes(root)
    runs = []
    for mode in ("process", "worker"):
        run = measure(mode, root, output)
        runs.append(run)
        (output / "measurement.json").write_text(json.dumps({
            "schemaVersion": 1,
            "method": "sequential complete workflows; incomplete waited-descendant CPU counters; 20ms sampled sum of process-family RSS",
            "osFileCache": "uncontrolled, previously used by setup and tests",
            "sourceSha256": hashes,
            "runs": runs,
        }, indent=2) + "\n")
        print(json.dumps({key: value for key, value in run.items() if key != "solve"}), flush=True)
        if run["exitCode"] != 0:
            raise SystemExit(f"{mode} workflow failed; inspect its retained transcript and proof attempts")
        if not run["familyMemoryObserved"]:
            raise SystemExit("No compiler child process was observed; family memory was not measured")
        if source_hashes(root) != hashes:
            raise SystemExit("Measured source or environment inputs changed during the paired workflow")


if __name__ == "__main__":
    main()
