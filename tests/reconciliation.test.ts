import assert from "node:assert/strict";
import { test } from "node:test";
import { reconcile } from "../src/lib/engine";
import { DEMO_FIXTURES, FIXTURES, getFixture } from "../src/lib/fixtures";
import type { Event, ReviewInput } from "../src/lib/types";

test("the evaluation suite is versioned and includes exactly four selectable demos", () => {
  assert.ok(FIXTURES.length >= 12);
  assert.equal(new Set(FIXTURES.map((fixture) => fixture.id)).size, FIXTURES.length);
  assert.ok(FIXTURES.every((fixture) => /^\d+\.\d+\.\d+$/.test(fixture.version)));
  assert.deepEqual(DEMO_FIXTURES.map((fixture) => fixture.demoLabel), ["A", "B", "C", "D"]);
});

for (const fixture of FIXTURES) {
  test(fixture.id + " meets the predetermined verdict and evidence expectations", () => {
    const actual = reconcile(fixture.input, fixture.events);
    assert.equal(actual.verdict, fixture.expected.verdict);

    const obligationKeys = actual.obligations.map(({ equipmentId, permitId, type, state }) =>
      JSON.stringify([equipmentId, permitId, type, state]),
    );
    const expectedKeys = fixture.expected.obligations.map(({ equipmentId, permitId, type, state }) =>
      JSON.stringify([equipmentId, permitId, type, state]),
    );
    assert.deepEqual(obligationKeys.sort(), expectedKeys.sort());

    for (const code of fixture.expected.findingCodes) {
      assert.ok(actual.findings.some((finding) => finding.code === code), "Missing finding " + code);
    }
    assert.deepEqual(
      actual.timeline.filter((step) => step.obligations.some((item) => item.omitted)).map((step) => step.shiftId),
      fixture.expected.omittedShiftIds,
    );
    for (const original of fixture.events) {
      const source = fixture.input.shifts.find((shift) => shift.id === original.shiftId);
      assert.ok(source?.notes.includes(original.quote), "Fixture quote must be present in the declared source");
      const verified = actual.events.find((item) => item.shiftId === original.shiftId && item.quote === original.quote);
      assert.ok(verified && source, "Engine rejected expected evidence " + original.quote);
      const { source: sourceKind, sourceId, start, end, line } = verified.evidence;
      assert.equal(sourceKind, "shift");
      assert.equal(sourceId, source.id);
      assert.equal(source.notes.slice(start, end), original.quote);
      assert.equal(line, source.notes.slice(0, start).split("\n").length);
    }
    for (const verified of actual.events.filter((item) => item.evidence.source === "register")) {
      const record = fixture.input.register.find((item) => item.id === verified.evidence.sourceId);
      assert.ok(record, "Register evidence must reference a supplied row");
      assert.equal(JSON.stringify(record).slice(verified.evidence.start, verified.evidence.end), verified.quote);
    }
  });
}

test("loss is localized at the third handover and preserves both preceding mentions", () => {
  const scenario = getFixture("relief-reinstatement")!;
  const review = reconcile(scenario.input, scenario.events);
  const omission = review.findings.find((finding) => finding.code === "OMITTED_FROM_HANDOVER");
  assert.equal(omission?.shiftId, "s3");
  assert.equal(review.obligations[0]?.firstShiftId, "s1");
  assert.equal(review.obligations[0]?.lastMentionShiftId, "s2");
  assert.deepEqual(
    review.timeline.map((step) => [step.shiftId, step.obligations[0]?.state, step.obligations[0]?.omitted]),
    [["s1", "OPEN", false], ["s2", "OPEN", false], ["s3", "OPEN", true]],
  );
});

test("a fabricated quotation cannot supply a missing closing event", () => {
  const scenario = getFixture("unverified-closure")!;
  const forgedEvent = { ...scenario.events[1], quote: "PSV-470 verified on RI-470." };
  const review = reconcile(scenario.input, [scenario.events[0], forgedEvent]);
  assert.equal(review.verdict, "HOLD");
  assert.ok(review.rulesTriggered.includes("EVIDENCE_REJECTED"));
  assert.ok(!review.events.some((event) => event.quote === forgedEvent.quote));
  assert.equal(review.obligations[0]?.state, "OPEN");
});

test("evidence for a nearby similarly named asset cannot be reassigned", () => {
  const scenario = getFixture("unrelated-equipment")!;
  const nearby = scenario.events[1];
  const result = reconcile(scenario.input, [{ ...nearby, equipmentId: "PSV-910" }]);
  assert.equal(result.verdict, "REVIEW_REQUIRED");
  assert.ok(result.events.every((item) => item.evidence.source === "register"));
  assert.ok(result.rulesTriggered.includes("EVIDENCE_REJECTED"));
});

test("a valid record from a prior shift does not close a newly observed restriction", () => {
  const scenario = getFixture("closure-verified")!;
  const notes = "PSV-416 was withdrawn again after the reinstatement entry.";
  const input = {
    ...scenario.input,
    shifts: [...scenario.input.shifts, { id: "s3", label: "Night shift", notes }],
  };
  const events = [...scenario.events, { ...scenario.events[0], shiftId: "s3", quote: notes }];
  const review = reconcile(input, events);
  assert.equal(review.verdict, "HOLD");
  assert.equal(review.obligations[0]?.state, "OPEN");
  assert.deepEqual(
    review.timeline[2].transitions.map(({ from, to }) => [from, to]),
    [["CLOSED_VERIFIED", "OPEN"]],
  );
});

test("an explicit permit on one asset cannot hide a restriction on another action asset", () => {
  const permitCase = getFixture("wrong-permit")!;
  const closureCase = getFixture("closure-verified")!;
  const restriction = "PTW-416 remains suspended for PSV-416.";
  const input: ReviewInput = {
    shifts: permitCase.input.shifts.map((shift, index) => ({
      ...shift,
      notes: [shift.notes, closureCase.input.shifts[index].notes, ...(index === 1 ? [restriction] : [])].join("\n"),
    })),
    equipment: [...permitCase.input.equipment, { ...closureCase.input.equipment[0], permitIds: ["PTW-416"] }],
    register: [...permitCase.input.register, ...closureCase.input.register],
    action: {
      description: "Review an action for P-110 under PTW-111 and PSV-416.",
      equipmentIds: ["P-110", "PSV-416"],
      permitIds: ["PTW-111"],
    },
  };
  const restrictionEvent: Event = {
    equipmentId: "PSV-416", permitId: "PTW-416", type: "PERMIT_RESTRICTION", status: "ACTIVE",
    shiftId: "s2", quote: restriction, confidence: "HIGH", followUp: null,
  };
  const events = [...permitCase.events, ...closureCase.events];
  assert.equal(reconcile(input, events).verdict, "NO_CONFLICT_FOUND");
  assert.equal(reconcile(input, [...events, restrictionEvent]).verdict, "HOLD");
});

test("repeat copies of the same extraction are idempotent", () => {
  const scenario = getFixture("duplicate-mentions")!;
  const [first] = scenario.events;
  assert.deepEqual(
    reconcile(scenario.input, [...scenario.events, first, first]),
    reconcile(scenario.input, scenario.events),
  );
});

test("extraction failure prevents a clear verdict and preserves independently known holds", () => {
  const closed = getFixture("closure-verified")!;
  const open = getFixture("bypass-omitted")!;
  const options = { issues: ["SERV extraction unavailable."] };
  assert.equal(reconcile(closed.input, [], options).verdict, "REVIEW_REQUIRED");
  assert.equal(reconcile(open.input, [], options).verdict, "HOLD");
});
