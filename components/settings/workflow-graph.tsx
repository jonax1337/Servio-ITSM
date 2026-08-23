"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  ReactFlow, Background, BackgroundVariant, Controls, MiniMap, Panel, Handle, Position,
  useNodesState, useEdgesState, addEdge, MarkerType,
  type Node, type Edge, type Connection, type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Workflow, Loader2, Save, RotateCcw, Trash2, Info } from "lucide-react";
import { toast } from "sonner";
import { saveWorkflow, resetWorkflow } from "@/lib/actions/workflows";
import { Button } from "@/components/ui/button";
import { Combobox, type ComboOption } from "@/components/combobox";
import { ToneBadge } from "@/components/status-badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import type { Tone } from "@/lib/constants";

type StatusDef = { value: string; label: string; tone: Tone };
type Transition = { from: string; to: string; requiredRole: string | null };
type EdgeData = { role: string }; // "none" | "MANAGER" | "ADMIN"

const ROLE_OPTS: ComboOption[] = [
  { value: "none", label: "Anyone" },
  { value: "MANAGER", label: "Manager+" },
  { value: "ADMIN", label: "Admin only" },
];
const roleLabel = (r: string) => (r === "MANAGER" ? "Manager+" : r === "ADMIN" ? "Admin only" : "");
const pairKey = (from: string, to: string) => `${from}>${to}`;

// A status is a rounded node with a tone badge and connect handles on each side.
function StatusNode({ data }: NodeProps) {
  const d = data as { label: string; tone: Tone };
  return (
    <div className="rounded-xl border bg-card px-3 py-2 shadow-sm ring-1 ring-foreground/10">
      <Handle type="target" position={Position.Left} className="!size-2.5 !border-2 !bg-background" />
      <ToneBadge meta={{ label: d.label, tone: d.tone }} icon={false} />
      <Handle type="source" position={Position.Right} className="!size-2.5 !border-2 !bg-background" />
    </div>
  );
}
const nodeTypes = { status: StatusNode };

type Emphasis = "normal" | "on" | "dim";

/** Visual style for an edge given its role gate and whether it's emphasised.
 *  Dense lifecycles are calm by default and light up around the selected node. */
function styleEdge(role: string, emphasis: Emphasis): Partial<Edge> {
  const gated = !!role && role !== "none";
  // Token-based colours, mirroring the Recharts wrappers in charts.tsx:
  // --chart-5 is the theme's amber accent (gated transitions),
  // --muted-foreground the calm grey for open ones.
  const color = gated ? "var(--chart-5)" : "var(--muted-foreground)";
  // Focus mode: with a node selected, non-related edges vanish so only the
  // clicked status's transitions show — dense lifecycles read cleanly.
  const opacity = emphasis === "dim" ? 0 : emphasis === "on" ? 1 : 0.16;
  return {
    label: gated && emphasis !== "dim" ? roleLabel(role) : undefined,
    animated: gated && emphasis === "on",
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16, color },
    style: { stroke: color, strokeWidth: emphasis === "on" ? 2 : 1.5, strokeOpacity: opacity },
    labelStyle: { fontSize: 10, fill: "var(--chart-5)" },
    labelBgStyle: { fill: "var(--card)", fillOpacity: 0.9 },
  };
}

