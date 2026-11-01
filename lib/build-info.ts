/**
 * Exact Git commit of the running build, inlined at build time by next.config.ts
 * (Coolify passes SOURCE_COMMIT as a Docker build arg). "unknown" means the build
 * cannot be traced to a commit and must not be treated as a verified release.
 */
export function getBuildInfo() {
  const commit = process.env.NEXT_PUBLIC_BUILD_SHA || "unknown";
  return {
    commit,
    shortCommit: commit === "unknown" ? "unknown" : commit.slice(0, 12),
    builtAt: process.env.NEXT_PUBLIC_BUILD_TIME || null,
  };
}
