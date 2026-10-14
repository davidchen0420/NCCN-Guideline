import { memo } from "react";
import { Check } from "lucide-react";
import type { GNode } from "../lib/graph";
import type { Parsed } from "../lib/parseBox";
import { Blocks } from "./Rich";

export interface CardFlags {
  selected: boolean; answer: boolean; onPath: boolean; dim: boolean; hide: boolean;
  gray: boolean; hit: boolean; fnActive: string | null; walk: boolean; current: boolean; entry: boolean;
}

interface Props {
  node: GNode; parsed: Parsed; flags: CardFlags; style?: React.CSSProperties; measure?: boolean;
  onSelect?: () => void; onFootnote?: (letter: string) => void;
}

function CardImpl({ node, parsed, flags, style, measure, onSelect, onFootnote }: Props) {
  const goto = node.role === "leaf" && parsed.blocks.length === 1 && parsed.refs.length > 0;
  const cls = ["card", flags.entry && "entry", goto && "goto", flags.selected && "selected", flags.answer && "answer", flags.onPath && "onpath",
    flags.dim && "dim", flags.hide && "hide", flags.gray && "gray", flags.hit && "hit", flags.walk && "walk", flags.current && "current",
    node.pred && "has-pred"].filter(Boolean).join(" ");
  return (
    <div className={cls} style={style} data-id={measure ? undefined : node.full} data-testid={measure ? undefined : "card"} onClick={measure ? undefined : onSelect} role={measure ? undefined : "button"} tabIndex={measure ? -1 : 0}
      onKeyDown={(e) => { if (!measure && (e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); onSelect?.(); } }}
      aria-pressed={measure ? undefined : flags.answer}>
      <div className="card-body"><Blocks blocks={parsed.blocks} /></div>
      {(node.footnotes.length > 0 || node.pred) && (
        <div className="card-foot">
          <span className="fn-row">
            {node.footnotes.map(([l]) => (
              <button key={l} className={`fb${flags.fnActive === l ? " on" : ""}`} aria-label={`Footnote ${l}`} data-fn={l}
                onClick={(e) => { e.stopPropagation(); onFootnote?.(l); }}>{l}</button>
            ))}
          </span>
        </div>
      )}
      {flags.answer && <span className="check" aria-hidden><Check size={12} strokeWidth={3} /></span>}
    </div>
  );
}
export const Card = memo(CardImpl);
