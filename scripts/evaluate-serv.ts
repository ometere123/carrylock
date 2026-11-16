import { execFileSync } from "node:child_process";
import { reconcile } from "../src/lib/engine";
import { FIXTURE_VERSION, type Fixture } from "../src/lib/fixtures";
import { extractWithServ, PROMPT_VERSION, SCHEMA_VERSION, SERV_MODEL } from "../src/lib/serv";
import { verifySharedBudget } from "../src/lib/serv-budget";
import type { Event } from "../src/lib/types";
import previous from "../docs/serv-run-2026-11-15T23-28-52Z.json";
import recorded from "../docs/serv-guarded-closure.json";
import recordedEvents from "../docs/serv-guarded-events.json";
import { DATASET_VERSION, evaluationCases, eventKey } from "./serv-cases";

function equalSet(a: string[], b: string[]) {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every(item => right.has(item));
}

type Candidate = Pick<Event, "shiftId" | "equipmentId" | "permitId" | "type" | "status" | "quote"> & Partial<Pick<Event, "confidence" | "followUp">>;

export function score(fixture: Fixture, events: Candidate[], issues: string[], completed: boolean) {
  const review = reconcile(fixture.input, events.map(event => ({
    ...event,
    confidence: event.confidence ?? "HIGH",
    followUp: event.followUp ?? null,
  })), { issues });
  const expected = new Map(fixture.events.map(event => [eventKey(event), event.quote]));
  const grounded = review.events.filter(event => event.evidence.source === "shift");
  const observed = new Set<string>();
  let matched = 0;
  for (const event of grounded) {
    const key = eventKey({ ...event, status: event.status as Event["status"] });
    const quote = expected.get(key);
    if (!quote || observed.has(key) || !(quote.includes(event.quote) || event.quote.includes(quote))) continue;
    observed.add(key);
    matched++;
  }
  const stateKey = ({ equipmentId, permitId, type, state }: Fixture["expected"]["obligations"][number]) =>
    JSON.stringify([equipmentId, permitId, type, state]);
  return {
    scenarioId: fixture.id,
    fixtureVersion: fixture.version,
    complete: completed && !review.findings.some(finding => finding.code === "EVIDENCE_REJECTED"),
    candidates: events.length,
    groundedEvents: grounded.length,
    matchedGroundedEvents: matched,
    expectedEvents: expected.size,
    exactStateMatch: equalSet(review.obligations.map(stateKey), fixture.expected.obligations.map(stateKey)),
    exactFindingMatch: equalSet(review.findings.map(finding => finding.code), fixture.expected.findingCodes),
    expectedVerdict: fixture.expected.verdict,
    actualVerdict: review.verdict,
    verdictAgreement: review.verdict === fixture.expected.verdict,
    unsafeFalseClear: review.verdict === "NO_CONFLICT_FOUND" && fixture.expected.verdict !== "NO_CONFLICT_FOUND",
    falseHold: review.verdict === "HOLD" && fixture.expected.verdict !== "HOLD",
    grounding: grounded.map(({ shiftId, equipmentId, permitId, type, status, quote, evidence }) =>
      ({ shiftId, equipmentId, permitId, type, status, quote, evidence })),
  };
}

function summarize(rows: ReturnType<typeof score>[]) {
  const count = (key: "complete" | "exactStateMatch" | "exactFindingMatch" | "verdictAgreement" | "unsafeFalseClear" | "falseHold") =>
    rows.filter(row => row[key]).length;
  const sum = (key: "matchedGroundedEvents" | "groundedEvents" | "expectedEvents") =>
    rows.reduce((total, row) => total + row[key], 0);
  const ratio = (matched: number, total: number) => total ? matched / total : null;
  return {
    cases: rows.length,
    completeExtractionRate: ratio(count("complete"), rows.length),
    groundedEventPrecision: ratio(sum("matchedGroundedEvents"), sum("groundedEvents")),
    groundedEventRecall: ratio(sum("matchedGroundedEvents"), sum("expectedEvents")),
    exactStateMatches: count("exactStateMatch"),
    exactFindingMatches: count("exactFindingMatch"),
    verdictAgreement: count("verdictAgreement"),
    unsafeFalseClears: count("unsafeFalseClear"),
    falseHolds: count("falseHold"),
  };
}

