"""One-time Windows setup. Application dependencies stay inside this folder."""
from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT / ".runtime"


def run(command, **kwargs):
    subprocess.run([str(part) for part in command], cwd=ROOT, check=True, **kwargs)


def main():
    RUNTIME.mkdir(exist_ok=True)
    uv = shutil.which("uv")
    if not uv:
        bootstrap = RUNTIME / "bootstrap"
        print("Preparing uv from the official Python package registry…", flush=True)
        run([sys.executable, "-m", "pip", "install", "--target", bootstrap, "uv"])
        candidates = list(bootstrap.glob("uv/uv.exe")) + list(bootstrap.glob("bin/uv.exe"))
        if not candidates:
            raise RuntimeError("uv could not be located after installation. Install uv from astral.sh and retry.")
        uv = str(candidates[0])
    env = dict(os.environ, UV_PYTHON_INSTALL_DIR=str(RUNTIME / "python"))
    python = ROOT / ".venv" / "Scripts" / "python.exe"
    usable = False
    if python.exists():
        check = subprocess.run([str(python), "-c", "import sys; sys.exit(0 if sys.version_info[:2] == (3, 11) else 1)"], capture_output=True)
        usable = check.returncode == 0
    if not usable:
        print("Preparing isolated Python 3.11…", flush=True)
        venv_path = (ROOT / ".venv").resolve()
        if venv_path.parent != ROOT:
            raise RuntimeError("The environment path resolves outside this project. Setup stopped.")
        run([uv, "venv", "--python", "3.11", "--clear", venv_path], env=env)
    locked = ROOT / "requirements-lock.txt"
    requirements = locked if locked.exists() else ROOT / "requirements.txt"
    print("Installing the local model runtime (first setup needs internet)…", flush=True)
    run([uv, "pip", "install", "--python", python, "-r", requirements], env=env)
    print("Verifying the original saved model…", flush=True)
    run([python, "verify_setup.py"], env=env)


if __name__ == "__main__":
    try:
        main()
    except (OSError, subprocess.CalledProcessError, RuntimeError) as exc:
        print(f"\nSetup failed: {exc}", file=sys.stderr)
        sys.exit(1)
