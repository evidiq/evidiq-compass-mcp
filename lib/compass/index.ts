import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Snapshot } from "./collect.js";
import { importSnapshot, LatestAgentRow, latestAgents, latestSnapshot, listSnapshots, openStore } from "./store.js";

export interface MarketSnapshotState {
  lastSweepAt: string | null;
  lastSweepId: string | null;
  snapshots: number;
  agents: number;
  services: number;
  minCoverage: number | null;
  stale: boolean;
  ageSeconds: number | null;
  truncatedQueries: number;
}

export class CompassIndex {
  private db: Database.Database;

  constructor(
    dbPath: string,
    private snapshotsDir: string,
    private freshnessBudgetSeconds: number = 6 * 3600 + 3600,
  ) {
    this.db = openStore(dbPath);
  }

  close(): void {
    this.db.close();
  }

  async ingest(): Promise<void> {
    const files = await readdir(this.snapshotsDir).catch(() => []);
    const existing = new Set(listSnapshots(this.db).map((s) => s.sweepId));
    const snapshots: Snapshot[] = [];
    for (const f of files.filter((f) => f.endsWith(".json") && !f.endsWith(".tmp"))) {
      try {
        const raw = await readFile(join(this.snapshotsDir, f), "utf8");
        const snap = JSON.parse(raw) as Snapshot;
        if (snap.sweepId && !existing.has(snap.sweepId)) {
          snapshots.push(snap);
          existing.add(snap.sweepId);
        }
      } catch {
        continue;
      }
    }
    snapshots.sort((a, b) => a.startedAt.localeCompare(b.startedAt));
    for (const snap of snapshots) {
      importSnapshot(this.db, snap);
    }
  }

  state(): MarketSnapshotState {
    const latest = latestSnapshot(this.db);
    const truncated = this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM sweep_queries WHERE sweep_id = ? AND truncated = 1`,
      )
      .get(latest?.sweepId ?? "") as { n: number };
    let ageSeconds: number | null = null;
    if (latest) {
      ageSeconds = Math.max(0, (Date.now() - Date.parse(latest.finishedAt)) / 1000);
    }
    const all = listSnapshots(this.db);
    return {
      lastSweepAt: latest?.startedAt ?? null,
      lastSweepId: latest?.sweepId ?? null,
      snapshots: all.length,
      agents: latest?.nAgents ?? 0,
      services: latest?.nServices ?? 0,
      minCoverage: latest?.minCoverage ?? null,
      stale: latest ? ageSeconds! > this.freshnessBudgetSeconds : true,
      ageSeconds,
      truncatedQueries: truncated.n,
    };
  }

  agents(): LatestAgentRow[] {
    return latestAgents(this.db);
  }

  dbHandle(): Database.Database {
    return this.db;
  }
}
