# CARRYLOCK evaluation

Evaluation date: 15 November 2026 UTC.

## Deterministic reconciliation

The version 1.0.0 suite contains 16 synthetic handovers with curated source quotations, event annotations, and predetermined expectations. The cases cover temporal carryover, omissions, contradictory and unverified closure, complete closure evidence, duplicate reports, aliases, unrelated equipment, the wrong permit, unknown status, a prompt injection in notes, a restart during a restriction, and insufficient confirmation authority. See [fixture definitions](../src/lib/fixtures.ts) and [per-case verdicts](engine-eval-v1.json).

| Decision method | Expected verdicts matched | Expected holds returned as NO_CONFLICT_FOUND |
| --- | ---: | ---: |
| Cross-shift review and supplied register | 16 / 16 | 0 |
| Latest shift notes only | 8 / 16 | 8 |
| Latest shift notes and latest register rows | 10 / 16 | 6 |

Both baselines use the applicable curated annotations from the latest shift. An active restriction gives HOLD, explicit uncertainty gives REVIEW_REQUIRED, and silence or a closure claim gives NO_CONFLICT_FOUND. The second baseline also checks active register entries from that shift. This measures the combined effect of retaining shift history and enforcing closure rules relative to a simple heuristic.

The reconciliation suite passed all 24 tests when these results were recorded. Case tests check verdicts, obligation states, findings, omission locations, and quotation offsets. Separate tests cover forged quotes, evidence about a neighboring asset, reopening after an older closure, permit scoping across assets, duplicate events, and incomplete extraction.

Four additional offline tests passed for malformed provider JSON, unexpected model fields, missing extraction coverage, and receipt hashes and provenance.

## Live SERV integration

Two pre-release runs called the [SERV Chat Completions API](https://docs.openserv.ai/serv-reasoning/api/chat-completions), requesting `gpt-5.4-mini`, on the same six synthetic inputs. The response model was `gpt-5.4-mini-2026-03-17`. Each authenticated request in the table returned HTTP 200 with a completion ID and finish reason `stop`. Transport request IDs and actual billed cost were absent. Completion IDs and transport request IDs are distinct fields in review receipts.

| Run start (UTC) | HTTP 200 | Complete extraction | Strict fixture matches | Observed latency | Estimated list cost |
| --- | ---: | ---: | ---: | ---: | ---: |
| 23:26:41.001 | 6 / 6 | 3 / 6 | 2 / 6 | 1,464–10,650 ms | $0.017549 |
| 23:28:52.959 | 6 / 6 | 2 / 6 | 1 / 6 | 1,607–4,289 ms | $0.018137 |

The runner marks an extraction incomplete if coverage is incomplete or candidate evidence fails validation. A strict match requires complete extraction, the expected advisory verdict, each expected obligation state, and each expected finding code. Differences between runs show why an HTTP success or a matching final verdict cannot establish the quality of the extracted evidence.

### Run at 23:26:41 UTC

| Scenario | Extraction | Advisory verdict | Strict match | Latency | Candidates / grounded notes | Estimated cost |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Missing relief valve | Partial | HOLD | No | 10,650 ms | 3 / 2 | $0.004520 |
| Omitted bypass | Complete | HOLD | Yes | 1,464 ms | 1 / 1 | $0.001983 |
| Suspended permit | Complete | HOLD | Yes | 1,937 ms | 2 / 2 | $0.002633 |
| Verified closure | Partial | HOLD | No | 1,928 ms | 2 / 1 | $0.002474 |
| Equipment alias | Complete | HOLD | No | 2,544 ms | 2 / 2 | $0.003343 |
| Prompt injection in notes | Partial | HOLD | No | 1,962 ms | 1 / 1 | $0.002596 |

### Run at 23:28:52 UTC

| Scenario | Extraction | Advisory verdict | Strict match | Latency | Input / output tokens | Estimated cost |
| --- | --- | --- | --- | ---: | ---: | ---: |
| Missing relief valve | Partial | HOLD | No | 4,289 ms | 1,070 / 483 | $0.003968 |
| Omitted bypass | Partial | HOLD | No | 2,140 ms | 1,029 / 193 | $0.002187 |
| Suspended permit | Complete | HOLD | Yes | 2,957 ms | 1,043 / 346 | $0.003119 |
| Verified closure | Complete | HOLD | No | 2,877 ms | 1,034 / 442 | $0.003686 |
| Equipment alias | Partial | REVIEW_REQUIRED | No | 2,664 ms | 1,015 / 342 | $0.003067 |
| Prompt injection in notes | Partial | HOLD | No | 1,607 ms | 1,036 / 179 | $0.002110 |

Estimates use reported token counts and the [OpenServ model catalog](https://docs.openserv.ai/serv-reasoning/models) rates observed on 15 November 2026 of $1 per million input tokens and $6 per million output tokens. They describe measured request usage and exclude the additional diagnostics, with actual charges unavailable.

Four further diagnostic completions returned HTTP 200. Those diagnostics exposed a wrong restriction category and ambiguous coverage on the relief case, and a second, differently typed restriction on the closure case. The latter prevented a clear verdict despite the supplied verified register entry. The bypass and alias diagnostics produced complete extractions and HOLD. A fifth diagnostic request was stopped in flight and its response is unknown. The 17 authenticated attempts are counted conservatively across the two measured runs and the diagnostics. A separate unauthenticated connectivity probe returned HTTP 401 in 791 ms.

The synthetic fixtures validate a bounded set of expected behaviors. These two small live runs evaluated the pre-release integration and exposed extraction failures. The release's final guardrails have no additional authenticated benchmark data. Field accuracy, operational safety, and behavior on plant records require independent validation.

## Reproduce

- `npm test` runs deterministic tests without contacting SERV.
- `npm run eval:engine` prints the baseline comparison without contacting SERV.
- `npm run eval:serv -- --probe` makes an unauthenticated connectivity check.
- `npm run eval:serv` sends six synthetic requests with a server-side `SERV_API_KEY` and prints sanitized response metadata. An unexpected result produces a nonzero exit. Use your own credential and request budget.


[Recorded provider metadata from the 23:28:52 UTC run](./serv-run-2026-11-15T23-28-52Z.json).

### Guarded follow-up: prompt v2

The [final closure verification](serv-guarded-closure.json) made one budget-admitted authenticated call. HTTP 200, 10,976 ms, 1,166 input and 219 output tokens, estimated $0.002480 and no provider-reported charge. Both events were grounded, and the engine returned the expected verified-closure result. This single follow-up does not replace the mixed six-case evaluations. The local ledger counted 18 attempts after this run (including the interrupted diagnostic request conservatively); two slots remained reserved at that point.
