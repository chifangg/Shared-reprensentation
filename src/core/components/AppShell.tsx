import { Group, Panel, Separator } from "react-resizable-panels";
import { ChatView } from "@/core/components/ChatView";
import {
  CodeTabs,
  CodeViewer,
  FileTree,
  HighlightToggle,
  UploadArea,
  UploadOverlay,
  useProject,
} from "@/core/project";
import { DiagramCanvas } from "@/core/diagram";

/**
 * Four-pane shell for the shared-representation prototype.
 *
 *   [ Files | Code | Chat | Diagram ]
 *
 * Files / Code / Diagram are placeholders for now. Chat wraps the
 * existing <ChatView> unchanged. Dividers between panes are draggable.
 *
 * Each panel owns a header strip in the warm-tan banner color so the
 * top of the screen reads as a continuous band across panes — see
 * wireframe.
 */
export function AppShell() {
  return (
    <div className="flex h-screen flex-col text-[#484848]">
      <UploadOverlay />
      <header className="border-b border-[#888787]/40 bg-[#D6CFC2] px-4 py-4 text-sm font-medium">
        Share Representative Tool Webpage
      </header>

      <Group orientation="horizontal" className="flex-1">
        <Panel defaultSize={12} minSize={6}>
          <FilesPanel />
        </Panel>
        <ResizeHandle />

        <Panel defaultSize={30} minSize={15}>
          <CodePanel />
        </Panel>
        <ResizeHandle />

        <Panel defaultSize={28} minSize={18}>
          <ChatView />
        </Panel>
        <ResizeHandle />

        <Panel defaultSize={30} minSize={15}>
          <DiagramPanel />
        </Panel>
      </Group>
    </div>
  );
}

function ResizeHandle() {
  return (
    <Separator className="w-px bg-white transition-colors hover:w-1 hover:bg-white/70 data-[dragging=true]:w-1 data-[dragging=true]:bg-white/70" />
  );
}

/** All panel header strips share this height + flex centering so the
 *  header band reads as one continuous row across the four panes. */
const HEADER_BASE =
  "flex h-11 items-center border-b px-3 text-sm font-medium";
/** Light header strip used by Diagram panel. (Files + Code + Chat now
 *  inline their own headers because they each carry custom controls.) */
const LIGHT_HEADER = `${HEADER_BASE} bg-[#DFDEDE]/90 text-[#484848] border-[#484848]/30`;

function FilesPanel() {
  const { files } = useProject();
  return (
    <div className="flex h-full flex-col bg-[#565656] text-white">
      <div className="flex h-11 items-center border-b border-white/30 bg-[#888888]/90 px-3 text-sm font-medium">
        Files
      </div>
      <div className="min-h-0 flex-1">
        {files.length === 0 ? <UploadArea /> : <FileTree />}
      </div>
    </div>
  );
}

function CodePanel() {
  return (
    <div className="flex h-full flex-col bg-[#292929] text-white">
      <div className="flex h-11 gap-2 border-b border-white/30 bg-[#888888] px-2 text-sm font-medium">
        <CodeTabs />
        <div className="flex items-center">
          <HighlightToggle />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <CodeViewer />
      </div>
    </div>
  );
}

function DiagramPanel() {
  return (
    <div className="flex h-full flex-col bg-[#E6E6E6] text-[#484848]">
      <div className={LIGHT_HEADER}>Diagram Block</div>
      <div className="min-h-0 flex-1">
        <DiagramCanvas />
      </div>
    </div>
  );
}
