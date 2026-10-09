"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { usePersistentState } from "@/lib/hooks/use-persistent-state";
import { SidebarHeader, SidebarIconButton } from "./sidebar";

/**
 * The page contract (Notes Sidebars design §1/§5): after the docked main nav,
 * every page owns up to two sidebars of its own —
 *
 *   [Main nav] [Sidebar 1] [Sidebar 2 (left)?] [Content] [Sidebar 2 (right)?]
 *
 * - Sidebar 1 is always on the left and navigates (lists, folders, groups,
 *   the week).
 * - Sidebar 2 sits beside it (`sidebar2Position: 'left'` — a list you pick
 *   from, e.g. the Inbox queue) or right of the content (`'right'` — details
 *   of the selected item, e.g. a task).
 *
 * Pages just declare their sidebars; this component owns collapsing (each
 * sidebar to 0, reopened from the content header via `<SidebarToggles>`),
 * drag-resizing between min/max, and persisting both per page in
 * localStorage (`agenda.layout.<pageKey>`) — per device on purpose: a phone
 * and a desktop shouldn't share a sidebar width.
 *
 * A page with nothing for a slot leaves it out rather than padding it.
 * Below md the sidebars aren't rendered — phone pages have their own flows
 * (sidebar 1 becomes the first screen or a strip/sheet).
 */

export interface SidebarSpec {
  /** Header label (rendered uppercase). Also names the toggles. */
  label: string;
  /** Header action icons (use `SidebarIconButton`). */
  actions?: React.ReactNode;
  /** Replace the default header entirely (e.g. Notes' filter field). Pass
   *  `null` for no header. The collapse toggle is appended either way unless
   *  `header === null`. */
  header?: React.ReactNode | null;
  children: React.ReactNode;
  /** Widths in rem (13px root on md+: 23rem ≈ 300px). */
  defaultWidth: number;
  minWidth?: number;
  maxWidth?: number;
  defaultOpen?: boolean;
  /** Controlled open state (e.g. a details sidebar that opens on selection).
   *  Width still persists. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  resizable?: boolean;
  /** Extra classes on the sidebar's inner column. */
  className?: string;
}

interface SidebarState {
  open: boolean;
  width: number;
}
interface LayoutState {
  s1?: Partial<SidebarState>;
  s2?: Partial<SidebarState>;
}

interface SlotApi {
  present: boolean;
  open: boolean;
  label: string;
  setOpen: (open: boolean) => void;
}
interface PageLayoutApi {
  sidebar1: SlotApi;
  sidebar2: SlotApi & { position: "left" | "right" };
}

const NONE: SlotApi = {
  present: false,
  open: false,
  label: "",
  setOpen: () => {},
};

const PageLayoutContext = createContext<PageLayoutApi>({
  sidebar1: NONE,
  sidebar2: { ...NONE, position: "left" },
});

export function usePageLayout(): PageLayoutApi {
  return useContext(PageLayoutContext);
}

