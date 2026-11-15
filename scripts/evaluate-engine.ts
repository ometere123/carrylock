import { reconcile } from "../src/lib/engine";
import { FIXTURES, FIXTURE_VERSION, type Fixture } from "../src/lib/fixtures";
import type { Verdict } from "../src/lib/types";

function currentShiftBaseline(fixture: Fixture, includeLatestRegister: boolean): Verdict {
  const { action, register, shifts } = fixture.input;
  const latest = shifts.at(-1);
  const isDependency = (equipmentId: string, permitId: string | null) =>
    action.equipmentIds.includes(equipmentId) &&
    (permitId === null || action.permitIds.length === 0 || action.permitIds.includes(permitId));

  const statements = fixture.events.filter(
    (event) => event.shiftId === latest?.id && isDependency(event.equipmentId, event.permitId),
  );
  const registerActive = includeLatestRegister && register.some(
    (record) => record.shiftId === latest?.id && record.status === "ACTIVE" &&
      isDependency(record.equipmentId, record.permitId),
  );

  if (registerActive || statements.some((event) => event.status === "ACTIVE")) return "HOLD";
  if (statements.some((event) => event.status === "UNKNOWN")) return "REVIEW_REQUIRED";
  return "NO_CONFLICT_FOUND";
}

const cases = FIXTURES.map((fixture) => {
  const actual = reconcile(fixture.input, fixture.events);
  const expected = fixture.expected.verdict;
  const notesOnly = currentShiftBaseline(fixture, false);
  const withRegister = currentShiftBaseline(fixture, true);
  return { id: fixture.id, expected, reconciliation: actual.verdict, notesOnly, withRegister };
});

type ResultColumn = "reconciliation" | "notesOnly" | "withRegister";

function summarize(column: ResultColumn) {
  return {
    correctVerdicts: cases.filter((row) => row[column] === row.expected).length,
    total: cases.length,
    expectedHoldsCalledClear: cases.filter(
      (row) => row.expected === "HOLD" && row[column] === "NO_CONFLICT_FOUND",
    ).map((row) => row.id),
  };
}

const report = {
  fixtureVersion: FIXTURE_VERSION,
  inputs: "Versioned synthetic notes and curated event annotations. This measures decision logic separately from live extraction.",
  baseline: "Looks only at relevant latest-shift events. Active means HOLD, explicit unknown means REVIEW_REQUIRED, and missing or claimed closure means NO_CONFLICT_FOUND. The register variant also checks active register entries for that same shift.",
  reconciliation: summarize("reconciliation"),
  latestNotesOnly: summarize("notesOnly"),
  latestNotesAndRegister: summarize("withRegister"),
  cases,
};

console.log(JSON.stringify(report, null, 2));
if (report.reconciliation.correctVerdicts !== cases.length) process.exitCode = 1;
