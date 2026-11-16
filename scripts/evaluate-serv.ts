import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { reconcile } from "../src/lib/engine";
import { FIXTURE_VERSION, type Fixture } from "../src/lib/fixtures";
import { extractWithServ, PROMPT_VERSION, REVISED_PROMPT_VERSION, SCHEMA_VERSION, SERV_MODEL, type ServPipeline } from "../src/lib/serv";
import { inspectLocalEvaluationBudget } from "../src/lib/serv-budget";
import { PASSAGE_PROMPT_VERSION, PASSAGE_SCHEMA_VERSION } from "../src/lib/serv-passages";
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
  const identityKey = (event: Pick<Event, "shiftId" | "equipmentId" | "permitId">) => JSON.stringify([event.shiftId, event.equipmentId, event.permitId]);
  return {
    scenarioId: fixture.id,
    fixtureVersion: fixture.version,
    complete: completed && !review.findings.some(finding => finding.code === "EVIDENCE_REJECTED"),
    candidates: events.length,
    rejectedGrounding: review.findings.filter(finding => finding.code === "EVIDENCE_REJECTED").length,
    groundedEvents: grounded.length,
    matchedGroundedEvents: matched,
    expectedEvents: expected.size,
    exactEquipmentPermitMatch: equalSet(grounded.map(identityKey), fixture.events.map(identityKey)),
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
  const count = (key: "complete" | "exactStateMatch" | "exactFindingMatch" | "verdictAgreement" | "unsafeFalseClear" | "falseHold" | "exactEquipmentPermitMatch") =>
    rows.filter(row => row[key]).length;
  const sum = (key: "matchedGroundedEvents" | "groundedEvents" | "expectedEvents") =>
    rows.reduce((total, row) => total + row[key], 0);
  const ratio = (matched: number, total: number) => total ? matched / total : null;
  return {
    cases: rows.length,
    completeExtractionRate: ratio(count("complete"), rows.length),
    groundedEventPrecision: ratio(sum("matchedGroundedEvents"), sum("groundedEvents")),
    groundedEventRecall: ratio(sum("matchedGroundedEvents"), sum("expectedEvents")),
    exactEquipmentPermitMatches: count("exactEquipmentPermitMatch"),
    fullStrictMatches: rows.filter(strictMatch).length,
    exactStateMatches: count("exactStateMatch"),
    exactFindingMatches: count("exactFindingMatch"),
    verdictAgreement: count("verdictAgreement"),
    unsafeFalseClears: count("unsafeFalseClear"),
    falseHolds: count("falseHold"),
  };
}