function isLayoutState(v: unknown): v is LayoutState {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const EMPTY: LayoutState = {};

export function PageLayout({
  pageKey,
  sidebar1,
  sidebar2,
  sidebar2Position = "left",
  className,
  children,
}: {
  pageKey: string;
  sidebar1?: SidebarSpec;
  sidebar2?: SidebarSpec;
  sidebar2Position?: "left" | "right";
  className?: string;
  children: React.ReactNode;
}) {
  const [stored, setStored] = usePersistentState<LayoutState>(
    `agenda.layout.${pageKey}`,
    EMPTY,
    isLayoutState,
  );

  const slot = useCallback(
    (key: "s1" | "s2", spec: SidebarSpec | undefined): SlotApi => {
      if (!spec) return NONE;
      const open = spec.open ?? stored[key]?.open ?? spec.defaultOpen ?? true;
      return {
        present: true,
        open,
        label: spec.label,
        setOpen: (next: boolean) => {
          spec.onOpenChange?.(next);
          if (spec.open === undefined) {
            setStored((prev) => ({
              ...prev,
              [key]: { ...prev[key], open: next },
            }));
          }
        },
      };
    },
    [stored, setStored],
  );

  const s1 = slot("s1", sidebar1);
  const s2 = slot("s2", sidebar2);
  const api: PageLayoutApi = {
    sidebar1: s1,
    sidebar2: { ...s2, position: sidebar2Position },
  };

  const setWidth = (key: "s1" | "s2", width: number) =>
    setStored((prev) => ({ ...prev, [key]: { ...prev[key], width } }));

  const widthOf = (key: "s1" | "s2", spec: SidebarSpec) => {
    const w = stored[key]?.width;
    const min = spec.minWidth ?? spec.defaultWidth * 0.6;
    const max = spec.maxWidth ?? spec.defaultWidth * 1.8;
    return typeof w === "number" && Number.isFinite(w)
      ? Math.min(max, Math.max(min, w))
      : spec.defaultWidth;
  };

  const renderSidebar = (
    key: "s1" | "s2",
    spec: SidebarSpec,
    api: SlotApi,
    side: "left" | "right",
  ) => (
    <DockedSidebar
      key={key}
      spec={spec}
      open={api.open}
      onCollapse={() => api.setOpen(false)}
      width={widthOf(key, spec)}
      onWidth={(w) => setWidth(key, w)}
      side={side}
    />
  );

  return (
    <PageLayoutContext.Provider value={api}>
      <div className={`flex h-full min-h-0 w-full min-w-0 ${className ?? ""}`}>
        {sidebar1 && renderSidebar("s1", sidebar1, s1, "left")}
        {sidebar2 &&
          sidebar2Position === "left" &&
          renderSidebar("s2", sidebar2, s2, "left")}
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
          {children}
        </div>
        {sidebar2 &&
          sidebar2Position === "right" &&
          renderSidebar("s2", sidebar2, s2, "right")}
      </div>
    </PageLayoutContext.Provider>
  );
}

function DockedSidebar({
  spec,
  open,
  onCollapse,
  width,
  onWidth,
  side,
}: {
  spec: SidebarSpec;
  open: boolean;
  onCollapse: () => void;
  width: number;
  onWidth: (w: number) => void;
  side: "left" | "right";
}) {
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const shown = dragWidth ?? width;
  const min = spec.minWidth ?? spec.defaultWidth * 0.6;
  const max = spec.maxWidth ?? spec.defaultWidth * 1.8;
  const resizable = spec.resizable !== false;

  const collapseIcon = side === "left" ? PanelLeftClose : PanelRightClose;
  const collapse = (
    <SidebarIconButton
      icon={collapseIcon}
      label={`Hide ${spec.label.toLowerCase()}`}
      onClick={onCollapse}
    />
  );

  return (
    <aside
      aria-label={spec.label}
      inert={!open}
      className={`relative hidden h-full flex-none overflow-hidden bg-sidebar transition-[width] duration-150 ease-out md:block ${
        open ? (side === "left" ? "border-r" : "border-l") : ""
      } border-white/6 ${dragWidth !== null ? "transition-none" : ""}`}
      style={{ width: open ? `${shown}rem` : 0 }}
    >
      <div
        className={`flex h-full flex-col ${spec.className ?? ""}`}
        style={{ width: `${shown}rem` }}
      >
        {spec.header === null ? null : spec.header !== undefined ? (
          <div className="flex h-[3.25rem] flex-none items-center gap-1 border-b border-white/6 pr-2 pl-2 touch:h-[3.75rem]">
            <div className="flex min-w-0 flex-1 items-center">
              {spec.header}
            </div>
            {collapse}
          </div>
        ) : (
          <SidebarHeader
            label={spec.label}
            actions={
              <>
                {spec.actions}
                {collapse}
              </>
            }
          />
        )}
        <div className="flex min-h-0 flex-1 flex-col">{spec.children}</div>
      </div>
      {open && resizable && (
        <ResizeHandle
          side={side}
          value={shown}
          min={min}
          max={max}
          label={spec.label}
          onDrag={setDragWidth}
          onCommit={(w) => {
            setDragWidth(null);
            onWidth(w);
          }}
        />
      )}
    </aside>
  );
}

/**
 * Drag the sidebar's outer edge (right edge of a left sidebar, left edge of a
 * right one). Also a keyboard-operable separator: ←/→ resize by 1rem,
 * Home/End jump to min/max.
 */
function ResizeHandle({
  side,
  value,
  min,
  max,
  label,
  onDrag,
  onCommit,
}: {
  side: "left" | "right";
  value: number;
  min: number;
  max: number;
  label: string;
  onDrag: (w: number) => void;
  onCommit: (w: number) => void;
}) {
  const start = useRef<{ x: number; w: number; rem: number } | null>(null);
  const latest = useRef(value);
  const clamp = (w: number) =>
    Math.round(Math.min(max, Math.max(min, w)) * 100) / 100;

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={`Resize ${label.toLowerCase()}`}
      aria-valuenow={Math.round(value * 10) / 10}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const rem =
          parseFloat(getComputedStyle(document.documentElement).fontSize) || 13;
        start.current = { x: e.clientX, w: value, rem };
        latest.current = value;
        document.body.style.cursor = "col-resize";
      }}
      onPointerMove={(e) => {
        const s = start.current;
        if (!s) return;
        const dx = (e.clientX - s.x) / s.rem;
        const next = clamp(side === "left" ? s.w + dx : s.w - dx);
        latest.current = next;
        onDrag(next);
      }}
      onPointerUp={() => {
        if (!start.current) return;
        start.current = null;
        document.body.style.cursor = "";
        onCommit(latest.current);
      }}
      onPointerCancel={() => {
        if (!start.current) return;
        start.current = null;
        document.body.style.cursor = "";
        onCommit(latest.current);
      }}
      onDoubleClick={() => onCommit(clamp(value))}
      onKeyDown={(e) => {
        const grow = side === "left" ? "ArrowRight" : "ArrowLeft";
        const shrink = side === "left" ? "ArrowLeft" : "ArrowRight";
        if (e.key === grow) onCommit(clamp(value + 1));
        else if (e.key === shrink) onCommit(clamp(value - 1));
        else if (e.key === "Home") onCommit(min);
        else if (e.key === "End") onCommit(max);
        else return;
        e.preventDefault();
      }}
      className={`group absolute inset-y-0 z-20 w-2 cursor-col-resize touch-none focus-visible:outline-none ${
        side === "left" ? "-right-1" : "-left-1"
      }`}
    >
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-transparent transition-colors group-hover:bg-sage/50 group-focus-visible:bg-sage group-active:bg-sage" />
    </div>
  );
}

