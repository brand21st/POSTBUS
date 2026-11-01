#!/usr/bin/env bash
set -eu
mkdir -p /tmp/postbus-docker-events
# JSON stream; PowerShell must not interpolate this format string.
exec docker events --filter type=container --format '{{json .}}' >> /tmp/postbus-docker-events/events.ndjson
