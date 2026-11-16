# SERV reliability recovery

This work is on the post-deadline PR. The immutable submission reference is [serv02-submitted-2026-11-15](https://github.com/ometere123/carrylock/tree/serv02-submitted-2026-11-15), at `74ae6ec5fb9cd16025e70f5a0384cf44b235294b`. The Edition 02 rules specify the November 15 cutoff and contain no explicit post-deadline deployment permission. [Organizer rules](https://www.openserv.ai/hackathon-2)

## Historical failure analysis

HTTP 200 establishes that the provider returned a response. The first v1 run has only the recorded aggregate table. The second preserves per-case counts and completion IDs. Neither preserves the full rejected payloads or coverage entries. The table distinguishes observed outcomes from diagnoses that would require those artifacts. [Historical results](EVALUATION.md) · [Saved v1 completion metadata](serv-run-2026-11-15T23-28-52Z.json)

| Historical run | Failed case | What the evidence establishes |
| --- | --- | --- |
| v1, 23:26:41 | Relief valve omitted | Two of three decoded candidates grounded. An event was rejected or deduplicated, or coverage was incomplete. The archived summary cannot distinguish which. A separate diagnostic reproduced incorrect restriction classification and ambiguous coverage. |
| v1, 23:26:41 | Verified closure | Only one of two candidates grounded and the verdict was HOLD. Missing grounded extraction contributed to an incorrect closure outcome. Identifier, quote and coverage causes are unresolved. |
| v1, 23:26:41 | Equipment alias | Two candidates grounded and extraction was marked complete, but the legacy state or finding comparison failed. The archived summary cannot separate wrong canonical identity, permit, classification or state. |
| v1, 23:26:41 | Prompt injection | The reported event grounded, but the result was partial. Coverage and structural rejection counts were not saved. |
| v1, 23:28:52 | Relief valve omitted | Both decoded candidates grounded and the expected state and finding matched. Partial extraction points to reported coverage or discarded malformed candidates. The saved output cannot distinguish them. |
| v1, 23:28:52 | Bypass omitted | Zero of one decoded candidates grounded and the expected omission finding was missing. The rejected candidate and passage were not saved, so quote, identity and classification cannot be separated. |
| v1, 23:28:52 | Verified closure | Both candidates grounded and the legacy expected-state/finding subset checks passed, yet HOLD remained. The subset checks could miss extra restrictions. A later diagnostic reproduced a conflicting extra restriction type. The exact trigger in this completion remains unresolved. |
| v1, 23:28:52 | Equipment alias | Zero of one decoded candidates grounded. The expected state was missing and the verdict was REVIEW_REQUIRED. An alias or quotation mismatch is plausible but the provider output is unavailable. |
| v1, 23:28:52 | Prompt injection | The decoded candidate grounded and the expected state and finding matched. The partial cause could be coverage, discarded malformed events or grounding diagnostics. The archive lacks the disambiguating evidence. |
| Diagnostic | Interrupted request | The fifth diagnostic was stopped in flight. Its charge and completion outcome were unconfirmed, so the attempt remained counted. |

No measured historical v1 row established a transport outage or a defect in deterministic reconciliation. Curated runs check the rules separately and cannot reveal which observations the provider emitted. The genuine single [v2 closure completion](serv-guarded-closure.json) supplied both observations and returned the expected advisory after register validation.

## Recovery and reproduction

The local runner uses the existing locked file ledger. It refuses live runs in CI or on a dirty checkout, checks the 18-attempt and $0.262480 historical floor, and requires an explicit USD ceiling constrained by a verified OpenServ credit allowance. For stacked reservations and deltas, consult the actual ledger after each run. Keep the existing path. Concurrent callers sharing one provider balance require the existing shared budget design.

The console supplied by the operator showed $0.94 in credits, 18 requests and $0.06 billed. The local accounting record was preserved at 18 attempts and $0.262480 estimated or reserved. The local testing session sets a $0.50 additional maximum and a $0.762480 absolute accounting ceiling. The initial ceiling of 60 lifetime attempts allows one smoke and up to three 12-case runs plus the five existing reserved slots. The session initially used an hourly ceiling of 40. After the first comparison it authorized only the remaining targeted calls, two full revision runs and a local browser smoke, using ceilings of 76 lifetime and 57 hourly attempts. The USD ceiling stayed fixed. These overrides apply only to evaluation processes.

From a committed checkout with the existing local credential and ledger, set the ceilings from the verified balance before running:

```powershell
$env:SERV_EVAL_VERIFIED_CREDITS_USD='0.50'
$env:SERV_MAX_SPEND_USD='0.762480'
$env:SERV_DEV_MAX_CALLS='60'
$env:SERV_LIVE_MAX_PER_HOUR='40'
npm run eval:serv -- --live --pipeline=v2 --case=closure-verified
npm run eval:serv -- --live --pipeline=v2
npm run eval:serv -- --live --pipeline=v3
```

Save the JSON emitted by each run, even if its strict threshold fails. Each invocation generates a new run ID for fresh provider attempts, and the scorer counts no cache hits. The run stops on transport errors, unconfirmed settlement or budget rejection. Provider cost is recorded separately from the catalog estimate. The catalog prices are $1 per million input tokens and $6 per million output tokens for the model used. [Model pricing](https://docs.openserv.ai/serv-reasoning/models)

v3 is evaluation-only. It sends numbered passages, validates coverage and canonical references, and recovers original text on the server. Its conservative text checks reject unsupported or ambiguous classifications. Missing coverage introduces an issue that prevents an unsupported clear. Deterministic register verification remains the only path for accepting closure. These lexical checks do not establish correctness for unrestricted prose or unseen plant terminology.

A settlement failure leaves the original accounting reservation intact and returns a partial or unavailable result with an unconfirmed accounting flag. The duplicate fence remains after the in-flight timer expires. Resolve an expired unresolved reservation by reconciling the provider and store before allowing a retry. Keep the original charge reservation when the provider outcome cannot be confirmed.

Production requires the verified Redis resource to be connected, explicit usage ceilings, safe provider admission, and a fresh ordinary-user smoke. See the [shared-store configuration](POSTSUBMISSION.md#shared-redis-and-credit-reconciliation). Release also requires organizer permission and a passing live benchmark.


## Measured recovery

| Fresh 12-case suite | Strict | HTTP success | Complete | Grounded precision / recall | Exact identity / state / findings / verdict (of 12) | Unsafe clears / false holds | P50 / P95 ms | Input / output tokens | Catalog estimate |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| v2 full run | 10/12 | 100.0% | 83.3% | 100.0% / 86.4% | 10 / 10 / 10 / 12 | 0 / 0 | 1921 / 3077 | 13985 / 3189 | $0.033119 |
| v3 full run | 6/12 | 100.0% | 50.0% | 100.0% / 77.3% | 7 / 10 / 6 / 10 | 0 / 0 | 1814 / 7493 | 11573 / 2814 | $0.028457 |
| v2.2 full run 1 | 12/12 | 100.0% | 100.0% | 100.0% / 100.0% | 12 / 12 / 12 / 12 | 0 / 0 | 1922 / 2391 | 13229 / 3161 | $0.032195 |
| v2.2 full run 2 | 12/12 | 100.0% | 100.0% | 100.0% / 100.0% | 12 / 12 / 12 / 12 | 0 / 0 | 2088 / 3102 | 13229 / 3530 | $0.034409 |

The four suites, targeted tests and local browser smoke produced 53 authenticated HTTP 200 completions with distinct IDs and an estimated $0.143399. The duplicate browser request returned the same cached completion and made zero provider calls. No response supplied billed cost. The locked ledger ended at 71 attempts, $0.405879 accounted, and zero unresolved reservations. [Per-case JSON, completion IDs and browser receipt](serv-recovery-results.json)

Current v2 missed a suspended permit after both returned quote values contained literal wrapper marks. The other miss omitted an explicitly unknown isolation and marked the shift partial. v3 rejected broader lines with multiple equipment mentions and additional clauses, and its coverage checks flagged incomplete or unsupported classification in six cases. It produced the lower strict score, even though all of its accepted grounded events matched the gold annotations.

The narrow revisions were based on the two failed development cases. v2.1 passed the permit retest and recovered the expected isolation event, but also emitted an unsupported event from metadata. The targeted v2.2 isolation result still had a rejected extra event and remained REVIEW_REQUIRED. The same unchanged v2.2 prompt passed both full, fresh suites, including the held-out cases. The distribution therefore still includes a known targeted failure. The web route selects the measured v2.2 prompt. The v3 candidate remains available for evaluation.

The ordinary localhost custom review showed both exact excerpts and downloaded the matching receipt at 390 px. Its advisory was NO_CONFLICT_FOUND and its settled completion took 2550 ms. The exact app source was `310979e6566f9013ad2cf81983123af216d884b2`. The submitted production health endpoint reported budgetReady=false. No public smoke is recorded.

The final candidate passed npm ci, lint, typecheck, 44 offline tests, production build and engine evaluation. Chrome exercised the four presets, keyboard flow, mobile widths of 320 and 390 pixels, and fixture JSON receipt download. Fault-injection tests covered Redis reservation/settlement failures, duplicate fencing, concurrent admission, caching, insufficient budget, provider timeout and malformed response. The runtime dependency audit reported zero advisories. [Browser checks](browser-serv-recovery.json)

## Verified free Redis storage

Vercel provisioned `carrylock-serv-ledger` on Upstash Free with automatic upgrades and eviction disabled. The connection targets Preview only. A local parity check against the actual Redis REST endpoint exercised the application’s GET, SET NX PX, and EVAL transaction path. It verified concurrent duplicate fencing, settlement, cache reuse, per-client throttling and the overall ceiling. It called SERV zero times. The isolated test key was set to expire. [Redis verification](redis-serv-recovery.json)

The prospective shared ledger contains the historical and new total of 71 attempts and $0.405879 accounted, with zero outstanding reservations. The seed operation admitted no provider call. Before an authorized production launch, reconcile any newer usage, confirm the remaining credit in the console, connect the verified store privately to production, set its URL, write token, key, explicit shared call/spend limits and hourly limit, and verify one ordinary-user paid review. The submitted production alias is still on deployment `dpl_Hu6XEcHEzBZodG6iPoUMCA9M6jrW`.
