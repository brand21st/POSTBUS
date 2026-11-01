#!/usr/bin/env python3
"""JSON docker events watcher. Avoids PowerShell brace interpolation."""
import os
import subprocess

os.makedirs("/tmp/postbus-docker-events", exist_ok=True)
fmt = "{{" + "json ." + "}}"
with open("/tmp/postbus-docker-events/events.ndjson", "ab") as out:
    subprocess.run(
        ["docker", "events", "--filter", "type=container", "--format", fmt],
        stdout=out,
        check=False,
    )
