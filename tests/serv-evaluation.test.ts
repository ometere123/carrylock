import assert from "node:assert/strict";
import { test } from "node:test";
import { evaluationCases } from "../scripts/serv-cases";
import { score } from "../scripts/evaluate-serv";

const heldOut = evaluationCases.find(item => item.id === "unseen-alias-restriction")!;
const unsupported = evaluationCases.find(item => item.id === "unseen-unsupported-reinstatement")!;

test("versioned gold annotations support their stated verdicts, exact states and findings", () => {
  for (const fixture of evaluationCases) {
    for (const event of fixture.events) {
      assert.ok(fixture.input.shifts.some(shift => shift.id === event.shiftId && shift.notes.includes(event.quote)), fixture.id);
    }
    const result = score(fixture, fixture.events, [], true);
    assert.equal(result.verdictAgreement, true, fixture.id);
    assert.equal(result.exactStateMatch, true, fixture.id);
    assert.equal(result.exactFindingMatch, true, fixture.id);
    assert.equal(result.matchedGroundedEvents, result.expectedEvents, fixture.id);
  }
});

test("the scorer detects wrong asset, permit, and restriction type despite exact quotes", () => {
  const event = heldOut.events[0];
  for (const changed of [
    { ...event, equipmentId: "SIS-805" },
    { ...event, permitId: "PTW-999" },
    { ...event, type: "RELIEF_BARRIER" as const },
  ]) {
    const result = score(heldOut, [changed], [], true);
    assert.equal(result.matchedGroundedEvents, 0);
    assert.equal(result.exactStateMatch, false);
    assert.equal(result.unsafeFalseClear, false);
  }
});

test("a quoted reinstatement claim without authorized register proof keeps the obligation open", () => {
  const result = score(unsupported, unsupported.events, [], true);
  assert.equal(result.actualVerdict, "HOLD");
  assert.equal(result.exactStateMatch, true);
  assert.equal(result.exactFindingMatch, true);
});
