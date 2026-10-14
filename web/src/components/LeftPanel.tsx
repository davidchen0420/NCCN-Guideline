import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search as SearchIcon } from "lucide-react";
import { useApp, type Loc } from "../store";
import { buildIndex, matcher, snippet, terms, vocab, type Kind, type SearchDoc } from "../lib/search";
import { pathSets } from "../lib/graph";

const KIND_LABEL: Record<Kind, string> = { box: "Algorithm", footnote: "Footnotes", principles: "Principles", staging: "Staging", discussion: "Discussion", reference: "Reference" };
const TAGS = ["Category 1", "Category 2A", "Category 2B", "Category 3", "Preferred", "Other Recommended", "Useful In Certain Circumstances"];

function Mark({ text, q }: { text: string; q: string }) {
  const ts = terms(q).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ts.length) return <>{text}</>;
  const parts = text.split(new RegExp(`(${ts.join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <span key={i}>{p}</span>))}</>;
}

function Group({ title, count, open, onToggle, children }: { title: string; count: number; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="group">
      <button className="group-head" onClick={onToggle} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span>{title}</span><em>{count}</em>
      </button>
      {open && <div className="group-body">{children}</div>}
    </section>
  );
}

export function Toc() {
  const { s, g, go } = useApp();
  const [f, setF] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ alg: true, principles: true });
  const q = f.trim().toLowerCase();
  const hit = (code: string, title: string) => !q || `${code} ${title}`.toLowerCase().includes(q);
  const cur = s.loc;
  const isCur = (l: Loc) => JSON.stringify({ ...l, node: undefined, sub: undefined }) === JSON.stringify({ ...cur, node: undefined, sub: undefined });
  const t = (k: string) => !!q || open[k];
  const flows = g.flowPages.filter((p) => hit(p, g.bundle.pages[p].title ?? ""));
  const secs: { key: keyof typeof g.docCodes; title: string }[] = [
    { key: "principles", title: "Principles" }, { key: "staging", title: "Staging" }, { key: "discussion", title: "Discussion" }, { key: "reference", title: "Reference" }];
  return (
    <div className="lv">
      <h2>Contents</h2>
      <div className="field"><SearchIcon size={14} /><input type="search" value={f} onChange={(e) => setF(e.target.value)} placeholder="Filter contents" aria-label="Filter contents" /></div>
      <Group title="Algorithm" count={flows.length} open={t("alg")} onToggle={() => setOpen({ ...open, alg: !open.alg })}>
        {flows.map((p) => (
          <button key={p} className={`toc-item alg${isCur({ kind: "flow", page: p }) ? " on" : ""}`} onClick={() => go({ kind: "flow", page: p })}>
            <code>{p}</code><span>{g.bundle.pages[p].title || "Algorithm page"}</span>
          </button>
        ))}
      </Group>
      {secs.map(({ key, title }) => {
        const items = g.docCodes[key].filter((c) => hit(c, g.bundle.docs[c].title));
        if (!items.length) return null;
        return (
          <Group key={key} title={title} count={items.length} open={t(key)} onToggle={() => setOpen({ ...open, [key]: !open[key] })}>
            {items.map((c) => (
              <button key={c} className={`toc-item ${key}${isCur({ kind: "doc", code: c }) ? " on" : ""}`} onClick={() => go({ kind: "doc", code: c })}>
                <code>{c}</code><span>{g.bundle.docs[c].title}</span>
              </button>
            ))}
          </Group>
        );
      })}
    </div>
  );
}

export function SearchPanel() {
  const { s, g, set, go, openFootnote } = useApp();
  const index = useMemo(() => buildIndex(g), [g]);
  const words = useMemo(() => vocab(index), [index]);
  const q = s.query;
  const path = useMemo(() => (s.answers.length && !s.searchNon ? pathSets(g, s.answers).nodes : null), [g, s.answers, s.searchNon]);
  const m = useMemo(() => matcher(q), [q]);

  const pool = useMemo(() => {
    if (!q.trim() && !s.tags.length) return [];
    return index.filter((d) => {
      if (!m(d.text)) return false;
      if (path && d.kind === "box" && !path.has(d.node!)) return false;
      if (s.tags.length) { if (d.kind !== "box") return false; const p = g.parsed.get(d.node!)!; return s.tags.every((t) => p.tags.includes(t)); }
      return true;
    });
  }, [index, m, q, s.tags, path, g]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    pool.forEach((d) => { c[d.kind] = (c[d.kind] ?? 0) + 1; });
    return c;
  }, [pool]);
  const shown = useMemo(() => {
    const act = s.kinds.length ? pool.filter((d) => s.kinds.includes(d.kind)) : pool;
    const rest = s.kinds.length ? pool.filter((d) => !s.kinds.includes(d.kind)) : [];
    return { act: act.slice(0, 80), rest: rest.slice(0, 20) };
  }, [pool, s.kinds]);

  const last = q.split(/\s+/).pop()?.toLowerCase() ?? "";
  const sugg = useMemo(() => (last.length < 2 || q.includes('"') ? [] : [...words.entries()].filter(([w]) => w.startsWith(last) && w !== last).sort((a, b) => b[1] - a[1]).slice(0, 6).map((x) => x[0])), [words, last, q]);
  const toggle = <T,>(arr: T[], v: T) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  const open = (d: SearchDoc) => {
    if (d.kind === "box") go({ kind: "flow", page: d.page, node: d.node });
    else if (d.kind === "footnote") { go({ kind: "flow", page: d.page, node: d.node }); openFootnote(d.letter!, d.node); }
    else go({ kind: "doc", code: d.page, sub: d.doc?.includes("#") ? Number(d.doc.split("#")[1]) : undefined });
  };
  const row = (d: SearchDoc, i: number, gray: boolean) => (
    <button key={`${gray ? "g" : "a"}${i}`} className={`res${gray ? " gray" : ""}`} onClick={() => open(d)}>
      <span className="res-top"><b>{d.label}</b><em>{KIND_LABEL[d.kind]}</em></span>
      <span className="res-text"><Mark text={snippet(d.text, q)} q={q} /></span>
    </button>
  );

  return (
    <div className="lv">
      <h2>Search</h2>
      <div className="seg"><button className="on">Keyword</button><button disabled title="AI search is not part of this prototype">AI search</button></div>
      <div className="field"><SearchIcon size={14} />
        <input type="search" autoFocus value={q} onChange={(e) => set({ query: e.target.value })} placeholder='Find… "quotes" for an exact match' aria-label="Search" />
      </div>
      {sugg.length > 0 && <div className="chips">{sugg.map((w) => <button key={w} className="chip" onClick={() => { const p = q.split(/(\s+)/); p[p.length - 1] = w; set({ query: p.join("") + " " }); }}>{w}</button>)}</div>}
      <h4>Filter</h4>
      <div className="chips">
        {TAGS.map((t) => <button key={t} className={`chip${s.tags.includes(t) ? " on" : ""}`} aria-pressed={s.tags.includes(t)} onClick={() => set({ tags: toggle(s.tags, t) })}>{t}</button>)}
      </div>
      <div className="chips">
        {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <button key={k} className={`chip kind${s.kinds.includes(k) ? " on" : ""}`} aria-pressed={s.kinds.includes(k)} onClick={() => set({ kinds: toggle(s.kinds, k) })}>{KIND_LABEL[k]}</button>)}
      </div>
      <label className="switch"><input type="checkbox" checked={s.searchNon} onChange={(e) => set({ searchNon: e.target.checked })} /><i /><span>Include results on other paths</span></label>
      {(q.trim() || s.tags.length > 0) && (
        <div className="counts" data-testid="counts"><span>All <b>{pool.length}</b></span>
          {Object.entries(counts).map(([k, n]) => <span key={k}>{KIND_LABEL[k as Kind]} <b>{n}</b></span>)}</div>
      )}
      <div className="results" data-testid="results">
        {!q.trim() && !s.tags.length && <p className="note">Type a term, or pick a filter. Cards that do not match are grayed out on the page.</p>}
        {shown.act.map((d, i) => row(d, i, false))}
        {shown.rest.map((d, i) => row(d, i, true))}
        {(q.trim() || s.tags.length > 0) && !pool.length && <p className="note">No matches.</p>}
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const { s, g, go, set } = useApp();
  const label = (l: Loc) => l.kind === "flow" ? `${l.page}${l.node ? " · " + l.node.split(":")[1] : ""}` : l.kind === "doc" ? l.code : "Whole guideline";
  const sub = (l: Loc) => l.kind === "flow" ? g.bundle.pages[l.page].title ?? "" : l.kind === "doc" ? g.bundle.docs[l.code]?.title ?? "" : "";
  return (
    <div className="lv">
      <h2>History</h2>
      <h4>Pages visited</h4>
      {[...s.hist].map((l, i) => ({ l, i })).reverse().map(({ l, i }) => (
        <button key={i} className={`toc-item${i === s.hpos ? " on" : ""}`} onClick={() => { go(l); }}><code>{label(l)}</code><span>{sub(l)}</span></button>
      ))}
      <h4>Guided walk</h4>
      {!s.walk ? <p className="note">No walk yet. Use <b>Start guided walk</b> on a card.</p> : s.walk.path.map((st, i) => (
        <button key={i} className="toc-item" onClick={() => { go({ kind: "flow", page: st.node.split(":")[0], node: st.node.endsWith(":START") ? undefined : st.node }); set({ rightTab: "walk" }); }}>
          <code>{i + 1}</code><span>{st.node.endsWith(":START") ? "Page entry" : (g.parsed.get(st.node)?.plain ?? st.node).slice(0, 70)}<em> · {st.by}</em></span>
        </button>
      ))}
    </div>
  );
}