async function main() {
  const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim().length > 0;
  const base = { sourceCommit, dirty, dataset: DATASET_VERSION, fixtureVersion: FIXTURE_VERSION, promptVersion: PROMPT_VERSION, schemaVersion: SCHEMA_VERSION };
  if (!process.argv.includes("--live")) {
    const fixture = evaluationCases.find(item => item.id === recorded.scenarioId)!;
    const historical = score(fixture, recordedEvents as Candidate[], [], recorded.status === "completed");
    const cases = evaluationCases.map(fixture => score(fixture, fixture.events, [], true));
    console.log(JSON.stringify({
      ...base, mode: "offline",
      deterministic: { ...summarize(cases), extractionSource: "curated_annotations", cases },
      historicalV1: {
        runs: previous.results.length,
        complete: previous.results.filter(row => row.status === "completed").length,
        legacyStrictMatches: previous.results.filter(row => row.matched).length,
        comparison: previous.results.find(row => row.scenarioId === recorded.scenarioId),
      },
      historicalV2: { provider: recorded, measured: historical },
    }, null, 2));
    if (cases.some(row => !row.exactFindingMatch || !row.exactStateMatch || !row.verdictAgreement)) process.exitCode = 1;
    return;
  }

  const key = process.env.SERV_API_KEY?.trim();
  const credits = Number(process.env.SERV_EVAL_VERIFIED_CREDITS_USD);
  const ceiling = Number(process.env.SERV_MAX_SPEND_USD);
  const historicalSpend = Math.max(0.26248, Number(process.env.SERV_BUDGET_USED_USD || 0));
  if (process.env.CI === "1" || process.env.CI === "true" || dirty || !key ||
      !Number.isFinite(credits) || credits <= 0 || !Number.isFinite(ceiling) || !Number.isFinite(historicalSpend) ||
      ceiling <= historicalSpend || ceiling - historicalSpend > credits + 0.000001 ||
      !(await verifySharedBudget())) {
    console.log(JSON.stringify({ ...base, mode: "live", status: "blocked", newProviderAttempts: 0,
      reason: "Live evaluation requires a clean commit, credential, verified credit ceiling and a reachable shared ledger with admissible capacity. CI is excluded." }, null, 2));
    process.exitCode = 2;
    return;
  }

  const selectedId = process.argv.find(arg => arg.startsWith("--case="))?.slice(7);
  const fixtures = selectedId ? evaluationCases.filter(fixture => fixture.id === selectedId) : evaluationCases;
  if (!fixtures.length) throw new Error("Unknown evaluation scenario");
  const rows = [];
  for (const fixture of fixtures) {
    const { events, issues, audit } = await extractWithServ(fixture.input, key);
    rows.push({ ...score(fixture, events, issues, audit.status === "completed"), provider: audit, issues });
    if (!audit.attempted && !audit.cacheHit) break;
  }
  const evaluated = rows.filter(({ provider }) => provider.attempted || provider.cacheHit);
  const latencies = evaluated.flatMap(({ provider }) => provider.latencyMs == null ? [] : [provider.latencyMs]);
  console.log(JSON.stringify({
    ...base, mode: "live", model: SERV_MODEL, requestedCases: fixtures.length,
    newProviderAttempts: rows.filter(({ provider }) => provider.attempted).length,
    cacheHits: rows.filter(({ provider }) => provider.cacheHit).length,
    minimumLatencyMs: latencies.length ? Math.min(...latencies) : null,
    maximumLatencyMs: latencies.length ? Math.max(...latencies) : null,
    summary: summarize(evaluated), cases: rows,
  }, null, 2));
  if (evaluated.length !== fixtures.length || evaluated.some(row => !row.complete || !row.verdictAgreement ||
    !row.exactStateMatch || !row.exactFindingMatch || row.matchedGroundedEvents !== row.expectedEvents ||
    row.matchedGroundedEvents !== row.candidates)) process.exitCode = 1;
}

if (require.main === module) main().catch(() => {
  console.error("The SERV evaluation could not be completed.");
  process.exitCode = 1;
});
