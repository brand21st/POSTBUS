#!/usr/bin/env bash
# Hold WSL open so Windows idle-timeout cannot power off the VM.
while true; do
  date -Is >> /tmp/postbus-wsl-keepalive.log
  sleep 20
done
