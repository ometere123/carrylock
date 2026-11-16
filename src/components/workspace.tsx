"use client";

import { useEffect, useState, type FormEvent } from "react";
import { AlertCircle, ArrowDownToLine, ArrowRight, ChevronDown, CircleHelp, ClipboardList, FileSearch, GitCompareArrows, Layers3, Plus, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { EVENT_TYPES, EVIDENCE_TYPES, REGISTER_ROLES, type ReviewInput, type Finding, type State, type VerifiedEvent } from "@/lib/types";
import type { ReviewResponse } from "@/lib/receipt";

const scenarios = [
  { id: "relief-reinstatement", code: "A", title: "Missing reinstatement", text: "A removed relief valve slips out of the next handover.", category: "RELIEF BARRIER" },
  { id: "bypass-omitted", code: "B", title: "Bypass drops out", text: "The next shift is silent. The register still shows an active bypass.", category: "SAFETY SYSTEM" },
  { id: "permit-suspended", code: "C", title: "Permit still suspended", text: "The notes say the work is done. The permit says otherwise.", category: "WORK PERMIT" },
  { id: "closure-verified", code: "D", title: "Closure supported", text: "A consistent record and named confirmation are present.", category: "VERIFIED EVIDENCE" },
];

const blank = (): ReviewInput => ({
  shifts: [{ id: "shift-1", label: "Outgoing shift", notes: "" }, { id: "shift-2", label: "Incoming shift", notes: "" }],
  equipment: [{ id: "", aliases: [], permitIds: [] }],
  register: [],
  action: { description: "", equipmentIds: [], permitIds: [] },
});
const list = (s: string) => s.split(",").map(v => v.trim()).filter(Boolean);
const label = (s: string) => s.replaceAll("_", " ");
const stateStyle: Record<State, string> = { OPEN: "hold", CONFLICT: "hold", CLOSED_VERIFIED: "closed", UNKNOWN: "review" };
const verdictCopy = {
  HOLD: { title: "Hold for human review", text: "An active restriction or unresolved conflict affects this proposed action. Refer it to the responsible site authority.", theme: "hold" },
  REVIEW_REQUIRED: { title: "More evidence is needed", text: "This review cannot resolve the proposed action from the supplied evidence. An authorized person must investigate.", theme: "review" },
  NO_CONFLICT_FOUND: { title: "No relevant conflict found", text: "No relevant conflict was found in the supplied evidence. This is not permission to operate.", theme: "closed" },
};

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={"badge " + tone}>{children}</span>;
}

function Quotes({ events, input }: {events: VerifiedEvent[]; input: ReviewInput}) {
  return <div className="quotes">{events.map((ev, i) => {
    const source = ev.evidence.source === "register" ? "Register / " + ev.evidence.sourceId : (input.shifts.find(s => s.id === ev.shiftId)?.label ?? ev.shiftId) + " / line " + ev.evidence.line;
    return <blockquote key={ev.evidence.sourceId + ":" + ev.evidence.start + ":" + i}>
      <p>{ev.evidence.source === "shift" ? "“" + ev.quote + "”" : ev.quote}</p><cite>{source} · {label(ev.status)} · {ev.confidence.toLowerCase()} confidence</cite>
    </blockquote>;
  })}</div>;
}

function FindingCard({ finding, input }: {finding: Finding; input: ReviewInput}) {
  const icon = finding.kind === "VERIFIED_CLOSURE" ? <ShieldCheck size={20}/> : finding.kind === "OMISSION" ? <GitCompareArrows size={20}/> : <AlertCircle size={20}/>;
  return <article className={"finding " + finding.kind.toLowerCase()}><div className="finding-icon">{icon}</div><div>
    <div className="finding-key">{label(finding.kind)}{finding.shiftId && " / " + (input.shifts.find(s => s.id === finding.shiftId)?.label ?? finding.shiftId)}</div>
    <h4>{finding.title}</h4><p>{finding.detail}</p>
    {!!finding.evidence.length && <details><summary>Original evidence <ChevronDown size={14}/></summary><Quotes events={finding.evidence} input={input}/></details>}
  </div></article>;
}

