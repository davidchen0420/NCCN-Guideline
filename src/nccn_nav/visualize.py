"""Render the encoded guideline as a self-contained HTML viewer.

Each flow page is drawn with boxes at their original PDF positions; arrows are coloured by
evidence (both extractors agree / confirmed by image review / unsure). Boxes with a branch
condition are outlined, and hovering shows the condition and footnotes. An overview shows
how pages link to each other. Output contains guideline text, so it is written to the
private directory.

  python -m nccn_nav.visualize <private>   ->  <private>/viz/guideline_graph.html
"""
import html
import json
import re
import sys
from pathlib import Path

W, H = 792, 612  # PDF page size in points
TOP, BOTTOM = 85, 560

CSS = """
:root{--bg:#fafaf9;--panel:#fff;--ink:#1c1917;--muted:#78716c;--line:#e7e5e4;--box:#f5f5f4;
--agreed:#334155;--verified:#2563eb;--unsure:#dc2626;--pred:#16a34a;--link:#9333ea}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#0c0a09;--panel:#1c1917;
--ink:#f5f5f4;--muted:#a8a29e;--line:#292524;--box:#292524;--agreed:#cbd5e1;--verified:#60a5fa;
--unsure:#f87171;--pred:#4ade80;--link:#c084fc}}
*{box-sizing:border-box}body{margin:0;font:14px/1.4 system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{padding:16px;border-bottom:1px solid var(--line)}h1{font-size:18px;margin:0 0 4px}
.sub{color:var(--muted);font-size:13px}nav{display:flex;flex-wrap:wrap;gap:6px;padding:12px 16px}
nav button{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:6px;
padding:4px 9px;cursor:pointer;font-size:13px}nav button.on{border-color:var(--link);color:var(--link)}
main{padding:0 16px 24px}.card{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px}
svg{width:100%;height:auto;display:block}.legend{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--muted);margin:8px 0}
.legend i{display:inline-block;width:22px;height:0;border-top:2px solid;vertical-align:middle;margin-right:5px}
.node rect{fill:var(--box);stroke:var(--line)}.node.pred rect{stroke:var(--pred);stroke-width:1.6}
.node.ref rect{stroke:var(--link);stroke-dasharray:3 2}.node div{font-size:7.2px;line-height:1.18;color:var(--ink);
padding:2px 3px;overflow:hidden;height:100%}.node:hover rect{stroke:var(--link);stroke-width:2}
.e{fill:none;stroke-width:1.1}.e.agreed{stroke:var(--agreed)}.e.verified{stroke:var(--verified);stroke-dasharray:4 2}
.e.unsure{stroke:var(--unsure);stroke-dasharray:2 2}#tip{position:fixed;max-width:380px;background:var(--panel);
border:1px solid var(--line);border-radius:8px;padding:8px 10px;font-size:12px;pointer-events:none;display:none;
box-shadow:0 4px 18px rgba(0,0,0,.18);z-index:9}#tip b{display:block;margin-bottom:4px}code{font-size:11px}
.stats{font-size:12px;color:var(--muted);margin-top:6px}
"""

