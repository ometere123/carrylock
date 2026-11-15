import Link from "next/link";

export function Brand() {
  return <Link href="/" className="brand" aria-label="Carrylock home">
    <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="14" fill="currentColor"/><path d="m15 33 17-19 17 19M15 43l17-19 17 19M22 45l10-11 10 11" fill="none" stroke="#111b25" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/></svg>
    <span>CARRY<span>LOCK</span></span>
  </Link>;
}

export function SiteHeader({ current = "home" }: {current?: "home"|"app"|"methodology"}) {
  return <header className="site-header"><div className="shell header-inner">
    <Brand/><nav aria-label="Main navigation">
      <Link aria-current={current === "app" ? "page" : undefined} href="/app">Workspace</Link>
      <Link aria-current={current === "methodology" ? "page" : undefined} href="/methodology">Methodology</Link>
    </nav><span className="edition"><i/> SERV HACKATHON 02</span>
  </div></header>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div className="shell footer-inner">
    <Brand/><p>Cross-shift evidence review<br/>Prototype · Human authorization required</p><Link href="/methodology">Read the method ↗</Link>
  </div></footer>;
}
