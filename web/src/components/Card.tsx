import { memo } from "react";
import { Check, FileText } from "lucide-react";
import { useSrc, type SrcTarget } from "../source";
import type { GNode } from "../lib/graph";
import type { Parsed } from "../lib/parseBox";
import { Blocks } from "./Rich";

export interface CardFlags {
  selected: boolean; answer: boolean; onPath: boolean; dim: boolean; hide: boolean;
  gray: boolean; hit: boolean; fnActive: string | null; walk: boolean; current: boolean; entry: boolean;
}

interface Props {
  node: GNode; parsed: Parsed; flags: CardFlags; style?: React.CSSProperties; measure?: boolean;
  onSelect?: () => void; onFootnote?: (letter: string) => void; src?: SrcTarget | null;
}

function CardImpl({ node, parsed, flags, style, measure, onSelect, onFootnote, src }: Props) {
  const hover = useSrc(measure ? null : src ?? null, { click: false });
  const openSrc = useSrc(measure ? null : src ?? null);
  const goto = node.role === "leaf" && parsed.blocks.length === 1 && parsed.refs.length > 0;
  const cls = ["card", flags.entry && "entry", goto && "goto", flags.selected && "selected", flags.answer && "answer", flags.onPath && "onpath",
    flags.dim && "dim", flags.hide && "hide", flags.gray && "gray", flags.hit && "hit", flags.walk && "walk", flags.current && "current",
    node.pred && "has-pred"].filter(Boolean).join(" ");
  return (
    <div className={cls} style={style} data-id={measure ? undefined : node.full} data-testid={measure ? undefined : "card"} onClick={measure ? undefined : onSelect} role={measure ? undefined : "button"} tabIndex={measure ? -1 : 0}
      onKeyDown={(e) => { if (!measure && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onSelect?.(); } }}
      aria-pressed={measure ? undefined : flags.answer} onMouseEnter={hover.onMouseEnter} onMouseLeave={hover.onMouseLeave}>
      <div className="card-body"><Blocks blocks={parsed.blocks} /></div>
      {(node.footnotes.length > 0 || node.pred || src) && (
        <div className="card-foot">
          <span className="fn-row">
            {node.footnotes.map(([l]) => (
              <button key={l} className={`fb${flags.fnActive === l ? " on" : ""}`} aria-label={`Footnote ${l}`} data-fn={l}
                onClick={(e) => { e.stopPropagation(); onFootnote?.(l); }}>{l}</button>
            ))}
          </span>
          {src && <button type="button" className="card-src" aria-label={`Open ${node.page} on the PDF page`} title="Open the source page" {...openSrc} onMouseEnter={undefined} onMouseLeave={undefined}><FileText size={12} /></button>}
        </div>
      )}
      {flags.answer && <span className="check" aria-hidden><Check size={12} strokeWidth={3} /></span>}
    </div>
  );
}
export const Card = memo(CardImpl);
