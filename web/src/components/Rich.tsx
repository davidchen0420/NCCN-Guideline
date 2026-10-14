import { ExternalLink, ArrowUpRight } from "lucide-react";
import type { Block, Inline, Item } from "../lib/parseBox";
import { parseInline } from "../lib/parseBox";
import { resolveRef } from "../lib/graph";
import { useApp } from "../store";

export function Inlines({ items, stop = true }: { items: Inline[]; stop?: boolean }) {
  const { g, goRef, library } = useApp();
  return (
    <>
      {items.map((x, i) => {
        switch (x.t) {
          case "text": return <span key={i}>{x.v}</span>;
          case "or": return <span key={i} className="or-pill">or</span>;
          case "tag": return <span key={i} className={`tag tag-${x.kind}`}>{x.label}</span>;
          case "url": return <a key={i} className="ext" href={x.href} target="_blank" rel="noopener noreferrer">{x.href.replace(/^https?:\/\//, "").slice(0, 40)}<ExternalLink size={11} /></a>;
          case "ref": case "link": {
            const kind = resolveRef(g, x.code).type;
            const ok = kind !== "none" && (kind !== "external" || !!library);
            const label = x.t === "link" ? x.text : x.label;
            const cls = x.t === "link" ? "xlink" : "xref";
            if (!ok) return <span key={i} className={`${cls} dead`}>{label}</span>;
            return (
              <button key={i} className={cls} data-ref={x.code}
                onClick={(e) => { if (stop) e.stopPropagation(); goRef(x.code, x.idx); }}>
                {label}{x.t === "link" ? <span className="xcode">{x.label}<ArrowUpRight size={11} /></span> : null}
              </button>
            );
          }
        }
      })}
    </>
  );
}

function ItemView({ item }: { item: Item }) {
  return (
    <li>
      <span className="li-text"><Inlines items={item.inline} /></span>
      {item.children.length > 0 && <ul>{item.children.map((c, i) => <ItemView key={i} item={c} />)}</ul>}
    </li>
  );
}

export function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((b, i) => {
        switch (b.t) {
          case "lead": return <p key={i} className="lead"><Inlines items={b.inline} /></p>;
          case "para": return <p key={i}><Inlines items={b.inline} /></p>;
          case "or": return <div key={i} className="or-divider"><span>or</span></div>;
          case "tier": return <div key={i} className={`tier tier-${b.kind}`}>{b.label}</div>;
          case "list": return <ul key={i}>{b.items.map((it, j) => <ItemView key={j} item={it} />)}</ul>;
        }
      })}
    </>
  );
}

/** Plain running text with page references and URLs made clickable (footnotes, discussion). */
export function Linked({ text }: { text: string }) {
  return <Inlines items={parseInline(text)} stop={false} />;
}