/**
 * Reopen toggles for collapsed sidebars, for the page's content header. Left
 * toggles render only while their sidebar is closed; pass `side="right"` in
 * the header's trailing slot for a right-hand sidebar 2 (shown whenever it is
 * closed and present).
 */
export function SidebarToggles({ side = "left" }: { side?: "left" | "right" }) {
  const { sidebar1, sidebar2 } = usePageLayout();
  if (side === "right") {
    if (!sidebar2.present || sidebar2.position !== "right" || sidebar2.open)
      return null;
    return (
      <SidebarIconButton
        icon={PanelRightOpen}
        label={`Show ${sidebar2.label.toLowerCase()}`}
        onClick={() => sidebar2.setOpen(true)}
        className="hidden md:flex"
      />
    );
  }
  const left = [sidebar1, sidebar2.position === "left" ? sidebar2 : NONE];
  const closed = left.filter((s) => s.present && !s.open);
  if (closed.length === 0) return null;
  return (
    <div className="hidden flex-none items-center gap-0.5 md:flex">
      {closed.map((s) => (
        <SidebarIconButton
          key={s.label}
          icon={PanelLeftOpen}
          label={`Show ${s.label.toLowerCase()}`}
          onClick={() => s.setOpen(true)}
        />
      ))}
    </div>
  );
}
