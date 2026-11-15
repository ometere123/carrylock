import run from "../../../docs/serv-guarded-closure.json";
import events from "../../../docs/serv-guarded-events.json";
import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { Workspace } from "@/components/workspace";

export const metadata: Metadata = { title: "Review workspace" };

export default function Application() {
  return <><SiteHeader current="app"/><main className="workspace shell"><section className="panel field-panel" aria-label="Recorded SERV evidence"><details><summary>Inspect a genuine SERV completion (historical)</summary><h2>Recorded SERV review: verified closure</h2><p>Authenticated HTTP {run.httpStatus} · {run.model} · {run.latencyMs.toLocaleString("en-US")} ms</p><p>Completion ID: <code style={{overflowWrap:"anywhere"}}>{run.completionId}</code></p><p>Prompt: {run.promptVersion}. Both extracted events matched the supplied synthetic shift notes.</p>{events.map((event, index) => <blockquote key={index}><p>{event.quote}</p><cite>{event.shiftId} · {event.equipmentId} · {event.type} · {event.status}</cite></blockquote>)}<p>Measured outcome: {run.actualVerdict.replaceAll("_", " ")}. The deterministic engine recorded closure based on matching register evidence. This is not permission to operate.</p><p>This is one historical authenticated run on synthetic input. The four presets below replay curated annotations. Earlier live evaluations had mixed results, and new paid public requests are blocked until shared budget storage is configured.</p></details></section><Workspace/></main><SiteFooter/></>;
}
