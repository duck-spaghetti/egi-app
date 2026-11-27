"""Adapt approved Playwright projects to the owning check's exit/prerequisite contract."""
import os
from pathlib import Path
import shutil
import subprocess
import sys


def main(project):
    """Check selected tools before running real tests; do not convert missing tools to pass."""
    root = Path(__file__).resolve().parents[1]
    node = shutil.which('node')
    runner = root / 'node_modules/@playwright/test/cli.js'
    if not node or not runner.exists() or (project == 'pdf' and not all(shutil.which(x) for x in ('pdftotext', 'pdfinfo'))):
        print('Required Node/Playwright or PDF inspection prerequisite unavailable')
        return 2
    probe = subprocess.run([node, '--input-type=module', '-e',
        "import {chromium} from '@playwright/test'; import fs from 'node:fs'; process.exit(fs.existsSync(chromium.executablePath())?0:2)"], cwd=root)
    if probe.returncode:
        print('Required Chromium unavailable; run npx playwright install chromium')
        return 2
    env = dict(os.environ, EGI_CHECK_PYTHON=sys.executable, EGI_BROWSER_PROJECT=project)
    return subprocess.run([node, runner, 'test', '--project='+project], cwd=root, env=env).returncode
