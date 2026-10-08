const FORBIDDEN = ["hgacoeoovjxkzfbesmvl", "app.indiapost.gov.in", "postbus.in"];

export function assertIsolatedTarget(label, value) {
  const text = String(value ?? "").toLowerCase();
  for (const needle of FORBIDDEN) {
    if (text.includes(needle)) {
      console.error(`STOP: ${label} points at production/forbidden host (${needle}).`);
      process.exit(1);
    }
  }
}

export function printTarget(info) {
  console.log("=== STAGING TARGET ===");
  for (const [key, value] of Object.entries(info)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("======================");
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}` || process.argv[1]?.endsWith("assert-not-production.mjs")) {
  for (const value of process.argv.slice(2)) assertIsolatedTarget("arg", value);
}
