import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile } from "../src/lib/engine";
import { getFixture } from "../src/lib/fixtures";
import { createReceipt, hashInput, type ServAudit } from "../src/lib/receipt";
import { decodeServResult, PROMPT_VERSION, SCHEMA_VERSION, SERV_MODEL } from "../src/lib/serv";

const offlineAudit: ServAudit = {
  status: "not_configured",
  requestedModel: SERV_MODEL,
  returnedModel: null,
  requestId: null,
  completionId: null,
  attempted: false,
  latencyMs: null,
  httpStatus: null,
  finishReason: null,
  usage: null,
  promptVersion: PROMPT_VERSION,
  schemaVersion: SCHEMA_VERSION,
};

test("invalid provider JSON yields no events and an explicit extraction failure", () => {
  const fixture = getFixture("closure-verified")!;
  const extraction = decodeServResult(fixture.input, "{", offlineAudit);
  assert.equal(extraction.audit.status, "invalid_response");
  assert.equal(extraction.audit.attempted, false);
  assert.equal(extraction.audit.completionId, null);
  assert.deepEqual(extraction.events, []);
  assert.ok(extraction.issues.length > 0);
});

test("deterministic review preserves grounded restrictions when other model events fail schema validation", () => {
  const fixture = getFixture("relief-reinstatement")!;
  const [active] = fixture.events;
  const content = JSON.stringify({
    events: [active, { ...active, verdict: "NO_CONFLICT_FOUND" }],
    coverage: fixture.input.shifts.map(({ id }) => ({ shiftId: id, status: "COMPLETE", issue: null })),
  });
  const extraction = decodeServResult(fixture.input, content, offlineAudit);
  assert.equal(extraction.audit.status, "partial");
  assert.deepEqual(extraction.events, [active]);
  assert.ok(extraction.issues.some((issue) => issue.includes("structural validation")));
  assert.equal(reconcile(fixture.input, extraction.events, { issues: extraction.issues }).verdict, "HOLD");
});

test("missing coverage prevents a clear review even when the register has a qualifying closure", () => {
  const fixture = getFixture("closure-verified")!;
  const [first] = fixture.input.shifts;
  const content = JSON.stringify({
    events: fixture.events,
    coverage: [{ shiftId: first.id, status: "COMPLETE", issue: null }],
  });
  const extraction = decodeServResult(fixture.input, content, offlineAudit);
  const review = reconcile(fixture.input, extraction.events, { issues: extraction.issues });
  assert.equal(extraction.audit.status, "partial");
  assert.equal(review.obligations[0]?.state, "CLOSED_VERIFIED");
  assert.equal(review.verdict, "REVIEW_REQUIRED");
  assert.ok(review.missingEvidence.some((issue) => issue.includes("coverage")));
});

test("receipt hashes bind the supplied data and fixture receipts carry fixture provenance", () => {
  const fixture = getFixture("relief-reinstatement")!;
  const { input } = fixture;
  const review = reconcile(input, fixture.events);
  const receipt = createReceipt(input, review, {
    mode: "synthetic_fixture", fixtureId: fixture.id, fixtureVersion: fixture.version,
  }, fixture.events);

  assert.match(receipt.inputHashes.dataset, /^[a-f0-9]{64}$/);
  assert.equal(receipt.inputHashes.dataset, hashInput({
    register: input.register, action: input.action, equipment: input.equipment, shifts: input.shifts,
  }));
  assert.notEqual(receipt.inputHashes.dataset, hashInput({ ...input, shifts: [...input.shifts].reverse() }));
  assert.notEqual(receipt.inputHashes.shifts[0].notesHash, hashInput(input.shifts[0].notes + " "));
  assert.equal(receipt.extraction.mode, "synthetic_fixture");
  assert.equal("serv" in receipt.extraction, false);
  assert.deepEqual(receipt.extractedEvents, review.events);
  assert.equal(receipt.verdict, review.verdict);
});
