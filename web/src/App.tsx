import { useApp } from "./store";
import { Canvas } from "./components/Canvas";
import { Dock } from "./components/Dock";
import { DocView } from "./components/DocView";
import { MapView } from "./components/MapView";
import { Help, Rail, TitleBar, Welcome } from "./components/Chrome";
import { HistoryPanel, SearchPanel, Toc } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { CanvasHint } from "./components/Guide";

export function App() {
  const { s, bundle, set, isPhone } = useApp();
  const l = s.loc;
  return (
    <div className={`app${s.left ? " left-open" : ""}${s.sheet ? " sheet-open" : ""}${s.dock ? " dock-open" : ""}`} data-phone={isPhone}>
      <Rail />
      <aside className="left" aria-label="Side panel">
        {s.left === "toc" && <Toc />}
        {s.left === "search" && <SearchPanel />}
        {s.left === "hist" && <HistoryPanel />}
        {isPhone && s.left && <button className="scrim" aria-label="Close panel" onClick={() => set({ left: null })} />}
      </aside>
      <main className="stage">
        <TitleBar />
        <div className="view">
          {l.kind === "flow" && <Canvas key={l.page} page={l.page} />}
          {l.kind === "doc" && <DocView code={l.code} sub={l.sub} />}
          {l.kind === "map" && <MapView />}
          <CanvasHint />
        </div>
        <Dock />
      </main>
      <aside className="right" aria-label="Details">
        <RightPanel />
      </aside>
      {isPhone && !s.sheet && l.kind !== "map" && (
        <button className="sheet-open-btn" onClick={() => set({ sheet: true, dock: null })}>Details &amp; walk</button>
      )}
      <Help />
      <Welcome />
      <div className="sr" aria-live="polite">{bundle.title}</div>
    </div>
  );
}