JS = """
const D=DATA;const nav=document.querySelector('nav');const view=document.getElementById('view');
const tip=document.getElementById('tip');
function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
function marker(id,color){return `<marker id="${id}" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0L8,4L0,8z" fill="${color}"/></marker>`}
function defs(){const cs=getComputedStyle(document.documentElement);return `<defs>${marker('m-agreed',cs.getPropertyValue('--agreed'))}${marker('m-verified',cs.getPropertyValue('--verified'))}${marker('m-unsure',cs.getPropertyValue('--unsure'))}${marker('m-link',cs.getPropertyValue('--link'))}</defs>`}
function center(b){return [(b[0]+b[2])/2,(b[1]+b[3])/2]}
function anchor(b,toward){const [cx,cy]=center(b);const dx=toward[0]-cx,dy=toward[1]-cy;
 const hw=(b[2]-b[0])/2+2,hh=(b[3]-b[1])/2+2;const s=Math.min(Math.abs(dx)>1e-6?hw/Math.abs(dx):1e9,Math.abs(dy)>1e-6?hh/Math.abs(dy):1e9);
 return [cx+dx*s,cy+dy*s]}
function showPage(p){const g=D.pages[p];const byId={};g.nodes.forEach(n=>byId[n.id]=n);
 let s=`<svg viewBox="0 ${D.top} ${D.w} ${D.bottom-D.top}">${defs()}`;
 g.edges.forEach(e=>{const a=byId[e.src],b=byId[e.dst];if(!a||!b)return;
  const p1=anchor(a.bbox,center(b.bbox)),p2=anchor(b.bbox,center(a.bbox));
  s+=`<path class="e ${e.cls}" marker-end="url(#m-${e.cls})" d="M${p1[0]},${p1[1]} L${p2[0]},${p2[1]}"/>`});
 g.nodes.forEach(n=>{const [x0,y0,x1,y1]=n.bbox;const cls='node'+(n.pred?' pred':'')+(n.links.length?' ref':'');
  s+=`<g class="${cls}" data-id="${n.id}"><rect x="${x0-2}" y="${y0-2}" width="${x1-x0+4}" height="${y1-y0+4}" rx="3"/>
  <foreignObject x="${x0-2}" y="${y0-2}" width="${x1-x0+4}" height="${y1-y0+4}"><div xmlns="http://www.w3.org/1999/xhtml">${esc(n.text)}</div></foreignObject></g>`});
 s+='</svg>';const c=g.counts;
 view.innerHTML=`<div class="card"><b>${p}</b>${s}<div class="stats">${g.nodes.length} boxes · ${g.edges.length} arrows (${c.agreed||0} both extractors, ${c.verified||0} image-confirmed, ${c.unsure||0} unsure) · ${g.nodes.filter(n=>n.pred).length} boxes with branch conditions</div></div>`;
 view.querySelectorAll('.node').forEach(el=>{const n=byId[el.dataset.id];
  el.onmouseenter=()=>{let h=`<b>${esc(p)}:${esc(n.id)}</b>${esc(n.text)}`;
   if(n.pred)h+=`<div style="margin-top:6px;color:var(--pred)">Condition: <code>${esc(JSON.stringify(n.pred))}</code></div>`;
   n.footnotes.forEach(f=>h+=`<div style="margin-top:4px;color:var(--muted)"><sup>${esc(f[0])}</sup> ${esc(f[1].slice(0,260))}</div>`);
   if(n.links.length)h+=`<div style="margin-top:4px;color:var(--link)">→ ${n.links.map(esc).join(', ')}</div>`;
   tip.innerHTML=h;tip.style.display='block'};
  el.onmousemove=ev=>{tip.style.left=Math.min(ev.clientX+14,innerWidth-400)+'px';tip.style.top=(ev.clientY+14)+'px'};
  el.onmouseleave=()=>tip.style.display='none';
  el.onclick=()=>{const l=n.links.find(x=>D.pages[x]);if(l)select(l)}})}
function showOverview(){const ps=Object.keys(D.pages);const cols=6,cw=130,rh=90;const pos={};
 ps.forEach((p,i)=>pos[p]=[20+(i%cols)*cw,30+Math.floor(i/cols)*rh]);
 const extra=[...new Set(D.links.map(l=>l[1]).filter(x=>!pos[x]))].sort();
 extra.forEach((p,i)=>pos[p]=[20+(i%cols)*cw,40+(Math.ceil(ps.length/cols))*rh+Math.floor(i/cols)*50]);
 const h=Math.max(...Object.values(pos).map(v=>v[1]))+50;
 let s=`<svg viewBox="0 0 ${cols*cw+20} ${h}">${defs()}`;
 D.links.forEach(([a,b])=>{if(!pos[a]||!pos[b]||a===b)return;const[x1,y1]=pos[a],[x2,y2]=pos[b];
  s+=`<path class="e" style="stroke:var(--link);opacity:.45" marker-end="url(#m-link)" d="M${x1+50},${y1+14} Q${(x1+x2)/2+50},${Math.min(y1,y2)-20} ${x2+50},${y2+14}"/>`});
 Object.entries(pos).forEach(([p,[x,y]])=>{const flow=!!D.pages[p];
  s+=`<g class="node${flow?' pred':' ref'}" data-p="${p}" style="cursor:${flow?'pointer':'default'}"><rect x="${x}" y="${y}" width="100" height="28" rx="5"/><foreignObject x="${x}" y="${y}" width="100" height="28"><div xmlns="http://www.w3.org/1999/xhtml" style="font-size:10px;text-align:center;padding-top:7px">${esc(p)}${flow?' · '+D.pages[p].nodes.length:''}</div></foreignObject></g>`});
 s+='</svg>';
 view.innerHTML=`<div class="card"><b>Page links</b> — decision-tree pages (green, box count shown) and the principles / other pages they refer to (purple). Click a page to open it.${s}</div>`;
 view.querySelectorAll('[data-p]').forEach(el=>{if(D.pages[el.dataset.p])el.onclick=()=>select(el.dataset.p)})}
function select(p){nav.querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.p===p));
 tip.style.display='none';p==='overview'?showOverview():showPage(p);try{localStorage.setItem('nccn-viz-page',p)}catch(e){}}
['overview',...Object.keys(D.pages)].forEach(p=>{const b=document.createElement('button');b.textContent=p==='overview'?'Overview':p;
 b.dataset.p=p;b.onclick=()=>select(p);nav.appendChild(b)});
let start='overview';try{start=localStorage.getItem('nccn-viz-page')||'overview'}catch(e){}
select(D.pages[start]||start==='overview'?start:'overview');
"""


