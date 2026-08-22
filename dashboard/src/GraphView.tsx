import { useEffect, useMemo, useRef, useState } from "react";
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
} from "d3-force";
import type { BlastRadiusResult, GraphNode, GraphPayload } from "./types.js";
import { C, FONT_MONO } from "./theme.js";

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  type: string;
  confidence: string;
}

interface Props {
  graph: GraphPayload;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  blast: BlastRadiusResult | null;
}

const TYPE_FILTERS = ["file", "function", "class", "method"] as const;

export function GraphView({ graph, selectedId, onSelect, blast }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null);
  const nodesRef = useRef<SimNode[]>([]);
  const linksRef = useRef<SimLink[]>([]);
  const transformRef = useRef({ k: 1, x: 0, y: 0 });
  const hoverRef = useRef<SimNode | null>(null);
  const [filters, setFilters] = useState<Set<string>>(new Set(TYPE_FILTERS));
  const [showExternal, setShowExternal] = useState(false);

  const confirmedIds = useMemo(() => {
    if (!blast) return null;
    return new Set([
      blast.root.id,
      ...blast.dependents.filter((d) => d.via === "confirmed").map((d) => d.id),
    ]);
  }, [blast]);

  const ambiguousIds = useMemo(() => {
    if (!blast) return null;
    return new Set(
      blast.dependents.filter((d) => d.via === "ambiguous-only").map((d) => d.id),
    );
  }, [blast]);

  useEffect(() => {
    const visible = new Set<string>(
      graph.nodes
        .filter((n) => filters.has(n.type))
        .filter((n) => showExternal || !n.external)
        .map((n) => n.id),
    );
    const simNodes: SimNode[] = graph.nodes
      .filter((n) => visible.has(n.id))
      // All-zero initial positions put coincident nodes in a degenerate
      // force equilibrium that never moves; scatter them instead.
      .map((n) => ({
        ...n,
        x: (Math.random() - 0.5) * 400,
        y: (Math.random() - 0.5) * 300,
      }));
    const byId = new Map(simNodes.map((n) => [n.id, n]));
    const simLinks: SimLink[] = graph.edges
      .filter((e) => visible.has(e.src) && visible.has(e.dst))
      .map((e) => ({
        source: byId.get(e.src) ?? e.src,
        target: byId.get(e.dst) ?? e.dst,
        type: e.type,
        confidence: e.confidence,
      }));

    nodesRef.current = simNodes;
    linksRef.current = simLinks;

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((n) => n.id)
          .distance((l) => (l.type === "defines" ? 24 : 60))
          .strength(0.25),
      )
      .force("charge", forceManyBody().strength(-90))
      .force("collide", forceCollide<SimNode>().radius(9))
      .force("center", forceCenter(0, 0));

    simRef.current = sim;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      sim.stop();
      for (let i = 0; i < 300; i++) sim.tick();
    }
    draw();

    return () => {
      sim.stop();
      simRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, filters, showExternal]);

  function draw(): void {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    if (canvas.width !== rect.width * dpr || canvas.height !== rect.height * dpr) {
      canvas.width = Math.max(1, rect.width * dpr);
      canvas.height = Math.max(1, rect.height * dpr);
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, rect.width, rect.height);

    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const { k, x, y } = transformRef.current;
    ctx.translate(cx + x, cy + y);
    ctx.scale(k, k);

    const confirmedSet = confirmedIds;
    const flaggedSet = ambiguousIds;
    const radiusActive = blast !== null;

    ctx.lineWidth = 1;
    for (const link of linksRef.current) {
      const s = link.source as SimNode;
      const t = link.target as SimNode;
      if (typeof s === "string" || typeof t === "string") continue;

      let stroke: string = C.edgeBase;
      let dashed = false;
      let width = 1;
      if (radiusActive && confirmedSet) {
        const sIn = confirmedSet.has(s.id);
        const tIn = confirmedSet.has(t.id);
        if ((sIn && (tIn || t.id === blast?.root.id)) || (tIn && s.id === blast?.root.id)) {
          stroke = C.accent;
          width = 1.5;
        } else if (
          (flaggedSet && (flaggedSet.has(s.id) || flaggedSet.has(t.id))) ||
          s.id === blast?.root.id ||
          t.id === blast?.root.id
        ) {
          if (link.confidence === "ambiguous") {
            stroke = C.caution;
            dashed = true;
          }
        }
      }
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.setLineDash(dashed ? [4, 3] : []);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(t.x, t.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const hover = hoverRef.current;
    for (const n of nodesRef.current) {
      const inConfirmed = confirmedSet?.has(n.id) ?? false;
      const inFlagged = flaggedSet?.has(n.id) ?? false;
      const isSelected = n.id === selectedId;
      const hovered = hover?.id === n.id;

      ctx.setLineDash([]);
      if (inConfirmed) {
        ctx.fillStyle = C.accent;
        ctx.strokeStyle = C.accent;
        drawShape(ctx, n, true);
      } else if (inFlagged) {
        ctx.strokeStyle = C.caution;
        ctx.setLineDash([3, 2]);
        drawShape(ctx, n, false);
        ctx.setLineDash([]);
      } else if (isSelected) {
        ctx.strokeStyle = C.text;
        ctx.lineWidth = 1.5;
        drawShape(ctx, n, false);
        ctx.lineWidth = 1;
      } else {
        ctx.strokeStyle = hovered ? C.text : C.muted;
        drawShape(ctx, n, false);
      }

      if (isSelected || hovered || inConfirmed || inFlagged) {
        ctx.fillStyle = inFlagged ? C.caution : C.text;
        ctx.font = `10px ${FONT_MONO}`;
        ctx.fillText(n.name, n.x + 8, n.y + 3);
      }
    }

    if (hover) {
      ctx.strokeStyle = C.border;
      ctx.fillStyle = C.surface;
      const label = `${hover.name}`;
      ctx.font = `10px ${FONT_MONO}`;
      const w = ctx.measureText(label).width + 12;
      const hx = hover.x * k + cx + x;
      const hy = hover.y * k + cy + y;
      ctx.fillRect(hx + 6, hy - 20, w, 16);
      ctx.strokeRect(hx + 6, hy - 20, w, 16);
      ctx.fillStyle = C.text;
      ctx.fillText(label, hx + 12, hy - 8);
    }
  }

  function drawShape(ctx: CanvasRenderingContext2D, n: SimNode, filled: boolean): void {
    ctx.beginPath();
    switch (n.type) {
      case "file":
        ctx.rect(n.x - 7, n.y - 7, 14, 14);
        break;
      case "class":
        ctx.moveTo(n.x, n.y - 7);
        ctx.lineTo(n.x + 7, n.y);
        ctx.lineTo(n.x, n.y + 7);
        ctx.lineTo(n.x - 7, n.y);
        ctx.closePath();
        break;
      case "method":
        ctx.arc(n.x, n.y, 4, 0, Math.PI * 2);
        break;
      default:
        ctx.arc(n.x, n.y, 5.5, 0, Math.PI * 2);
    }
    if (filled) ctx.fill();
    ctx.stroke();
  }

  useEffect(() => {
    let raf = 0;
    const loop = (): void => {
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const canvas = canvasRef.current;
    const observer = new ResizeObserver(() => draw());
    if (canvas?.parentElement) observer.observe(canvas.parentElement);
    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
    // redraw on every render too (selection/blast changes)
  });

  // React registers wheel handlers passively, so preventDefault must go
  // through a native non-passive listener to block page scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent): void => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      const t = transformRef.current;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const kNew = Math.min(4, Math.max(0.2, t.k * factor));
      transformRef.current = {
        k: kNew,
        x: mx - ((mx - t.x) * kNew) / t.k,
        y: my - ((my - t.y) * kNew) / t.k,
      };
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, []);

  function pickNode(event: React.PointerEvent): SimNode | null {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const mx = event.clientX - rect.left;
    const my = event.clientY - rect.top;
    const { k, x, y } = transformRef.current;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    const gx = (mx - cx - x) / k;
    const gy = (my - cy - y) / k;

    let best: SimNode | null = null;
    let bestDist = Infinity;
    for (const n of nodesRef.current) {
      const dx = n.x - gx;
      const dy = n.y - gy;
      const d = dx * dx + dy * dy;
      if (d < bestDist) {
        bestDist = d;
        best = n;
      }
    }
    return bestDist < 144 ? best : null;
  }

  return (
    <>
      <div className="filters" role="group" aria-label="node type filters">
        {TYPE_FILTERS.map((type) => (
          <label key={type}>
            <input
              type="checkbox"
              checked={filters.has(type)}
              onChange={() =>
                setFilters((prev) => {
                  const next = new Set(prev);
                  if (next.has(type)) next.delete(type);
                  else next.add(type);
                  return next;
                })
              }
            />
            {type}
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={showExternal}
            onChange={(e) => setShowExternal(e.target.checked)}
          />
          external
        </label>
      </div>

      <div className="legend" aria-hidden="false">
        <span>
          <span className="mark node filled" /> confirmed path
        </span>
        <span>
          <span className="mark node flagged" /> ambiguous only
        </span>
        <span>
          <span className="mark" /> resolved edge
        </span>
        <span>
          <span className="mark dashed" /> ambiguous edge
        </span>
      </div>

      <canvas
        ref={canvasRef}
        aria-label="dependency graph canvas"
        style={{ cursor: hoverRef.current ? "pointer" : "default", touchAction: "none" }}
        onPointerDown={(e) => {
          const start = { x: e.clientX, y: e.clientY };
          const startTransform = { ...transformRef.current };
          const hit = pickNode(e);
          let dragged = false;
          const move = (ev: PointerEvent): void => {
            const dx = ev.clientX - start.x;
            const dy = ev.clientY - start.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) dragged = true;
            transformRef.current = {
              k: startTransform.k,
              x: startTransform.x + dx,
              y: startTransform.y + dy,
            };
            draw();
          };
          const up = (): void => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
            if (!dragged) onSelect(hit ? hit.id : null);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
        onPointerMove={(e) => {
          hoverRef.current = pickNode(e);
        }}
      />
    </>
  );

  // keep simulation reference alive for potential reheat
  void simRef;
}
