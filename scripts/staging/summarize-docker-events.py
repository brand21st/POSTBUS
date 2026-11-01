#!/usr/bin/env python3
import json
from collections import Counter

path = "/tmp/postbus-docker-events/events.ndjson"
counts = Counter()
dies = []
with open(path, encoding="utf-8", errors="replace") as handle:
    for line in handle:
        line = line.strip()
        if not line:
            continue
        try:
            event = json.loads(line)
        except json.JSONDecodeError:
            continue
        action = str(event.get("Action") or event.get("status") or "?")
        actor = event.get("Actor") or {}
        attrs = actor.get("Attributes") or {}
        name = attrs.get("name") or actor.get("ID") or "?"
        counts[action.split(":")[0] if action else "?"] += 1
        if action in ("die", "oom", "kill", "restart") or action.startswith("die") or action.startswith("oom"):
            dies.append({"time": event.get("time"), "action": action, "name": name, "exit": attrs.get("exitCode")})
print("actions", dict(counts))
print("die_restart_oom", len(dies))
for row in dies[-20:]:
    print(row)
