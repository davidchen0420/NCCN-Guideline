import { useApp } from "../store";
import { T } from "../lib/terms";

export function MapView() {
  const { g, go, s } = useApp();
  const links = new Map<string, Set<string>>();
  g.bundle.links.forEach(([a, b]) => { if (g.bundle.pages[b] && a !== b) (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b); });
  const entry = (p: string) => g.bundle.roots[p]?.length ?? 0;
  const nSteps = (p: string) => g.bundle.pages[p].nodes.filter((n) => n.kind === "box").length;
  return (
    <div className="map">
      <h1>Guideline overview</h1>
      <p className="note">Every page of this guideline and where it leads. Select a page to open it.</p>
      <div className="tiles">
        {g.flowPages.map((p) => {
          const out = [...(links.get(p) ?? [])];
          return (
            <div key={p} className="tile">
              <button className="tile-main" onClick={() => go({ kind: "flow", page: p })}>
                <b>{g.bundle.pages[p].title || "Algorithm page"}</b><code>{p}</code>
                <span>{nSteps(p)} {nSteps(p) === 1 ? T.step : T.steps}{s.advanced && entry(p) ? ` · ${entry(p)} entr${entry(p) > 1 ? "ies" : "y"}` : ""}</span>
              </button>
              {out.length > 0 && <div className="tile-out"><span>Leads to</span>{out.map((o) => <button key={o} className="xref" title={o} onClick={() => go({ kind: "flow", page: o })}>{g.bundle.pages[o].title || o}</button>)}</div>}
            </div>
          );
        })}
      </div>
      {(["principles", "staging", "discussion", "reference"] as const).map((k) => g.docCodes[k].length > 0 && (
        <section key={k}>
          <h2>{k === "principles" ? "Principles" : k === "staging" ? "Staging" : k === "discussion" ? "Discussion" : "Reference"}</h2>
          <div className="chips">{g.docCodes[k].map((c) => <button key={c} className="chip" onClick={() => go({ kind: "doc", code: c })}>{g.bundle.docs[c].title} <code className="quiet">{c}</code></button>)}</div>
        </section>
      ))}
    </div>
  );
}