export function WorkflowGraph({
  entityType,
  entityLabel,
  statuses,
  transitions,
}: {
  entityType: string;
  entityLabel: string;
  statuses: StatusDef[];
  transitions: Transition[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <Workflow className="size-4" /> Visual builder
      </DialogTrigger>
      <DialogContent className="flex h-[94vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-w-none">
        <DialogHeader className="shrink-0 border-b px-5 py-3">
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Workflow className="size-4 text-primary" /> {entityLabel} workflow
          </DialogTitle>
        </DialogHeader>
        {/* Mount the canvas only while open so React Flow measures a real box. */}
        {open ? (
          <GraphCanvas
            entityType={entityType}
            statuses={statuses}
            transitions={transitions}
            onClose={() => setOpen(false)}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function GraphCanvas({
  entityType,
  statuses,
  transitions,
  onClose,
}: {
  entityType: string;
  statuses: StatusDef[];
  transitions: Transition[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [selected, setSelected] = useState<string | null>(null); // selected edge id
  const [activeNode, setActiveNode] = useState<string | null>(null); // focused node id

  const initialNodes: Node[] = useMemo(() => {
    // A tidy grid (4 per row) reads better than a single tangled row; nodes are
    // draggable so an admin can arrange their own lifecycle shape.
    const perRow = 4;
    return statuses.map((s, i) => ({
      id: s.value,
      type: "status",
      position: { x: (i % perRow) * 300, y: Math.floor(i / perRow) * 260 },
      data: { label: s.label, tone: s.tone },
    }));
  }, [statuses]);

  const initialEdges: Edge[] = useMemo(
    () =>
      transitions.map((t) => ({
        id: pairKey(t.from, t.to),
        source: t.from,
        target: t.to,
        data: { role: t.requiredRole ?? "none" },
      }) as Edge),
    [transitions],
  );

  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);

  // Visual layer: emphasise the focused node's transitions, dim the rest.
  const visibleEdges = useMemo(
    () =>
      edges.map((e) => {
        const role = (e.data as EdgeData | undefined)?.role ?? "none";
        const emphasis: Emphasis = !activeNode
          ? "normal"
          : e.source === activeNode || e.target === activeNode
            ? "on"
            : "dim";
        return { ...e, ...styleEdge(role, emphasis) };
      }),
    [edges, activeNode],
  );

  const onConnect = useCallback(
    (c: Connection) => {
      // Freehand: any status → any other status is allowed (no built-in floor).
      if (!c.source || !c.target || c.source === c.target) return;
      const k = pairKey(c.source, c.target);
      setEdges((eds) => {
        if (eds.some((e) => e.id === k)) return eds; // already present
        return addEdge({ id: k, source: c.source!, target: c.target!, data: { role: "none" } }, eds);
      });
    },
    [setEdges],
  );

  const setEdgeRole = (id: string, role: string) =>
    setEdges((eds) => eds.map((e) => (e.id === id ? { ...e, data: { role } } : e)));

  const removeEdge = (id: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== id));
    setSelected(null);
  };

  const selectedEdge = edges.find((e) => e.id === selected) ?? null;

  function persist(action: (fd: FormData) => Promise<void>, withTransitions: boolean) {
    const fd = new FormData();
    fd.set("entityType", entityType);
    if (withTransitions) {
      // The current edge set IS the complete allowed lifecycle.
      const out = edges.map((e) => {
        const role = (e.data as EdgeData | undefined)?.role ?? "none";
        return { fromStatus: e.source, toStatus: e.target, requiredRole: role === "none" ? null : role };
      });
      fd.set("transitions", JSON.stringify(out));
    }
    start(async () => {
      await action(fd);
      toast.success(withTransitions ? "Workflow saved" : "Reset to defaults");
      onClose();
    });
  }

  return (
    <div className="relative min-h-0 w-full flex-1 bg-[radial-gradient(circle_at_1px_1px,rgba(148,163,184,0.15)_1px,transparent_0)] [background-size:20px_20px]">
      <ReactFlow
        nodes={nodes}
        edges={visibleEdges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onEdgeClick={(_, e) => { setSelected(e.id); setActiveNode(null); }}
        onNodeClick={(_, n) => { setActiveNode(n.id); setSelected(null); }}
        onPaneClick={() => { setSelected(null); setActiveNode(null); }}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={null}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} className="!bg-transparent" />
        <Controls showInteractive={false} />
        <MiniMap pannable zoomable className="!bg-card" />

        <Panel position="top-left" className="max-w-xs rounded-lg border bg-card/90 px-3 py-2 text-xs text-muted-foreground backdrop-blur">
          <div className="flex items-start gap-2">
            <Info className="mt-0.5 size-3.5 shrink-0" />
            <span>Click a status to focus its transitions. Drag from a node&apos;s right edge to another to allow a transition. Click a line to gate it behind a role or remove it.</span>
          </div>
        </Panel>

        {selectedEdge ? (
          <Panel position="top-right" className="w-64 rounded-lg border bg-card p-3 shadow-lg">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
              <span>{statuses.find((s) => s.value === selectedEdge.source)?.label}</span>
              <span className="text-muted-foreground">→</span>
              <span>{statuses.find((s) => s.value === selectedEdge.target)?.label}</span>
            </div>
            <div className="grid gap-2">
              <div className="grid gap-1">
                <span className="text-[11px] text-muted-foreground">Who can do this</span>
                <Combobox
                  options={ROLE_OPTS}
                  value={(selectedEdge.data as EdgeData | undefined)?.role ?? "none"}
                  onChange={(v) => setEdgeRole(selectedEdge.id, v)}
                  size="sm"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => removeEdge(selectedEdge.id)}
                className="justify-start text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-4" /> Remove transition
              </Button>
            </div>
          </Panel>
        ) : null}

        <Panel position="bottom-center" className="flex items-center gap-2 rounded-lg border bg-card p-2 shadow-lg">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            disabled={pending}
            onClick={() => persist(resetWorkflow, false)}
          >
            <RotateCcw className="size-4" /> Reset
          </Button>
          <Button type="button" size="sm" disabled={pending} onClick={() => persist(saveWorkflow, true)}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save workflow
          </Button>
        </Panel>
      </ReactFlow>
    </div>
  );
}
