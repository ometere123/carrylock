# CARRYLOCK post-submission evidence

The submitted baseline is [74ae6ec](https://github.com/ometere123/carrylock/commit/74ae6ec). The branch adds a guided synthetic walkthrough, makes the authenticated historical result visible on entry, and prepares a separate shared call ceiling for a future review deployment. This report and its accompanying JSON refer to synthetic notes and curated fixtures.

## Evidence and comparison

- [Deterministic engine output](engine-eval-postsubmission.json) covers the unchanged 16 fixtures at version `1.0.0`. The engine matches 16/16 advisory verdicts. The latest-note baseline matches 8/16 and the latest-note-plus-register baseline matches 10/16.
- [Evaluation output](serv-eval-postsubmission.json) records the exact code commit, dataset `carrylock.serv-eval.v2.0.0`, prompt `carrylock.extract.v2` and schema `carrylock_handover_events_v1`. Ten existing cases and two new held-out cases use independently written gold adjudications. Curated annotations match all 12 verdicts, all 12 state sets and all 12 finding-code sets, with zero false clears and zero false holds. Extraction metrics from replaying gold annotations characterize the scoring harness only.
- In the [saved v1 run](serv-run-2026-11-15T23-28-52Z.json), 2/6 extractions completed and 1/6 met the original strict criteria. On the common closure case, v1 returned a false HOLD. The [single saved v2 completion](serv-guarded-closure.json) returned the expected advisory verdict and matched both expected grounded observations. The offline scorer rechecks [the saved v2 quotations](serv-guarded-events.json) against the synthetic notes and records their offsets, exact state and finding match. Its measured latency was 10,976 ms and its usage was 1,166 input and 219 output tokens. Completion identifiers for the six saved v1 requests and the v2 follow-up appear in their respective JSON files.
- There is no paired multi-case v2 result. The v1 records lack raw events for exact rescoring. Earlier wrong-category, alias and incomplete-extraction failures remain known, and v2 behavior on the held-out cases is unmeasured. No new provider requests were made for this branch. The verified local ledger contained 18 historical attempts and an estimated $0.262480 reserved or settled. No shared Redis credentials or available provider balance were verified.

For the new evaluation, a grounded match needs the same shift, equipment, permit, restriction type and status as gold, plus a verbatim quotation overlapping by containment with the gold excerpt. Grounded-event precision uses accepted source events as the denominator. Recall uses annotated events. Schema and grounding rejections also affect completeness, and candidate counts are reported separately. Exact state matches compare the full set of equipment, permit, type and state tuples. Exact finding matches compare the full finding-code set. An unsafe false clear is an advisory `NO_CONFLICT_FOUND` when gold expects a hold or review. A false hold is `HOLD` when gold expects a different verdict. Unadmitted cases are excluded from provider accuracy metrics and appear with a reason.

## Shared Redis and credit reconciliation

For a future authorized live environment, provision a primary HTTPS Redis REST endpoint with write credentials that support `GET`, `SET NX PX`, and `EVAL`. Use a Redis instance without eviction for the ledger. Set `SERV_BUDGET_REDIS_URL` and `SERV_BUDGET_REDIS_TOKEN` as server secrets and keep one stable `SERV_BUDGET_REDIS_KEY` for all callers sharing one credit pool. Replicate the same spend and call ceilings across those callers. Pause usage while migrating and reconcile any additional provider attempts since the audit.

1. Read the existing ledger and provider usage before switching stores. Back up the ledger securely. If no shared ledger exists, seed `SERV_BUDGET_USED_CALLS` to at least 18 and `SERV_BUDGET_USED_USD` to at least 0.262480, raised to reflect any later usage. The ledger uses the larger of stored and configured counts and spend. Never overwrite an existing shared ledger with an older local copy.
2. Keep `SERV_DEV_MAX_CALLS` for standalone local development with a separately funded credential. When Redis is configured, `SERV_SHARED_MAX_CALLS` is the lifetime ceiling for co-funded public previews and evaluation. It defaults to zero and includes historical attempts and five reserved slots. At 18 used, a ceiling of 24 would admit at most one regular call before any other constraints. That is arithmetic only. Choose a ceiling using the verified provider balance. The configured `SERV_MAX_SPEND_USD` must include historical spend and limit additional reservations to the verified available credits. Retain `SERV_LIVE_MAX_PER_HOUR`. Grant reserved access only to an authorized operator using a secret demo token.
3. For a first preview smoke, use a clean checkout, set the verify-on-run balance through `SERV_EVAL_VERIFIED_CREDITS_USD`, and run one selected evaluation case after confirming provider rates and limits. Once the shared store and credit policy are confirmed, set `SERV_LIVE_ENABLED=1` in the authorized environment. A Redis failure, a spent budget, or an incomplete provider response should produce an unavailable or incomplete review rather than a clearance. Check the receipt and ledger usage after the smoke. Cache hits are reported independently. The application cap uses catalog estimates and reservation accounting, so also enforce spending at the provider where available.

## Reproduce

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run eval:engine
npm run eval:serv
```

Run the offline commands from the source commit named in the evidence JSON. Redirect standard output from the underlying scripts to save pure JSON without npm banners. Run `npx tsx scripts/evaluate-engine.ts` and `npx tsx scripts/evaluate-serv.ts` for that purpose. With verified capacity, `npm run eval:serv -- --live --case=closure-verified` requests one case and `npm run eval:serv -- --live` requests the full suite, subject to all admission checks.

For browser reproduction, start the built branch on port 3102 with `SERV_LIVE_ENABLED=0`. Set `CARRYLOCK_ORIGIN=http://127.0.0.1:3102`, `CARRYLOCK_CHECK_GUIDE=1`, `CARRYLOCK_CHECK_DISABLED_CUSTOM=1` and `CARRYLOCK_BROWSER_ARTIFACTS` to a scratch directory. Run `node scripts/demo-browser.mjs` using Chrome. The [browser results](browser-postsubmission.json) record the verified keyboard, scenario, mobile and custom-review checks. The same script validates the downloaded JSON receipt.

[Before screenshot](../evidence/browser/postsubmission-before.png) · [After screenshot](../evidence/browser/postsubmission-after.png)
