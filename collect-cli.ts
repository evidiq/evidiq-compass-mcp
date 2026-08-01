import { parseArgs, runCollector } from "./lib/compass/collect-cli.js";

const opts = parseArgs(process.argv.slice(2));

try {
  const summary = await runCollector(opts);
  process.stdout.write(JSON.stringify(summary, null, 2) + "\n");
} catch (err) {
  process.stderr.write(`collect failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
