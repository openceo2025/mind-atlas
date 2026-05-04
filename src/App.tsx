import { FocusPanel } from "./components/FocusPanel";
import { Download, MoreHorizontal, Upload } from "lucide-react";
import { ChangeEvent, useEffect, useState } from "react";
import { Minimap } from "./components/Minimap";
import { UniverseCanvas } from "./components/UniverseCanvas";
import { UNIVERSE_BACKGROUND_INTERACTION_EVENT } from "./events";
import { findNodePath, useAtlasStore } from "./store/atlasStore";
import type { AtlasNode } from "./types";

export default function App() {
  const atlasRoot = useAtlasStore((state) => state.atlasRoot);
  const selectedNodeId = useAtlasStore((state) => state.selectedNodeId);
  const focusNode = useAtlasStore((state) => state.focusNode);
  const updateNode = useAtlasStore((state) => state.updateNode);
  const exportNotebook = useAtlasStore((state) => state.exportNotebook);
  const importNotebook = useAtlasStore((state) => state.importNotebook);
  const [menuOpen, setMenuOpen] = useState(false);
  const datasetName = atlasRoot.title && atlasRoot.title !== "Mind Atlas" ? atlasRoot.title : "Spatial Notebook";
  const selectedPath = findNodePath(atlasRoot, selectedNodeId) ?? [atlasRoot];

  useEffect(() => {
    const closeMenu = () => setMenuOpen(false);
    window.addEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
    return () => window.removeEventListener(UNIVERSE_BACKGROUND_INTERACTION_EVENT, closeMenu);
  }, []);

  const handleExport = () => {
    const blob = new Blob([exportNotebook()], { type: "application/mindatlas+json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${datasetFileName(atlasRoot.title)}.mindatlas`;
    anchor.click();
    URL.revokeObjectURL(url);
    setMenuOpen(false);
  };

  const handleImport = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        importNotebook(JSON.parse(String(reader.result)), datasetNameFromFile(file.name));
        setMenuOpen(false);
      } catch (error) {
        console.error("Notebook import failed", error);
      }
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  return (
    <main className="app-shell">
      <UniverseCanvas />

      <header className="top-bar" aria-label="Mind Atlas status">
        <div>
          <AtlasBreadcrumb path={selectedPath} onFocus={focusNode} />
          <input
            className="dataset-title-input"
            value={datasetName}
            onChange={(event) => updateNode(atlasRoot.id, { title: event.target.value || "Untitled Atlas" })}
            aria-label="Dataset name"
          />
        </div>
      </header>

      <div className="global-menu" aria-label="Atlas actions">
        <button className="icon-button" type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="Open atlas menu">
          <MoreHorizontal size={19} />
        </button>
        {menuOpen ? (
          <div className="context-menu global-context-menu">
            <button type="button" onClick={handleExport}>
              <Download size={15} /> Export
            </button>
            <label>
              <Upload size={15} /> Import
              <input type="file" accept=".mindatlas" onChange={handleImport} />
            </label>
          </div>
        ) : null}
      </div>

      <Minimap />
      <FocusPanel />
    </main>
  );
}

function AtlasBreadcrumb({ path, onFocus }: { path: AtlasNode[]; onFocus: (id: string) => void }) {
  const crumbs = compactBreadcrumb(path);

  return (
    <nav className="atlas-breadcrumb" aria-label="Atlas path">
      <button className="atlas-logo-crumb" type="button" onClick={() => onFocus(path[0].id)}>
        MindAtlas
      </button>
      {crumbs.map((crumb, index) =>
        crumb === "ellipsis" ? (
          <span key={`ellipsis-${index}`} className="breadcrumb-ellipsis">
            ...
          </span>
        ) : (
          <button key={crumb.id} type="button" onClick={() => onFocus(crumb.id)}>
            {shortCrumb(crumb.title)}
          </button>
        ),
      )}
    </nav>
  );
}

function compactBreadcrumb(path: AtlasNode[]) {
  const nodes = path.slice(1);
  if (nodes.length <= 5) return nodes;

  const first = nodes.slice(0, 2);
  const last = nodes.slice(-3);
  return [...first, "ellipsis" as const, ...last];
}

function shortCrumb(title: string) {
  const clean = title.trim() || "Untitled";
  return clean.length > 10 ? `${clean.slice(0, 10)}...` : clean;
}

function datasetFileName(name: string) {
  const baseName = name && name !== "Mind Atlas" ? name : "Spatial Notebook";
  return (
    baseName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, " ")
      .slice(0, 80) || "Untitled Atlas"
  );
}

function datasetNameFromFile(fileName: string) {
  return fileName.replace(/\.mindatlas$/i, "").trim() || "Untitled Atlas";
}
