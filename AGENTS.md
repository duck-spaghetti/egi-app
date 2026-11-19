# EGI application instructions

Before working in this directory, read and follow the shared workspace
[AGENTS.md](../AGENTS.md) and the documents it conditionally references.
Keep this component in the `project_egi` workspace so these pointers resolve.

This directory contains the implemented read-only Helpinet/transport preview,
using the user-selected FastAPI/Jinja2/Uvicorn subset. Read [README.md](README.md)
for environment, startup, test commands, runtime files and data limits.

Before task execution, read the approved specification/plan and its latest execution
record. Current shared efforts are indexed by the workspace
[tracker guide](../docs/agents/issue-tracker.md); post-handoff work is in
[the P0–P5 plan](../.scratch/post-handoff/plan.md). Local Git uses `main` without a
remote under consolidation D1, with local commits for approved tasks. Approval and
checkpoint boundaries remain those of the selected task.

The original clone at `../../personal_projects/egi-app` remains a reference; its
draft `origin/wip` and remote do not identify this app's branch or delivery target.
The preview reads source evidence, not the canonical public directory. Canonical
editorial integration, old CRUD consumers, production deployment and adoption of
other draft dependencies require their own approved scope.

## Commit attribution

No AI attribution in commits, pull requests or issues (no `Co-Authored-By` trailer for
Claude, Codex or another assistant, no "Generated with …" line); see the workspace
[AGENTS.md](../AGENTS.md#commit-attribution).
