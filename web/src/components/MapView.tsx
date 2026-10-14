import { useApp } from "../store";

export function MapView() {
  const { g, go } = useApp();
  const links = new Map<string, Set<string>>();
  g.bundle.links.forEach(([a, b]) => { if (g.bundle.pages[b] && a !== b) (links.get(a) ?? links.set(a, new Set()).get(a)!).add(b); });
  const entry = (p: string) => g.bundle.roots[p]?.length ?? 0;
  return (
    <div className="map">
      <h1>Whole guideline</h1>
      <p className="note">Every algorithm page and where it leads. Select a page to open it.</p>
      <div className="tiles">
        {g.flowPages.map((p) => {
          const out = [...(links.get(p) ?? [])];
          return (
            <div key={p} className="tile">
              <button className="tile-main" onClick={() => go({ kind: "flow", page: p })}>
                <code>{p}</code><b>{g.bundle.pages[p].title || "Algorithm page"}</b>
                <span>{g.bundle.pages[p].nodes.filter((n) => n.kind === "box").length} boxes{entry(p) ? ` · ${entry(p)} entr${entry(p) > 1 ? "ies" : "y"}` : ""}</span>
              </button>
              {out.length > 0 && <div className="tile-out"><span>Leads to</span>{out.map((o) => <button key={o} className="xref" onClick={() => go({ kind: "flow", page: o })}>{o}</button>)}</div>}
            </div>
          );
        })}
      </div>
      {(["principles", "staging", "discussion", "reference"] as const).map((k) => g.docCodes[k].length > 0 && (
        <section key={k}>
          <h2>{k === "principles" ? "Principles" : k === "staging" ? "Staging" : k === "discussion" ? "Discussion" : "Reference"}</h2>
          <div className="chips">{g.docCodes[k].map((c) => <button key={c} className="chip" title={g.bundle.docs[c].title} onClick={() => go({ kind: "doc", code: c })}>{c}</button>)}</div>
        </section>
      ))}
    </div>
  );
}
