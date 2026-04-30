import { CommandDock } from "./components/CommandDock";
import { EventStrip } from "./components/EventStrip";
import { FocusPanel } from "./components/FocusPanel";
import { Minimap } from "./components/Minimap";
import { UniverseCanvas } from "./components/UniverseCanvas";

export default function App() {
  return (
    <main className="app-shell">
      <UniverseCanvas />

      <header className="top-bar" aria-label="Mind Atlas status">
        <div>
          <p className="eyebrow">Mind Atlas</p>
          <h1>AI Work Space</h1>
        </div>
        <div className="top-stats" aria-label="workspace summary">
          <span>4 work areas</span>
          <span>1 needs review</span>
          <span>2 resonances</span>
        </div>
      </header>

      <Minimap />
      <FocusPanel />
      <EventStrip />
      <CommandDock />
    </main>
  );
}
