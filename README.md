<p align="center">
  <img src="./logo.png" alt="EVIDIQ Compass" width="160" />
</p>

<p align="center">
  <h1 align="center">EVIDIQ Compass</h1>
</p>

<p align="center"><strong>Pricing and demand intelligence for the OKX.AI agent market</strong></p>

<p align="center">
  Agent-market price discovery for both sides of the deal: what a service should cost,
  where a listing sits in its category, where demand is thin, and a signed, 0G-anchored
  report a seller can cite in a negotiation. Service #18 of the EVIDIQ fleet.
</p>

<p align="center">
  <a href="https://evidiq.dev">evidiq.dev</a> &middot;
  <a href="https://mcp.evidiq.dev/compass/skill.md">Agent Skill</a> &middot;
  <a href="https://github.com/evidiq/evidiq-compass-mcp">Compass MCP</a>
</p>

<p align="center">
  <a href="https://mcp.evidiq.dev/compass/mcp"><img src="https://img.shields.io/badge/MCP%20Server-Active-3CCF4E?style=flat-square" alt="MCP Server active" /></a>
  <a href="https://www.oklink.com/xlayer"><img src="https://img.shields.io/badge/X%20Layer-USDT0-3CCF4E?style=flat-square" alt="X Layer USDT0" /></a>
  <a href="https://mcp.evidiq.dev/compass/x402"><img src="https://img.shields.io/badge/x402-0.005%E2%80%930.03%20USDT0-2563EB?style=flat-square" alt="x402: 0.005 to 0.03 USDT0" /></a>
  <a href="https://web3.okx.com/onchainos/dev-docs/payments/service-seller-sdk"><img src="https://img.shields.io/badge/Payments-Official%20OKX%20SDK-121212?style=flat-square&logo=okx&logoColor=white" alt="Official OKX Payment SDK" /></a>
  <a href="./LICENSE"><img src="https://img.shields.io/badge/License-MIT-3DA639?style=flat-square" alt="License: MIT" /></a>
</p>

---

**EVIDIQ Compass reads the OKX.AI agent market so agents don't have to guess what to charge.**
It holds a growing snapshot history of the whole marketplace — every agent, every service,
every listed price — and answers placement, distribution, and demand questions from that
history, with every number traceable to a snapshot instead of a model's opinion.

1. **Fresh marketplace index** — a host collector sweeps the OKX.AI agent search API on a
   systemd timer (every 6h), appends append-only snapshots to `/data/snapshots`, and the
   server serves statistics from the latest sweep with freshness and coverage stated.
2. **MCP server** — 18 tools (8 free, 10 paid) that turn that index into decisions:
   `market_rate`, `price_my_service`, `competitor_set`, `quote_advisor`, `demand_signal`,
   `listing_audit`, `service_gap`, `price_trend`, `counterparty_history`,
   `attest_market_report` for money; `compass_capabilities`, `estimate_cost`,
   `validate_query`, `category_map`, `snapshot_status`, `whoami_listing`,
   `verify_compass_report`, `get_artifact` for free.

---

## What it does

- **Snapshot history, not live guesses** — every answer comes from a named sweep with its
  `snapshotAt`; trends are computed across the snapshot history Compass itself collected.
- **Listed-price basis** — `feeAmount` is a listed price, never a settled one; `soldCount`
  is per agent, not per service; both caveats travel with every paid answer.
- **Honest statistics** — percentiles are pure arithmetic (R-7 interpolation) over the
  cleaned price set; no model computes a percentile, no number is invented.
- **Freshness you can see** — coverage is measured against the API's own reported total
  (min 1.0 across all queries), and every answer carries `stale` plus its age past the
  freshness budget.
- **No market writes** — Compass reads, ranks and explains. It never changes a price,
  never contacts a buyer, never publishes a task.
- **Attestation** — `attest_market_report` bundles a report (query, basis, snapshot,
  stats, rows) into a JCS digest signed EIP-191 by the fleet signer and anchored to 0G
  Storage; `verify_compass_report` and `get_artifact` check it later, so a seller can cite
  a report that cannot be fabricated after the fact.

---

## Route to Compass when

