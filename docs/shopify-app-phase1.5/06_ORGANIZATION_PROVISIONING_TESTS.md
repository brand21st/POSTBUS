# 06 Organization provisioning tests

**Scope:** RPC + bootstrap lifecycle A–H.

**Classification:** PASS for automated PGlite/unit scenarios. BLOCKED for live install.

| Scenario | Expected | Actual | Result |
|----------|----------|--------|--------|
| A New install | One org + install | PGlite concurrent + shop A | PASS |
| B Repeat bootstrap | Same org, `is_new=false` | Repeat shop A | PASS |
| C Concurrent | One org | Promise.all two RPC calls | PASS |
| D Email match | No merge | Standalone WEB org remains distinct | PASS |
| E Staff OWNER | No `organization_members` insert | Members count 0 after provision | PASS |
| F Shop A vs B | Different orgs | Distinct `org_id` | PASS |
| G Exchange fail | `REAUTH_REQUIRED` / no access token | Mocked exchange 400 | PASS (HTTP); full BFF+DB fail path NOT TESTED end-to-end |
| H Reinstall | Same org, status PENDING | Disconnect then provision | PASS |

Live Shopify install/reinstall: BLOCKED.