function Result({ data, edit }: {data: ReviewResponse; edit: () => void}) {
  const { input, review, receipt } = data;
  const [focused, setFocused] = useState(review.timeline.find(s=>s.obligations.some(o=>o.omitted))?.shiftId ?? review.timeline.at(-1)?.shiftId);
  const focus = review.timeline.find(s=>s.shiftId === focused);
  const shift = input.shifts.find(s=>s.id===focused);
  const focusEvents = review.events.filter(e=>e.shiftId===focused);
  const copy = verdictCopy[review.verdict];
  const fixture = receipt.extraction.mode === "synthetic_fixture";
  const provider = !fixture && receipt.extraction.mode === "serv" ? receipt.extraction.serv : null;

  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2) + "\n"], { type: "application/json" }));
    const el = document.createElement("a");
    el.href = url;
    el.download = "carrylock-review-" + receipt.inputHashes.dataset.slice(0, 10) + ".json";
    el.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className="results" aria-label="Review results">
    <div className={"verdict " + copy.theme}>
      <div className="verdict-icon">{review.verdict === "NO_CONFLICT_FOUND" ? <ShieldCheck size={25}/> : <ShieldAlert size={25}/>}</div>
      <div className="verdict-body"><div className="eyebrow">PROPOSED ACTION / ADVISORY</div><h2>{copy.title}</h2><p className="proposed">{input.action.description}</p><p>{copy.text}</p>{review.actionReview.blockingObligationIds.length > 0 && <p className="action-blockers">Blocks this action: {review.obligations.filter(o => review.actionReview.blockingObligationIds.includes(o.id)).map(o => o.equipmentId + (o.permitId ? " / " + o.permitId : "")).join(", ")}</p>}</div>
      <div className="verdict-tools"><Badge tone={copy.theme}>{label(review.verdict)}</Badge><button className="button secondary small" onClick={download}><ArrowDownToLine size={15}/> JSON receipt</button></div>
    </div>
    <div className="source-bar"><span><i/> {fixture ? "Synthetic annotations · No SERV request" : (provider?.cacheHit ? "Cached SERV extraction · " : provider?.attempted ? "SERV extraction · " : "No new SERV request · ") + label(provider?.status ?? "unavailable").toLowerCase()}</span><button className="inline-button" onClick={edit}>Edit inputs <ArrowRight size={14}/></button></div>
    <div className="result-grid">
      <section className="panel timeline-panel">
        <div className="panel-title"><div className="eyebrow">01 / SHIFT TRACE</div><h3>Shift timeline</h3><p>Select a shift to inspect its evidence and any information lost.</p></div>
        <div className="timeline" aria-label="Select a shift">{review.timeline.map((s,i) => {
          const omitted=s.obligations.filter(o=>o.omitted).length;
          return <button type="button" key={s.shiftId} className={"shift-step " + (s.shiftId===focused?"selected ":"") + (omitted?"gap":"")} aria-pressed={s.shiftId===focused} onClick={()=>setFocused(s.shiftId)}>
            <span className="shift-num">{String(i+1).padStart(2,"0")}</span><strong>{s.label}</strong><small>{omitted ? omitted + (omitted===1?" omission":" omissions") : s.transitions.length ? s.transitions.length + (s.transitions.length===1?" change":" changes") : "No state change"}</small>
          </button>;
        })}</div>
        {focus && <div className="shift-detail" aria-live="polite">
          <div className="shift-detail-title"><strong>{shift?.label}</strong><span>{focusEvents.length} evidence {focusEvents.length===1?"item":"items"}</span></div>
          {focus.obligations.length > 0 && <div className="shift-states">{focus.obligations.map(o => <div key={o.id}><span>{review.obligations.find(r=>r.id===o.id)?.equipmentId ?? o.id}{o.omitted && <small> · Missing from notes</small>}</span><Badge tone={stateStyle[o.state]}>{label(o.state)}</Badge></div>)}</div>}
          {focusEvents.length > 0 ? <Quotes events={focusEvents} input={input}/> : <p className="empty-evidence">No validated evidence extracted for this shift.</p>}
          {shift && <details className="full-note"><summary>Read full shift note <ChevronDown size={14}/></summary><p>{shift.notes || "No notes supplied."}</p></details>}
        </div>}
      </section>
      <section className="panel register-panel">
        <div className="panel-title"><div className="eyebrow">02 / PERSISTENT STATE</div><h3>Obligation register</h3><p>State is carried forward until the rules allow a transition.</p></div>
        {review.obligations.length ? <div className="obligation-list">{review.obligations.map(o=><article key={o.id} className="obligation"><div className="obligation-title"><div><h4>{o.equipmentId}</h4><p>{label(o.type)}{o.permitId && " / " + o.permitId}</p></div><Badge tone={stateStyle[o.state]}>{label(o.state)}</Badge></div>
          {o.followUp && <p className="follow-up">{o.followUp}</p>}
          <details><summary>View evidence trail <ChevronDown size={14}/></summary><Quotes events={o.evidence} input={input}/></details>
        </article>)}</div> : <p className="empty-evidence register-empty">No obligation could be established in the supplied evidence.</p>}
      </section>
    </div>
    <section className="panel findings-panel"><div className="panel-title"><div className="eyebrow">03 / EVIDENCE GAPS</div><h3>Omissions, conflicts and closures</h3><p>Read the exact evidence and the shift where each issue appeared.</p></div>
      {review.findings.length ? <div className="findings">{review.findings.map((f,i)=><FindingCard key={f.code + ":" + i} finding={f} input={input}/>)}</div> : <p className="empty-evidence">No specific findings in this review.</p>}
      {!!review.missingEvidence.length && <details className="missing-list"><summary>Unknown or missing evidence ({review.missingEvidence.length}) <ChevronDown size={14}/></summary><ul>{review.missingEvidence.map((m,i)=><li key={i}>{m}</li>)}</ul></details>}
    </section>
  </section>;
}

