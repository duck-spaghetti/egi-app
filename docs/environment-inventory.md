# Read-only local environment inventory

Use the selected app checkout, independently of the current directory/chat:

```sh
python3 /path/to/selected-app/scripts/environments.py status --workspace /path/to/project_egi --json
```

Without `--json` it prints a compact table. JSON schema1 includes observation time,
explicit workspace root, entries, errors and `read_only:true`. Exit0 means requested
observations succeeded; exit2 means partial observations. An unreadable size is
null, never zero; process access failure yields unverifiable rather than stopped.
Filesystem mtime is labelled modification time, not last use.

Known roots are workspace `.local`, active worktrees' `.local`, EGI temporary
prefixes under /private/tmp and observed PostgreSQL data paths. Allocated bytes are
measured without following symlinks. Identical paths discovered by process and
filesystem records are counted once. This reports per-file allocation, not APFS
shared-block ownership or an exact reconciliation of total disk usage.

Persistent demos and backup sets are preserved. Active run owners are preserved;
absent/changed owners are residue-for-review. Unknown legacy clusters remain
unknown even when their names look temporary. Records do not grant cleanup
permission. No start/stop/restart/delete operation is implemented. The scanner
never uses sudo, reads table contents or emits raw DSNs/commands/capabilities.
Permission errors remain visible; do not escalate to make an incomplete report green.

After a crash, inspect the run's recorded identity and report the candidate for
review. The inventory does not repair it. A3/B1/sync/preview and older backups keep
their existing retention/authority until an explicit scoped decision.