def build(private):
    private = Path(private)
    graphs = json.loads((private / "merged_graphs.json").read_text())
    preds = json.loads((private / "predicates.json").read_text())
    notes = json.loads((private / "footnotes.json").read_text())
    pages, links = {}, set()
    order = sorted(graphs, key=lambda p: int(re.sub(r"\D", "", p)))
    for page in order:
        g = graphs[page]
        nodes = []
        for n in g["nodes"]:
            if n["kind"] != "box":
                continue
            nid = f"{page}:{n['id']}"
            nodes.append({"id": n["id"], "text": n["text"], "bbox": n["bbox"], "pred": preds.get(nid),
                          "links": n.get("links", []),
                          "footnotes": [[r, notes[r]] for r in n.get("footnote_refs", []) if r in notes]})
            for link in n.get("links", []):
                target = re.sub(r"\s.*", "", link)
                if target != page:
                    links.add((page, target))
        ids = {n["id"] for n in nodes}
        edges, counts = [], {}
        for e in g["edges"]:
            if e["src"] not in ids or e["dst"] not in ids:
                continue
            sup = e.get("support", "agreed")
            cls = "unsure" if "unsure" in sup else ("verified" if "verified" in sup else "agreed")
            counts[cls] = counts.get(cls, 0) + 1
            edges.append({"src": e["src"], "dst": e["dst"], "cls": cls})
        pages[page] = {"nodes": nodes, "edges": edges, "counts": counts}
    data = {"pages": pages, "links": sorted(links), "w": W, "top": TOP, "bottom": BOTTOM}
    total_nodes = sum(len(p["nodes"]) for p in pages.values())
    total_edges = sum(len(p["edges"]) for p in pages.values())
    legend = ('<div class="legend"><span><i style="border-color:var(--agreed)"></i>arrow found by both extractors</span>'
              '<span><i style="border-color:var(--verified);border-top-style:dashed"></i>confirmed by image review</span>'
              '<span><i style="border-color:var(--unsure);border-top-style:dotted"></i>unsure</span>'
              '<span><i style="border-color:var(--pred)"></i>box has a branch condition</span>'
              '<span><i style="border-color:var(--link);border-top-style:dashed"></i>box refers to another page (click)</span></div>')
    doc = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
           f'<title>Prostate Guideline Graph</title><style>{CSS}</style></head><body>'
           f'<header><h1>NCCN Prostate (v6.2026) — encoded decision graph</h1>'
           f'<div class="sub">{len(pages)} decision-tree pages · {total_nodes} boxes · {total_edges} arrows · '
           f'hover a box for its condition and footnotes. Private: contains licensed guideline content.</div>{legend}</header>'
           f'<nav></nav><main id="view"></main><div id="tip"></div>'
           f'<script>const DATA={json.dumps(data)};{JS}</script></body></html>')
    out = private / "viz" / "guideline_graph.html"
    out.parent.mkdir(exist_ok=True)
    out.write_text(doc)
    return out, total_nodes, total_edges


if __name__ == "__main__":
    path, n, e = build(sys.argv[1] if len(sys.argv) > 1 else "private")
    print(path, n, "boxes", e, "arrows")
