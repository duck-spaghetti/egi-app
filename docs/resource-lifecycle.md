# Owned development resources

`devchecks.resources` is standalone standard-library developer tooling. App owns
it; database imports only an explicitly selected checkout whose bytes match its
pinned Git revision. No application runtime imports or package installation.

`ResourceRun` allocates private metadata before child acquisition, propagates an
unprinted capability to its children, and reconciles only its own child records.
`OwnedCluster` checks free space, records allocation, initializes a socket-only
PostgreSQL cluster and rolls back partial setup. Closing verifies process birth,
UID, canonical data path and directory inode, then confirms server shutdown before
removing its directory. Contradictory identities or failed shutdown preserve files
and return failure; historical records never grant cleanup authority.

Disk preflight measures the selected temporary-root filesystem. Below15 GiB blocks
native startup;15–below30 GiB proceeds with a warning;30 GiB or more proceeds
normally. This is a point-in-time observation, not a disk reservation. There is no
weaker CI threshold or automatic deletion of old resources.

Normal/error/catchable-interruption exits reconcile the run. Runner timeout kills
the command process group and separately reconciles its PostgreSQL daemons. SIGKILL
or power loss can leave metadata/resources for later read-only inspection; they
are not automatically adopted or deleted. Never remove live database files.

Resource verification uses the actual temporary-server boundary:

```sh
python -m unittest discover -s tests -p test_resource_policy.py
python -m unittest discover -s tests -p test_resource_lifecycle_native.py
```

Use the configured PostgreSQL18 runtime and the selected project Python. These
checks create/remove only their own synthetic fixtures. Existing demo databases,
source evidence and backups are preserved.
