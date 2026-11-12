"""Start the local webpage without requiring a terminal command from the user."""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def existing_url():
    for port in range(8000, 8011):
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=.25) as response:
                data = json.load(response)
                if data.get("app") == "StoryPulse" and data.get("project_root") == str(ROOT):
                    return f"http://127.0.0.1:{port}"
        except (OSError, ValueError, urllib.error.URLError):
            continue
    return None


def free_port():
    for port in range(8000, 8011):
        with socket.socket() as probe:
            try:
                probe.bind(("127.0.0.1", port))
                return port
            except OSError:
                pass
    raise RuntimeError("Ports 8000–8010 are in use. Close the other local servers and try again.")


def open_when_ready(url):
    for _ in range(90):
        try:
            with urllib.request.urlopen(url + "/health", timeout=1):
                webbrowser.open(url)
                return
        except OSError:
            time.sleep(.5)


def main():
    parser = argparse.ArgumentParser(description="Run the StoryPulse laptop webpage.")
    parser.add_argument("--no-browser", action="store_true", help="Start the server without opening a browser.")
    args = parser.parse_args()
    os.chdir(ROOT)
    current = existing_url()
    if current:
        print(f"StoryPulse is already running: {current}", flush=True)
        if not args.no_browser:
            webbrowser.open(current)
        return
    try:
        import uvicorn
    except ImportError:
        print("Dependencies are missing. Run Setup StoryPulse.cmd once, then start again.")
        sys.exit(1)
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    print("\n  STORYPULSE — LOCAL WRITING STUDIO\n", flush=True)
    print(f"  Open in Chrome or Edge: {url}", flush=True)
    print("  Keep this window open while using the webpage.", flush=True)
    print("  The model loads once at startup. No internet is required.", flush=True)
    print("  Press Ctrl+C here to stop the server.\n", flush=True)
    if not args.no_browser:
        threading.Thread(target=open_when_ready, args=(url,), daemon=True).start()
    uvicorn.run("main:app", host="127.0.0.1", port=port, access_log=False, log_level="info")


if __name__ == "__main__":
    main()
