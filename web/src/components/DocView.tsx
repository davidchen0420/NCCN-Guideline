import { useEffect, useRef } from "react";
import { useApp } from "../store";
import { formatDoc, parseTable } from "../lib/docFormat";
import { Linked } from "./Rich";
import { terms } from "../lib/search";

function Hl({ text, q }: { text: string; q: string }) {
  const ts = terms(q).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!ts.length) return <Linked text={text} />;
  const parts = text.split(new RegExp(`(${ts.join("|")})`, "gi"));
  return <>{parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : <Linked key={i} text={p} />))}</>;
}

export function DocView({ code, sub }: { code: string; sub?: number }) {
  const { s, g, go } = useApp();
  const doc = g.bundle.docs[code];
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>(`#sec-${sub ?? 1}`);
    el?.scrollIntoView({ block: "start" });
    if (!sub) ref.current?.scrollTo({ top: 0 });
  }, [code, sub]);
  const hits = g.refIndex.get(code) ?? [];
  const pages = [...new Set(hits.map((h) => h.page))];
  const q = s.query;
  return (
    <article className="doc" ref={ref}>
      <header>
        <span className="eyebrow">{doc.kind === "principles" ? "Principles" : doc.kind === "staging" ? "Staging" : doc.kind === "discussion" ? "Discussion" : "Reference"} · {code}</span>
        <h1>{doc.title}</h1>
        {pages.length > 0 && (
          <p className="cited">Cited from {pages.map((p) => <button key={p} className="xref" onClick={() => go({ kind: "flow", page: p })}>{p}</button>)}</p>
        )}
      </header>
      {doc.pages.map((pg, i) => {
        const blocks = formatDoc(pg.text);
        return (
          <section key={i} id={`sec-${i + 1}`} className="doc-sec">
            {doc.pages.length > 1 && <div className="sec-label">Page {i + 1} of {doc.pages.length}</div>}
            {blocks.map((b, j) => {
              if (i === 0 && j === 0 && b.t === "h") return null;
              switch (b.t) {
                case "h": return <h2 key={j}>{b.text}</h2>;
                case "p": return <p key={j}><Hl text={b.text} q={q} /></p>;
                case "ul": return <ul key={j}>{b.items.map((it, k) => <li key={k}><Hl text={it.text} q={q} />{it.sub.length > 0 && <ul>{it.sub.map((x, m) => <li key={m}><Hl text={x} q={q} /></li>)}</ul>}</li>)}</ul>;
                default: return null;
              }
            })}
            {pg.tables.map((md, k) => {
              const t = parseTable(md);
              if (!t) return null;
              return (
                <div key={k} className="tbl-wrap">
                  {t.title && <div className="tbl-title">{t.title}</div>}
                  <table><thead><tr>{t.head.map((h, m) => <th key={m}>{h}</th>)}</tr></thead>
                    <tbody>{t.rows.map((r, m) => <tr key={m}>{r.map((c, n) => <td key={n}><Linked text={c} /></td>)}</tr>)}</tbody></table>
                </div>
              );
            })}
          </section>
        );
      })}
    </article>
  );
}
