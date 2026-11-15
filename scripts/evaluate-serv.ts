import { reconcile } from "../src/lib/engine";
import { getFixture } from "../src/lib/fixtures";
import { extractWithServ, SERV_MODEL, SERV_URL } from "../src/lib/serv";

const representativeCases = [
  "relief-reinstatement",
  "bypass-omitted",
  "permit-suspended",
  "closure-verified",
  "equipment-alias",
  "prompt-injection",
];

function estimatedCost(inputTokens: number | null | undefined, outputTokens: number | null | undefined) {
  if (inputTokens == null || outputTokens == null) return null;
  return Number(((inputTokens + 6 * outputTokens) / 1_000_000).toFixed(8));
}

async function probe() {
  const timestamp = new Date().toISOString();
  const started = performance.now();
  try {
    const response = await fetch(SERV_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: SERV_MODEL,
        messages: [
          { role: "system", content: "Respond concisely." },
          { role: "user", content: "CARRYLOCK credential connectivity probe." },
        ],
      }),
      signal: AbortSignal.timeout(10_000),
      redirect: "error",
    });
    await response.body?.cancel();
    console.log(JSON.stringify({
      timestamp,
      endpoint: SERV_URL,
      model: SERV_MODEL,
      mode: "unauthenticated_connectivity_probe",
      httpStatus: response.status,
      elapsedMs: Math.round(performance.now() - started),
      requestId: response.headers.get("x-request-id"),
      authenticatedInference: false,
    }, null, 2));
    if (response.status !== 401) process.exitCode = 1;
  } catch {
    console.log(JSON.stringify({
      timestamp,
      endpoint: SERV_URL,
      model: SERV_MODEL,
      mode: "unauthenticated_connectivity_probe",
      httpStatus: null,
      elapsedMs: Math.round(performance.now() - started),
      requestId: null,
      authenticatedInference: false,
      result: "network_failure_or_timeout",
    }, null, 2));
    process.exitCode = 1;
  }
}

async function evaluate() {
  if (process.env.CI === "1" || process.env.CI === "true") {
    console.log(JSON.stringify({ result: "blocked_ci", authenticatedCalls: 0 }, null, 2));
    process.exitCode = 2;
    return;
  }
  const finalDemo = process.argv.includes("--final");
  const selectedCase = process.argv.find((argument) => argument.startsWith("--case="))?.slice(7);
  if (finalDemo && !selectedCase) {
    console.error("A final demo request requires one explicit --case=<scenario-id>.");
    process.exitCode = 2;
    return;
  }
  const selectedCases = selectedCase ? [selectedCase] : representativeCases;
  const apiKey = process.env.SERV_API_KEY?.trim();
  const timestamp = new Date().toISOString();
  if (!apiKey) {
    console.log(JSON.stringify({
      timestamp,
      model: SERV_MODEL,
      result: "blocked_missing_credential",
      authenticatedCalls: 0,
      representativeCases: selectedCases,
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const id of selectedCases) {
    const fixture = getFixture(id);
    if (!fixture) throw new Error("Missing evaluation fixture: " + id);
    const { events, issues, audit } = await extractWithServ(fixture.input, apiKey, { finalDemo });
    const review = reconcile(fixture.input, events, { issues });
    const status = audit.status === "completed" &&
      review.findings.some((finding) => finding.code === "EVIDENCE_REJECTED") ? "partial" : audit.status;
    const obligationMatch = fixture.expected.obligations.every((expected) =>
      review.obligations.some((actual) => actual.equipmentId === expected.equipmentId &&
        actual.permitId === expected.permitId && actual.type === expected.type && actual.state === expected.state)
    );
    const confirmedFindings = new Set(review.findings.map(({ code }) => code));
    const findingMatch = fixture.expected.findingCodes.every((code) => confirmedFindings.has(code));
    const matched = status === "completed" && review.verdict === fixture.expected.verdict && obligationMatch && findingMatch;
    results.push({
      scenarioId: fixture.id,
      fixtureVersion: fixture.version,
      provider: { ...audit, status },
      expectedVerdict: fixture.expected.verdict,
      actualVerdict: review.verdict,
      obligationMatch,
      findingMatch,
      matched,
      modelCandidates: events.length,
      groundedShiftEvents: review.events.filter(({ evidence }) => evidence.source === "shift").length,
      estimatedListCostUsd: audit.cacheHit ? null : estimatedCost(audit.usage?.inputTokens, audit.usage?.outputTokens),
    });
  }
  console.log(JSON.stringify({
    timestamp,
    endpoint: SERV_URL,
    model: SERV_MODEL,
    listCostBasis: {
      url: "https://docs.openserv.ai/serv-reasoning/models",
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 6,
      observedDate: "2026-11-15",
      note: "Estimate from catalog rates and reported tokens. Use reported provider cost where available.",
    },
    authenticatedCalls: results.filter(({ provider }) => provider.attempted).length,
    cachedResults: results.filter(({ provider }) => provider.cacheHit).length,
    completeExtractions: results.filter(({ provider }) => provider.status === "completed").length,
    matchingResults: results.filter(({ matched }) => matched).length,
    results,
  }, null, 2));
  if (results.some(({ matched }) => !matched)) process.exitCode = 1;
}

const run = process.argv.includes("--probe") ? probe : evaluate;
run().catch(() => {
  console.error("The SERV evaluation could not be completed.");
  process.exitCode = 1;
});
