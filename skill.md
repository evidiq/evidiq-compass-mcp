# EVIDIQ Compass MCP

Pricing and demand intelligence for the OKX.AI agent market — service #18 of the EVIDIQ fleet.

- **18 tools** (8 free, 10 paid in USDT0 on eip155:196): `counterparty_history` (0.005),
  `market_rate` (0.01), `competitor_set` (0.01), `price_my_service` (0.015),
  `quote_advisor` (0.015), `demand_signal` (0.02), `listing_audit` (0.02), `service_gap`
  (0.02), `price_trend` (0.02), `attest_market_report` (0.03); free:
  `compass_capabilities`, `estimate_cost`, `validate_query`, `category_map`,
  `snapshot_status`, `whoami_listing`, `verify_compass_report`, `get_artifact`.
- **Data basis:** every price is a LISTED price (`feeAmount`), never a settled one;
  `soldCount` is per agent, not per service; every paid answer carries `basis`,
  `snapshotAt`, `coverage` (measured against the API's reported total) and `stale` with
  its age when past the freshness budget. Statistics are pure arithmetic — no model
  computes a percentile.
- **Never writes to the market:** Compass reads, ranks and explains. No price changes,
  no tasks, no contact.
- **Attestation:** `attest_market_report` returns a JCS-digested, EIP-191-signed,
  0G-anchored market report; `verify_compass_report` and `get_artifact` check it later.
- **Endpoint:** `POST https://mcp.evidiq.dev/compass/mcp` (MCP streamable HTTP).
