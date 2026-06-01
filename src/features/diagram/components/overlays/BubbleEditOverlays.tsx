import type { DiagramBlock } from "../../types";
import type { FileEntry } from "@/core/project";
import type {
  BubbleAppearanceTarget,
  BubbleDetailTarget,
} from "../../hooks/useBubbleEditOverlays";
import { CapabilityDetailCard } from "./CapabilityDetailCard";
import { AppearanceCard } from "./AppearanceCard";

/**
 * Renders whichever bubble-drill-in editor is open: the per-function
 * capability detail card or the per-surface appearance card.
 *
 * Pure presentation and wiring. The open/close state lives in
 * useBubbleEditOverlays; the code-write dispatch is handed back through
 * the onConfirm callbacks so this component stays free of the bus.
 */
export function BubbleEditOverlays({
  blocks,
  files,
  detail,
  appearance,
  onCloseDetail,
  onCloseAppearance,
  onConfirmDetail,
  onConfirmAppearance,
}: {
  blocks: DiagramBlock[];
  files: FileEntry[];
  detail: BubbleDetailTarget | null;
  appearance: BubbleAppearanceTarget | null;
  onCloseDetail: () => void;
  onCloseAppearance: () => void;
  onConfirmDetail: (blockId: string, instruction: string) => void;
  onConfirmAppearance: (blockId: string, instruction: string) => void;
}) {
  return (
    <>
      {detail &&
        (() => {
          const block = blocks.find((b) => b.id === detail.blockId);
          if (!block) return null;
          const detailFiles = (block.provenance?.files ?? [])
            .map((p) => files.find((f) => f.path === p))
            .filter((f): f is NonNullable<typeof f> => !!f)
            .map((f) => ({ path: f.path, content: f.content }));
          return (
            <CapabilityDetailCard
              key={`${detail.blockId}:${detail.functionName}`}
              functionName={detail.functionName}
              displayLabel={detail.displayLabel}
              blockLabel={block.label}
              files={detailFiles}
              anchor={{ x: detail.x, y: detail.y }}
              onClose={onCloseDetail}
              onConfirm={(instruction) =>
                onConfirmDetail(detail.blockId, instruction)
              }
            />
          );
        })()}
      {appearance &&
        (() => {
          const block = blocks.find((b) => b.id === appearance.blockId);
          if (!block) return null;
          return (
            <AppearanceCard
              blockLabel={block.label}
              onClose={onCloseAppearance}
              onConfirm={(instruction) =>
                onConfirmAppearance(appearance.blockId, instruction)
              }
            />
          );
        })()}
    </>
  );
}