Use Compass **when a price needs a basis**: what is the market rate for security services,
where does my listing sit in its category, is this buyer's budget below market, which
categories sell but are under-supplied, or did my price move with the market? Before
accepting a stranger's task, check `counterparty_history`; before a negotiation, carry
`attest_market_report`.

A natural chain: `compass_capabilities` → `validate_query` → `estimate_cost` →
`market_rate` → `price_my_service` → `attest_market_report`.

---

## Proven on-chain

### x402 Payment Settlement (X Layer, chain 196)

| Tool | Amount | Settlement tx | Result |
|------|--------|---------------|--------|
| `counterparty_history` | `0.005 USDT0` | [`0xb2449c66…9afce`](https://www.oklink.com/xlayer/tx/0xb2449c66ad309821c38d6698ef396eb402646275b814d94245004d13def9afce) | `settled` · public trading record of one agent returned by the paid call |

Flow: HTTP 402 challenge → EIP-3009 signature → `transferWithAuthorization` (gasless for
the payer) → tool executes. Reproduce the quote with
`onchainos payment quote https://mcp.evidiq.dev/compass/mcp --method POST --tool counterparty_history`;
without `--tool` the CLI takes its discovery branch and returns the tool catalogue with an
empty `accepts`, which is correct behaviour and not an error.

### 0G Storage Anchoring (0G mainnet, chain 16661)

| Anchor tx | Storage root | Verified |
|-----------|-------------|----------|
| [`0xd6737ccf…b4f4`](https://chainscan.0g.ai/tx/0xd6737ccfbe182a8ced516277a4d5c9df295665670f3123ab555318520d28b4f4) | `0xa5a04eb4…e4af` | report for `FINANCE` (166 services), signer `0x8a3c…ee7D`, `verify_compass_report` → `signatureValid: true` |

---

## OKX.AI Marketplace Registration

| Property | Value |
| :--- | :--- |
| **Agent ID** | `#10407` |
| **Agent Name** | `EVIDIQ Compass` |
| **Listing Status** | `Listed` |
| **Registration Tx** | [`0x214d02e4…b06f1`](https://www.oklink.com/xlayer/tx/0x214d02e49632ca0bf3c53f4576393fe4ff9f4ad3bbe6168c37d3fd73a1cb06f1) |
| **OKX Agent URL** | https://www.okx.ai/agents/10407 |
| **Agent Wallet** | `0x2a8efe3093278bb4bd3b2d9c7b5ba992ca4fc9b0` |
| **Communication Addr** | `0xa4BD09C6b236C06091ceEDC62355C8d8CE7E18D0` |
| **Report Signer** | `0x8a3c7524Aaed081825aC88eC7f4cCECFc583ee7D` (fleet signer, EIP-191) |
| **Services Registered** | 18 Tools (10 Paid: $0.005–$0.03, 8 Free: $0.00) |

---

## Eighteen MCP tools

### Paid market-intelligence tools

| Tool | USDT0 | Purpose |
|------|-------|---------|
| `counterparty_history` | `0.005` | Public trading record of one agent before you take its task: sold, buyers, feedback, security, online, listing status. |
| `market_rate` | `0.01` | Price distribution for a category or keyword: min, p25, median, p75, max, count, mean, provider ratings per band. |
| `competitor_set` | `0.01` | Closest comparable services to a given service, with provider sold counts and ratings. |
| `price_my_service` | `0.015` | Where a listing's price sits as a percentile of its category, nearest competitors above/below, a defensible band. |
| `quote_advisor` | `0.015` | Is a buyer's offered budget above or below market, and what counter-offer does the distribution support. |
| `demand_signal` | `0.02` | Supply listed vs actually sold per category — crowded-and-idle vs thin-and-moving. |
| `listing_audit` | `0.02` | Audit every service of one agent: mispriced, no comparable demand, or duplicating each other. |
| `service_gap` | `0.02` | Categories where demand exists but supply is thin — what to build next, with numbers. |
| `price_trend` | `0.02` | How a category's median and spread moved across Compass's own snapshot history. |
| `attest_market_report` | `0.03` | JCS-digested, EIP-191-signed, 0G-anchored market report a seller can cite in a negotiation. |

### Free preflight and verification tools

| Tool | Purpose |
|------|---------|
| `compass_capabilities` | Catalog: 18 tools, prices, data basis and claim limits. |
| `estimate_cost` | Exact USDT0 price for any paid tool, from the same table the gate charges from. |
| `validate_query` | Resolve a category or keyword against the local index before paying anything. |
| `category_map` | Category taxonomy with service counts per category and the agents behind them. |
| `snapshot_status` | Freshness and coverage of the index: last sweep, counts, staleness, snapshots held. |
| `whoami_listing` | How Compass sees one agent's own listing before the seller pays for advice. |
| `verify_compass_report` | Recompute the JCS digest and EIP-191-verify the signature against the fleet signer. |
| `get_artifact` | Retrieve a stored attested report by digest, signature, signer and 0G anchor. |

---

## Architecture

```mermaid
flowchart TB
    agent["<b>AI agent / dev</b><br/>MCP client"]
    request{"Tool call<br/>free or paid?"}
    agent -->|POST /compass/mcp| request

    free["Free preflight & verification<br/>capabilities · estimate · validate<br/>category_map · snapshot_status<br/>whoami · verify · get_artifact"]
    gate["x402 v2 gate<br/>EIP-3009 exact · pay per report<br/>402 unpaid · settles on X Layer"]
    xlayer[("X Layer<br/>USD₮0 · eip155:196")]
    request -->|free helper| free
    request -->|paid report| gate
    gate -. verify and settle .-> xlayer

    subgraph compass["EVIDIQ Compass trust boundary"]
        direction TB
        index["1. Snapshot history<br/>append-only sweep snapshots<br/>SQLite · mounted volume"]
        stats["2. Statistics<br/>R-7 percentiles · bands · spread<br/>pure arithmetic, no model"]
        compare["3. Placement & comparison<br/>competitor sets · percentiles · bands"]
        demand["4. Demand signals<br/>sold vs supply · gaps · trends"]
        report["5. Attestation<br/>JCS digest · EIP-191 signature"]
        index --> stats
        stats --> compare
        stats --> demand
        stats --> report
    end

    og[("0G Storage<br/>Merkle root · upload tx<br/>chain 16661")]
    free --> index
    gate --> stats
    report -. best effort .-> og
    og -. root + tx .-> response

    collector["Host collector<br/>onchainos CLI (logged-in session)<br/>systemd timer · every 6h"] -. append snapshots .-> index

    response["<b>MCP response</b><br/>distribution + placement + basis<br/>snapshotAt + coverage + stale<br/>anchoring: anchored / failed"]

    classDef client fill:#312e81,stroke:#a78bfa,color:#ffffff,stroke-width:2px;
    classDef payment fill:#052e16,stroke:#4ade80,color:#ffffff,stroke-width:2px;
    classDef core fill:#0f172a,stroke:#38bdf8,color:#ffffff,stroke-width:2px;
    classDef output fill:#4c1d95,stroke:#c4b5fd,color:#ffffff,stroke-width:2px;
    class agent,request client;
    class free,gate,xlayer,og,collector payment;
    class index,stats,compare,demand,report core;
    class response output;
    style compass fill:#0f172a,stroke:#38bdf8,color:#e0f2fe,stroke-width:2px;
```

---

## Verification Log

### Offline test suite

```
npm test (vitest)               → 82 passed / 82 (6 files), tsc clean
  test/collect.test.ts  (15)    → pagination to exhaustion, retries, dedupe, cap, coverage
  test/store.test.ts    ( 6)    → schema, idempotent import, latestAgents, artifacts, pricesPerSweep
  test/stats.test.ts   (17)    → cleanPrices, R-7 percentiles, distribution, bands, spread
  test/compare.test.ts (13)    → competitor sets, placement (strictly-less pct), price bands
  test/report.test.ts  ( 6)    → JCS canonical digest, EIP-191 sign/verify round-trip
  test/server.test.ts  (25)    → all 18 tools through the x402 gate (bypass), usage on bare {},
                                 402/415/HEAD handling, unhandledRejection guards
```

### Live test through the OpenClaw agent (glm-5.2) — **captured under bypass, Phase 1**

The Compass skill was exercised end-to-end by the OpenClaw agent:
the agent read the skill, discovered the MCP server, and called all 18 tools in one run
against `https://mcp.evidiq.dev/compass/mcp`. Full run output in `docs/live-test/compass-livetest-out.json`.
**This capture was taken in Phase 1 with `X402_BYPASS=1`**, which is why the paid tools
answer 200 in the log below: the point of that run was to prove every tool's behaviour,
not the gate. The gate was measured separately once it was switched on — see the Phase 2
block after the log.

```
tools/list                      → 18 tools listed ✓
Free Tools (HTTP 200)
  snapshot_status {}            → 200 ✓ (2 snapshots · 407 agents · 1231 services · coverage 1)
  category_map {}               → 200 ✓ (8 categories, 41700 sold in Software services)
Paid Tools (200 here because this run had the bypass on — see the Phase 2 block below)
  market_rate (FINANCE)         → 200 ✓ (min 0 · p25 0.005 · median 0.09 · p75 0.875 · max 50 · n=166)
  attest_market_report (FINANCE)→ 200 ✓ digest 0x9ae2b95b… · EIP-191 sig · 0G anchored
                                    root 0xa5a04eb4… · tx 0xd6737ccf…
  verify_compass_report         → 200 ✓ signatureValid: true · signer 0x8a3c…ee7D
  get_artifact                  → 200 ✓ full report + signature + signer + anchor retrieved
Public route                    → /compass/health 200 · /compass/skill.md 200 · /compass/mcp 200 ✓
```

![EVIDIQ Compass MCP — live test report](./docs/live-test/report.png)

### Phase 2 — the gate, measured after the bypass was removed

Re-probed from outside once `X402_BYPASS` was deleted from the container environment and
the service redeployed. Every assertion below was observed, not inferred:

```
empty POST (with content-type)                     → 402
POST without content-type                          → 415
HEAD /mcp                                          → 402, no hang
all 10 paid tools, bare {}                         → 402
  counterparty_history market_rate competitor_set price_my_service quote_advisor
  demand_signal listing_audit service_gap price_trend attest_market_report
all 8 free tools, bare {}                          → 200 with content
  compass_capabilities estimate_cost validate_query category_map
  snapshot_status whoami_listing verify_compass_report get_artifact
onchainos payment quote --tool counterparty_history → 0.005 USDT0, hasBalance true
onchainos payment pay                              → settled, tool executed
fleet sweep across all 18 services                 → broken_entries=0
```

---

## Use it from any agent

```bash
# Read the public Skill document
curl -s https://mcp.evidiq.dev/compass/skill.md

# Inspect current x402 pricing discovery
curl -s https://mcp.evidiq.dev/compass/x402

# Connect remote MCP server (OpenClaw)
openclaw mcp add evidiq-compass --transport streamable-http --url https://mcp.evidiq.dev/compass/mcp

# Connect remote MCP server (Claude Code)
claude mcp add --transport http evidiq-compass https://mcp.evidiq.dev/compass/mcp
```

---

## Self-host

```bash
docker build -t evidiq-compass:latest .
docker run -d --env-file .env -p 3019:3019 evidiq-compass:latest
# Endpoint: http://localhost:3019/mcp
# The container reads snapshots from /data/snapshots; the host collector
# (systemd timer) writes them there — see deploy/run.sh for the wired-up version.
```

The collector is **not** part of the container. It runs on the host, because it drives
the `onchainos` CLI against a logged-in OKX session that the container cannot reach.
Both units live in `deploy/`:

```bash
install -m644 deploy/evidiq-compass-collect.{service,timer} /etc/systemd/system/
systemctl daemon-reload && systemctl enable --now evidiq-compass-collect.timer
systemctl start evidiq-compass-collect.service   # seed the index immediately
```

Two consequences that are easy to miss when the service is moved to another host:

- The container alone is not Compass. `/root/evidiq-compass-data/snapshots` is the
  history the answers are computed from — move it too, or the new host serves
  `snapshots: 0, stale: true`. The snapshot files are immutable, so they copy safely
  while the service is running; the SQLite file should *not* be copied, since the
  container rebuilds its index from the snapshots.
- The collector belongs to whichever host currently serves. Enable the timer there and
  disable it on the old host, so one collector writes one history.


---

## License

EVIDIQ owns and licenses its original Compass code under MIT. Third-party dependencies maintain their own open-source licenses in `THIRD_PARTY_NOTICES.md`.
