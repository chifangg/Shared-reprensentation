import {
  Cpu,
  Database,
  Eye,
  FileText,
  GitCompare,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Network,
  Plug,
  Search,
  Tag,
  Users,
  Workflow,
  Wrench,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

/**
 * The fixed icon vocabulary the capability scan picks from (see the `icon`
 * enum in capability_input_schema, backend/src/diagram/tools.rs). One
 * cohesive line-art family so the picklist always reads as a set — keep
 * these keys in sync with that enum.
 */
const ICONS: Record<string, LucideIcon> = {
  structure: Network,
  dataflow: Workflow,
  ui: LayoutDashboard,
  logic: Cpu,
  integration: Plug,
  config: Wrench,
  data: Database,
  content: FileText,
  conversation: MessageSquare,
  compare: GitCompare,
  view: Eye,
  people: Users,
  browse: Search,
  annotation: Tag,
  other: MoreHorizontal,
};

/**
 * Ordered keyword → glyph rules used when the scan didn't supply a usable
 * `icon` (older backend binary, or the model left it blank). Every glyph
 * here is one of the vocabulary above, so the fallback stays inside the
 * same cohesive set. First hit on the capability's label+caption text
 * wins — put the more specific words before the generic ones.
 */
const KEYWORD_RULES: [RegExp, LucideIcon][] = [
  [/\b(compar|versus|vs\b|diff|side[- ]?by)/, GitCompare],
  [/\b(annotat|tag|label|code(book)?|categor)/, Tag],
  [/\b(chat|conversation|message|reply|replay|transcript|log)/, MessageSquare],
  [/\b(participant|user|people|member|author|profile)/, Users],
  [/\b(dataset|data|record|table|store|database|persist)/, Database],
  [/\b(browse|explore|search|filter|find|catalog|library|query)/, Search],
  [/\b(preview|inspect|display|gallery|render|show|view)/, Eye],
  [/\b(integrat|connect|api|plugin|webhook|sync|import|export)/, Plug],
  [/\b(setting|config|setup|option|preference|tool)/, Wrench],
  [/\b(flow|pipeline|process|stream|stage)/, Workflow],
  [/\b(ui|screen|page|layout|dashboard|panel|board|nav|menu)/, LayoutDashboard],
  [/\b(logic|engine|compute|algorithm|model|infer)/, Cpu],
  [/\b(content|article|section|text|document|book|read)/, FileText],
  [/\b(structure|architect|module|component|graph|map)/, Network],
];

function inferFromText(text: string): LucideIcon | null {
  const lower = text.toLowerCase();
  for (const [re, icon] of KEYWORD_RULES) {
    if (re.test(lower)) return icon;
  }
  return null;
}

/**
 * Resolve the glyph for a capability. Prefers the scan-supplied `key` when
 * it's a real (non-`other`) enum value; otherwise infers from the label +
 * caption text, and only then falls back to the neutral "other" glyph.
 * Everything stays within one cohesive icon family.
 */
export function capabilityIcon(
  key: string | undefined,
  text?: string,
): LucideIcon {
  if (key && key !== "other" && ICONS[key]) return ICONS[key];
  if (text) return inferFromText(text) ?? ICONS.other;
  return ICONS.other;
}
