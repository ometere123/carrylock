# Release Preview verification

This post-deadline Preview runs exact source commit `6194e38a5ab8fda24fb71850f52488fd856b09c9`. The submitted release remains at `74ae6ec5fb9cd16025e70f5a0384cf44b235294b`. The tag `serv02-submitted-2026-11-15` is protected against updates and deletion.

## Public Preview with admission paused

[Open the isolated Preview](https://carrylock-97trbt8xz-delealufejoel-4184s-projects.vercel.app/app). Vercel reports deployment `dpl_YoWQsgKrVY1vRwRi9C7F3ctXajwb` ready and assigns no production URL. An anonymous browser used this public Preview without a login, share token or bypass header.

The existing Upstash Preview credentials are mapped on Vercel to `SERV_BUDGET_REDIS_URL` and `SERV_BUDGET_REDIS_TOKEN`. The SERV API key is configured as a Preview Secret. The application uses the existing shared key and a safety pause with zero ordinary paid capacity. An authenticated Redis REST read verified the 71 historical attempts, $0.405879 accounted and zero pending reservations. The credit snapshot from the preceding recovery run predates those paid calls. This Preview remains paused until a current OpenServ balance is confirmed.

Chrome verified all four presets, the three-shift guide, keyboard operation, the historical SERV completion, fixture receipt download and mobile widths of 320 and 390 pixels. The ordinary disabled custom review returned REVIEW_REQUIRED and made no provider call. The static scan found zero matches to the actual private values across the tracked files, three public HTML routes and their script responses. [Browser results](browser-preview-closed.json)

## No-spend exhausted-quota check

The real Redis-backed SERV admission code returned `rate_limited` and `REVIEW_REQUIRED` against an isolated key. The test copied the accounting floor of 71 calls and $0.405879, set 76 total slots including 5 reserved, and blocked all provider networking. It made zero provider calls, created zero reservation records, and left the active shared ledger byte-for-byte unchanged. The isolated test key expires after one hour. [Quota evidence](preview-paid-quota-test.json)

## Reproduce

Use the [SERV recovery instructions](SERV-RECOVERY.md#recovery-and-reproduction) and [saved 12-case evaluations](serv-recovery-results.json) for comparable model tests. Set `CARRYLOCK_ORIGIN` to the paused Preview origin, `CARRYLOCK_CHECK_GUIDE=1`, `CARRYLOCK_CHECK_DISABLED_CUSTOM=1` and `CARRYLOCK_BROWSER_ARTIFACTS` to a scratch directory, then run `node scripts/demo-browser.mjs` with Chrome.

The organizer's published rules establish the cutoff. Post-deadline production permission remains unconfirmed, so this verification is scoped to Preview. [Organizer rules](https://www.openserv.ai/hackathon-2)
