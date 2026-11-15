import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileCheck2, Layers3, ScanLine, ShieldAlert } from "lucide-react";
import { SiteFooter, SiteHeader } from "@/components/site";

const steps = [
  { id: "01", icon: ScanLine, title: "Read the evidence", text: "SERV identifies safety observations and links differently worded notes to the same equipment and obligation." },
  { id: "02", icon: Layers3, title: "Carry the obligation", text: "The engine preserves unresolved restrictions when later notes go quiet. It flags the shift where evidence dropped out." },
  { id: "03", icon: FileCheck2, title: "Review the proposed action", text: "See which evidence triggered a hold, what would support closure, and what a human reviewer still needs to check." },
];

function HandoverGraphic() {
  return <div className="hero-console" aria-label="Illustration: an open relief valve obligation persists through an omitted handover">
    <div className="console-head"><span><i/> HANDOVER TRACE</span><span>ILLUSTRATIVE / 01</span></div>
    <div className="drawing">
      <div className="ruler" aria-hidden="true"><span>00</span><span>06</span><span>12</span><span>18</span></div>
      <svg role="img" aria-label="Three shifts connected by an unresolved obligation, with a gap in shift B" viewBox="0 0 440 137">
        <defs><pattern id="minor-grid" width="22" height="22" patternUnits="userSpaceOnUse"><path d="M 22 0 L 0 0 0 22" fill="none" stroke="#30404b" strokeWidth=".7"/></pattern></defs>
        <rect width="440" height="137" fill="url(#minor-grid)"/>
        <path d="M15 92H76V59H159 M278 59H355V92H425" fill="none" stroke="#d9936b" strokeWidth="2"/>
        <path d="M159 59H278" fill="none" stroke="#d9936b" strokeWidth="2" strokeDasharray="4 6"/>
        <path d="M76 92V124 M218 75V124 M355 92V124" fill="none" stroke="#42505d" strokeDasharray="3 5"/>
        <circle cx="76" cy="59" r="7" fill="#d9936b"/><circle cx="218" cy="59" r="10" fill="#1c2833" stroke="#d9936b" strokeWidth="2"/>
        <path d="M214 59h8" stroke="#d9936b" strokeWidth="2"/><circle cx="355" cy="59" r="7" fill="#d9936b"/>
        <path d="M218 42V19H286" stroke="#778391" strokeWidth="1" fill="none"/>
        <text x="292" y="22" fill="#e9ac86" fontSize="10" fontFamily="monospace">NOTE MISSING</text>
      </svg>
      <div className="drawing-labels"><span>SHIFT A<strong>Reported</strong></span><span>SHIFT B<strong>Omitted</strong></span><span>SHIFT C<strong>Still open</strong></span></div>
    </div>
    <div className="console-output"><div className="console-icon"><ShieldAlert size={20}/></div><div><strong>PSV-204 stays open</strong><small>No reinstatement evidence supplied</small></div><span className="badge hold">HOLD</span></div>
  </div>;
}

export default function Home() {
  return <><SiteHeader/><main id="main">
    <section className="hero shell" aria-labelledby="home-title">
      <div><div className="eyebrow"><i/> THE HANDOVER EVIDENCE DESK</div>
        <h1 id="home-title">A hazard doesn’t end <em>because a shift does.</em></h1>
        <p>Find the safety obligations that disappear between shifts. Trace each one to the original notes, and see what evidence is still needed before a proposed action can be reviewed.</p>
        <div className="hero-actions"><Link className="button primary" href="/app">Open workspace <ArrowRight size={18}/></Link><Link className="text-link" href="/methodology">See how it works <ArrowUpRight size={15}/></Link></div>
        <div className="hero-note"><span/> Synthetic scenarios · No sign-in required</div>
      </div><div className="hero-plate"><div className="plate-caption"><span>EXHIBIT A</span><span>SHIFT HANDOVER / PSV-204</span></div><HandoverGraphic/><div className="plate-footer"><span>01 — 03 / SEQUENCE</span><span>STATUS PERSISTS</span></div></div>
    </section>
    <section className="home-method"><div className="shell">
      <div className="section-top"><div><div className="eyebrow muted">FIELD NOTES / 01</div><h2>What survived the handover?</h2></div><p>Shift notes tell you what people remembered to write. Carrylock shows what the next team still needs to know.</p></div>
      <div className="step-grid">{steps.map(({ id, icon: Icon, title, text }) => <article key={id}><div className="step-top"><Icon size={21}/><span>{id}</span></div><h3>{title}</h3><p>{text}</p></article>)}</div>
    </div></section>
    <section className="shell limitation"><ShieldAlert size={21}/><p><strong>For advisory review only.</strong> Carrylock does not control equipment, approve permits, or authorize plant operation.</p><Link href="/app">Explore a scenario <ArrowRight size={16}/></Link></section>
  </main><SiteFooter/></>;
}