function strictMatch(row: ReturnType<typeof score>) {
  return row.complete && row.verdictAgreement && row.exactStateMatch && row.exactFindingMatch &&
    row.exactEquipmentPermitMatch && row.matchedGroundedEvents === row.expectedEvents &&
    row.matchedGroundedEvents === row.candidates && row.matchedGroundedEvents === row.groundedEvents;
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
  const pipelineOption = process.argv.find(arg => arg.startsWith("--pipeline="))?.slice(11) ?? "v2";
  if (pipelineOption !== "v2" && pipelineOption !== "v2.1" && pipelineOption !== "v3") throw new Error("Unknown pipeline");
  const pipeline: ServPipeline = pipelineOption;
  const versions = pipeline === "v3" ? { promptVersion: PASSAGE_PROMPT_VERSION, schemaVersion: PASSAGE_SCHEMA_VERSION }
    : pipeline === "v2.1" ? { promptVersion: REVISED_PROMPT_VERSION } : {};
  const blockers = [];
  if (process.env.CI === "1" || process.env.CI === "true") blockers.push("CI cannot make metered requests.");
  if (dirty) blockers.push("Commit the evaluation source before running.");
  if (!key) blockers.push("SERV_API_KEY is unavailable.");
  if (!Number.isFinite(credits) || credits <= 0) blockers.push("No actual console credit allowance was verified.");
  if (!Number.isFinite(ceiling) || ceiling <= 0) blockers.push("Set the explicit local USD ceiling.");
  let ledger;
  if (!blockers.length) {
    try {
      ledger = await inspectLocalEvaluationBudget();
      const spend = ledger.spendMicros / 1_000_000;
      if (ledger.calls < 18 || ledger.spendMicros < 262_480) blockers.push("The local ledger omits previously recorded attempts or spending.");
      if (ledger.regularRemaining < 1) blockers.push("The local regular allowance is exhausted.");
      if (ceiling <= spend || ceiling - spend > credits + 0.000001) blockers.push("The local ceiling exceeds the verified remaining allowance or has no headroom.");
    } catch {
      blockers.push("The locked local ledger is unavailable or shared mode is configured.");
    }
  }
  if (blockers.length || !key) {
    console.log(JSON.stringify({ ...base, ...versions, mode: "live", status: "blocked", newProviderAttempts: 0, blockers }, null, 2));
    process.exitCode = 2;
    return;
  }

  const selectedId = process.argv.find(arg => arg.startsWith("--case="))?.slice(7);
  const fixtures = selectedId ? evaluationCases.filter(fixture => fixture.id === selectedId) : evaluationCases;
  if (!fixtures.length) throw new Error("Unknown evaluation scenario");
  const runId = randomUUID();
  const rows = [];
  for (const fixture of fixtures) {
    const { events, issues, audit } = await extractWithServ(fixture.input, key, { evaluation: { pipeline, runId } });
    rows.push({ ...score(fixture, events, issues, audit.status === "completed"), provider: audit, issues });
    if (!audit.attempted || audit.httpStatus !== 200 || audit.accounting !== "settled") break;
  }
  const evaluated = rows.filter(({ provider }) => provider.attempted && !provider.cacheHit);
  const latencies = evaluated.flatMap(({ provider }) => provider.latencyMs == null ? [] : [provider.latencyMs]).sort((a, b) => a - b);
  const percentile = (p: number) => latencies.length >= 10 ? latencies[Math.ceil(latencies.length * p) - 1] : null;
  const sum = (pick: (row: typeof evaluated[number]) => number | null | undefined) => {
    const values = evaluated.map(pick).filter((value): value is number => value != null);
    return { total: values.length ? values.reduce((a, b) => a + b, 0) : null, reportedFor: values.length };
  };
  console.log(JSON.stringify({
    ...base, ...versions, mode: "live", runId, pipeline, model: SERV_MODEL, requestedCases: fixtures.length,
    httpSuccessRate: evaluated.length ? evaluated.filter(row => row.provider.httpStatus === 200).length / evaluated.length : null,
    latencyP50Ms: percentile(0.5), latencyP95Ms: percentile(0.95),
    inputTokens: sum(row => row.provider.usage?.inputTokens), outputTokens: sum(row => row.provider.usage?.outputTokens),
    estimatedCostUsd: sum(row => {
      const usage = row.provider.usage;
      return usage?.inputTokens != null && usage.outputTokens != null ? (usage.inputTokens + 6 * usage.outputTokens) / 1_000_000 : null;
    }),
    providerReportedCostUsd: sum(row => row.provider.usage?.reportedCostUsd),
    newProviderAttempts: rows.filter(({ provider }) => provider.attempted).length,
    cacheHits: rows.filter(({ provider }) => provider.cacheHit).length,
    minimumLatencyMs: latencies.length ? Math.min(...latencies) : null,
    maximumLatencyMs: latencies.length ? Math.max(...latencies) : null,
    summary: summarize(evaluated), cases: rows,
  }, null, 2));
  const requiredMatches = fixtures.length === 12 ? 11 : fixtures.length;
  if (evaluated.length !== fixtures.length || evaluated.filter(strictMatch).length < requiredMatches ||
      evaluated.some(row => row.unsafeFalseClear || row.provider.accounting !== "settled")) process.exitCode = 1;
}

if (require.main === module) main().catch(() => {
  console.error("The SERV evaluation could not be completed.");
  process.exitCode = 1;
});
