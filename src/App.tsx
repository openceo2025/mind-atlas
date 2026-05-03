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
          <h1>Spatial Notebook</h1>
        </div>
      </header>

      <Minimap />
      <FocusPanel />
    </main>
  );
}
