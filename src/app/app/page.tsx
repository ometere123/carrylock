import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site";
import { Workspace } from "@/components/workspace";

export const metadata: Metadata = { title: "Review workspace" };

export default function Application() {
  return <><SiteHeader current="app"/><main className="workspace shell"><Workspace/></main><SiteFooter/></>;
}
