import run from "../../../docs/serv-guarded-closure.json";
import events from "../../../docs/serv-guarded-events.json";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { Workspace } from "@/components/workspace";
import { getFixture } from "@/lib/fixtures";

export const metadata: Metadata = { title: "Review workspace" };

function GuidedReview() {
  const scenario = getFixture("relief-reinstatement");
  if (!scenario) return null;

  return <div className="guided-review">
    <p className="eyebrow">Guided synthetic example</p>
    <h2 id="guided-title">The missing relief valve</h2>
    <p>Follow PSV-204 through three handovers and see why the restart review ends in a HOLD.</p>
    <ol className="guided-shifts">
      {scenario.input.shifts.map((shift, index) => {
        const observation = scenario.events.find(event => event.shiftId === shift.id);
        return <li key={shift.id}>
          <h3>Shift {["A", "B", "C"][index]} · {["Valve removed", "Still unavailable", "Valve omitted"][index]}</h3>
          <blockquote>{observation?.quote ?? shift.notes}</blockquote>
        </li>;
      })}
    </ol>
    <p><strong>Persistent obligation:</strong> PSV-204 stays open until verified reinstatement. Shift C has no reinstatement evidence.</p>
    <p><strong>Advisory HOLD:</strong> {scenario.input.action.description}</p>
  </div>;
}

function RecordedEvidence() {
  return <section className="panel field-panel recorded-evidence" aria-labelledby="recorded-title">
    <p className="eyebrow">Historical authenticated SERV run</p>
    <h2 id="recorded-title">SERV extracted both closure-case observations</h2>
    <p>{run.model} · HTTP {run.httpStatus} · {run.latencyMs.toLocaleString("en-US")} ms · verified closure</p>
    <details>
      <summary>Inspect completion ID and exact source quotes</summary>
      <p>Completion ID <code>{run.completionId}</code></p>
      {events.map(event => <blockquote key={event.shiftId}>
        <p>{event.quote}</p>
        <cite>{event.shiftId} · {event.equipmentId} · {event.type} · {event.status}</cite>
      </blockquote>)}
      <p>The rules matched the closure claim against the supplied register and returned {run.actualVerdict.replaceAll("_", " ")}. Operational authorization requires a separate decision.</p>
    </details>
    <p>This recorded run used synthetic notes. The demo presets replay curated events. Custom reviews request new extraction only when the shared budget admits the call.</p>
  </section>;
}

export default function Application() {
  return <>
    <SiteHeader current="app"/>
    <main className="workspace shell">
      <Workspace walkthrough={<GuidedReview/>} recordedEvidence={<RecordedEvidence/>}/>
    </main>
    <SiteFooter/>
  </>;
}