function SplitInput({ initial, onChange, ...props }: {initial: string[]; onChange: (v:string[])=>void; placeholder?: string; required?: boolean}) {
  return <input defaultValue={initial.join(", ")} onChange={e=>onChange(list(e.target.value))} {...props}/>;
}

function Editor({ initial, live, busy, submit }: {initial: ReviewInput; live: boolean | null; busy: boolean; submit: (input: ReviewInput)=>void}) {
  const [input, setInput] = useState(initial);
  const [seq, setSeq] = useState(initial.shifts.length + 1);
  const [regSeq, setRegSeq] = useState(initial.register.length + 1);
  const [equipmentKeys, setEquipmentKeys] = useState(() => initial.equipment.map((_,i) => i));
  const [registerKeys, setRegisterKeys] = useState(() => initial.register.map((_,i) => i));
  const [eqSeq, setEqSeq] = useState(initial.equipment.length);
  const shift = (i:number, data: Partial<ReviewInput["shifts"][number]>) => setInput(x=>({...x,shifts:x.shifts.map((s,j)=>j===i?{...s,...data}:s)}));
  const eq = (i:number, data: Partial<ReviewInput["equipment"][number]>) => setInput(x=>({...x,equipment:x.equipment.map((s,j)=>j===i?{...s,...data}:s)}));
  const reg = (i:number, data: Partial<ReviewInput["register"][number]>) => setInput(x=>({...x,register:x.register.map((s,j)=>j===i?{...s,...data}:s)}));
  const action = (data: Partial<ReviewInput["action"]>) => setInput(x=>({...x,action:{...x.action,...data}}));

  const formSubmit = (e: FormEvent<HTMLFormElement>) => { e.preventDefault(); submit(input); };
  return <form className="editor" onSubmit={formSubmit}>
    <div className="editor-alert"><CircleHelp size={19}/><p>Use synthetic or de-identified data. {live === false ? "Live inference is unavailable on this deployment. Running a review will report that evidence gap." : "A live review sends the supplied notes and equipment catalog to OpenServ."}</p></div>
    <fieldset className="panel field-panel"><legend>01 / Shift notes</legend><p className="field-intro">Oldest first. Add any intervening shifts where an obligation could have been omitted.</p>
      <div className="form-shifts">{input.shifts.map((s,i)=><div className="form-block" key={s.id}><div className="form-row-title"><span>SHIFT {i+1}</span>{input.shifts.length>2 && <button type="button" className="icon-button" aria-label={"Remove shift " + (i+1)} onClick={()=>setInput(x=>({...x,shifts:x.shifts.filter(y=>y.id!==s.id),register:x.register.map(r=>r.shiftId===s.id?{...r,shiftId:""}:r)}))}><X size={16}/></button>}</div>
        <label>Shift label<input required maxLength={70} value={s.label} onChange={e=>shift(i,{label:e.target.value})}/></label><label>Original note<textarea rows={5} maxLength={8000} placeholder="Paste the shift note here…" value={s.notes} onChange={e=>shift(i,{notes:e.target.value})}/></label>
      </div>)}</div>
      <button type="button" className="button secondary small" disabled={input.shifts.length>=6} onClick={()=>{setInput(x=>({...x,shifts:[...x.shifts,{id:"shift-"+seq,label:"Shift "+seq,notes:""}]}));setSeq(seq+1);}}><Plus size={15}/> Add shift</button>
    </fieldset>
    <fieldset className="panel field-panel"><legend>02 / Equipment and permits</legend><p className="field-intro">Enter exact identifiers. Aliases and permit IDs are comma separated.</p>
      {input.equipment.map((e,i)=><div className="form-block" key={equipmentKeys[i]}><div className="form-row-title"><span>EQUIPMENT {i+1}</span>{input.equipment.length>1&&<button type="button" className="icon-button" aria-label={"Remove equipment " + (i+1)} onClick={()=>{setInput(x=>({...x,equipment:x.equipment.filter((_,j)=>i!==j)}));setEquipmentKeys(x=>x.filter((_,j)=>i!==j));}}><X size={16}/></button>}</div><div className="form-cols">
        <label>Equipment ID<input required value={e.id} placeholder="PSV-204" onChange={v=>eq(i,{id:v.target.value})}/></label>
        <label>Aliases<SplitInput initial={e.aliases} placeholder="Relief valve 204" onChange={v=>eq(i,{aliases:v})}/></label>
        <label>Permit IDs<SplitInput initial={e.permitIds} placeholder="PTW-204" onChange={v=>eq(i,{permitIds:v})}/></label>
      </div></div>)}
      <button type="button" className="button secondary small" disabled={input.equipment.length>=16} onClick={()=>{setInput(x=>({...x,equipment:[...x.equipment,{id:"",aliases:[],permitIds:[]}]}));setEquipmentKeys(x=>[...x,eqSeq]);setEqSeq(x=>x+1);}}><Plus size={15}/> Add equipment</button>
    </fieldset>
    <fieldset className="panel field-panel"><legend>03 / Status register <span>Optional</span></legend><p className="field-intro">Use a register you trust. A supplied role and name are recorded as input assertions.</p>
      {input.register.map((r,i)=><div className="form-block" key={registerKeys[i]}><div className="form-row-title"><span>REGISTER ENTRY {i+1}</span><button type="button" className="icon-button" aria-label={"Remove register entry " + (i+1)} onClick={()=>{setInput(x=>({...x,register:x.register.filter((_,j)=>i!==j)}));setRegisterKeys(x=>x.filter((_,j)=>i!==j));}}><X size={16}/></button></div><div className="form-cols">
        <label>Record ID<input required value={r.id} onChange={e=>reg(i,{id:e.target.value})}/></label>
        <label>Effective shift<select required value={r.shiftId} onChange={e=>reg(i,{shiftId:e.target.value})}><option value="">Select a shift</option>{input.shifts.map(s=><option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
        <label>Equipment ID<input required value={r.equipmentId} onChange={e=>reg(i,{equipmentId:e.target.value})}/></label>
        <label>Permit ID<input value={r.permitId??""} onChange={e=>reg(i,{permitId:e.target.value||null})}/></label>
        <label>Event type<select value={r.type} onChange={e=>reg(i,{type:e.target.value as typeof r.type})}>{EVENT_TYPES.map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label>
        <label>Status<select value={r.status} onChange={e=>reg(i,{status:e.target.value as typeof r.status})}><option>ACTIVE</option><option>CLOSED</option></select></label>
        <label>Evidence type<select value={r.evidenceType??""} onChange={e=>reg(i,{evidenceType:(e.target.value||null) as typeof r.evidenceType})}><option value="">Not supplied</option>{EVIDENCE_TYPES.map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label>
        <label>Evidence reference<input value={r.evidenceRef??""} onChange={e=>reg(i,{evidenceRef:e.target.value||null})}/></label>
        <label>Confirmed by<input value={r.confirmedBy??""} onChange={e=>reg(i,{confirmedBy:e.target.value||null})}/></label>
        <label>Confirmer role<select value={r.role??""} onChange={e=>reg(i,{role:(e.target.value||null) as typeof r.role})}><option value="">Not supplied</option>{REGISTER_ROLES.map(t=><option key={t} value={t}>{label(t)}</option>)}</select></label>
      </div></div>)}
      <button type="button" className="button secondary small" disabled={input.register.length>=24} onClick={()=>{setInput(x=>({...x,register:[...x.register,{id:"REG-"+regSeq,shiftId:x.shifts.at(-1)?.id??"",equipmentId:"",permitId:null,type:"OTHER_RESTRICTION",status:"ACTIVE",evidenceType:null,evidenceRef:null,confirmedBy:null,role:null}]}));setRegisterKeys(x=>[...x,regSeq]);setRegSeq(regSeq+1);}}><Plus size={15}/> Add register entry</button>
    </fieldset>
    <fieldset className="panel field-panel"><legend>04 / Proposed action</legend>
      <label>Next-shift action<input required maxLength={500} value={input.action.description} onChange={e=>action({description:e.target.value})} placeholder="Proposed restart of the equipment…"/></label>
      <div className="form-cols"><label>Equipment dependencies<SplitInput initial={input.action.equipmentIds} onChange={v=>action({equipmentIds:v})} placeholder="PSV-204"/></label><label>Permit dependencies<SplitInput initial={input.action.permitIds} onChange={v=>action({permitIds:v})} placeholder="PTW-204"/></label></div>
    </fieldset>
    <button type="submit" className="button primary" disabled={busy}><FileSearch size={17}/> {busy?"Reviewing…":"Run evidence review"}</button>
  </form>;
}

export function Workspace({ walkthrough, recordedEvidence }: { walkthrough?: React.ReactNode; recordedEvidence?: React.ReactNode }) {
  const [view, setView] = useState<"demo"|"custom">("demo");
  const [active, setActive] = useState<string | null>(null);
  const [data, setData] = useState<ReviewResponse | null>(null);
  const [draft, setDraft] = useState<ReviewInput>(()=>blank());
  const [editorVersion, bumpEditor] = useState(0);
  const [live, setLive] = useState<boolean|null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let stale = false;
    fetch("/api/review").then(r=>r.ok?r.json():null).then(r=>{if (!stale && r) setLive(r.liveEnabled === true && r.budgetReady === true);}).catch(()=>{});
    return ()=>{stale=true;};
  }, []);

  async function run(body: {scenarioId: string} | {input: ReviewInput}) {
    setError(null);
    setBusy(true);
    setData(null);
    setActive("scenarioId" in body ? body.scenarioId : null);
    try {
      const res = await fetch("/api/review", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
      const next = await res.json();
      if (!res.ok || !next.review || !next.receipt) throw new Error(typeof next.message === "string" ? next.message : typeof next.error === "string" ? next.error : "The review did not complete. Verify the inputs or try again.");
      setData(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The review did not complete.");
    } finally { setBusy(false); }
  }

  const edit = () => { if(data) {setDraft(data.input);bumpEditor(i=>i+1);setView("custom");setData(null);setActive(null);window.scrollTo({top:0,behavior:"smooth"});} };
  const switchTo = (tab: "demo"|"custom") => { if (tab !== view) {setView(tab);setData(null);setError(null);setActive(null);} };
  return <>
    <div className="workspace-title"><div><div className="eyebrow"><i/> THE HANDOVER EVIDENCE DESK</div><h1>Review workspace</h1><p>Trace the obligations that carry across shifts.</p></div><div className="workspace-stamp"><ClipboardList size={17}/> ADVISORY PROTOTYPE</div></div>
    <section className="panel field-panel guided-panel" aria-labelledby="guided-title">
      {walkthrough}
      <button className="button primary" type="button" disabled={busy} onClick={() => { switchTo("demo"); void run({scenarioId:"relief-reinstatement"}); }}>Run the guided synthetic review</button>
      <p className="guided-result" role="status">{active === "relief-reinstatement" && data ? "Review ready. Open the scenario results below for the timeline and receipt." : ""}</p>
      {active === "relief-reinstatement" && data && <a href="#review-results">Jump to review results</a>}
    </section>
    {recordedEvidence}
    <div className="workspace-tabs" aria-label="Choose review input">
      <button type="button" aria-pressed={view==="demo"} disabled={busy} onClick={()=>switchTo("demo")}><Layers3 size={17}/> Synthetic scenarios</button>
      <button type="button" aria-pressed={view==="custom"} disabled={busy} onClick={()=>switchTo("custom")}><FileSearch size={17}/> Custom review</button>
    </div>
    {view==="demo" ? <section className="scenario-section" aria-label="Synthetic scenarios"><div className="scenario-header"><h2>Choose a scenario</h2><span>PRE-ANNOTATED / SYNTHETIC</span></div>
      <div className="scenario-grid">{scenarios.map(s=><button className={"scenario " + (active===s.id?"selected":"")} aria-pressed={active===s.id} disabled={busy} key={s.id} type="button" onClick={()=>run({scenarioId:s.id})}>
        <div className="scenario-meta"><span className="scenario-code">{s.code}</span><span>{s.category}</span><ArrowRight size={16}/></div><strong>{s.title}</strong><span className="scenario-text">{s.text}</span>
      </button>)}</div>
    </section> : <Editor key={editorVersion} initial={draft} live={live} busy={busy} submit={input=>{setDraft(input);void run({input});}}/>}
    {busy && <p className="workspace-message" role="status">Reconciling the supplied evidence…</p>}
    {error && <p className="workspace-message error" role="alert">{error}</p>}
    {data && <div id="review-results" tabIndex={-1}><Result key={data.receipt.timestamp} data={data} edit={edit}/></div>}
    {!data&&!busy&&!error&&view==="demo"&&<div className="workspace-empty"><GitCompareArrows size={29}/><h2>Every open obligation has a history.</h2><p>Choose a synthetic scenario to see which details carried forward, which went missing, and why the proposed action received its verdict.</p></div>}
  </>;
}
