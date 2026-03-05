import { useRef, useEffect, useCallback, useState } from "react";

// --- Types ---
interface Node {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  baseSize: number;
  cluster: number; // -1 = grey, 0-5 = colored pathway
}

interface Edge {
  a: number;
  b: number;
}

// Cluster colors (HSL strings for canvas)
const CLUSTER_COLORS = [
  "hsl(330, 80%, 55%)", // pink
  "hsl(160, 70%, 50%)", // teal/green
  "hsl(210, 80%, 55%)", // blue
  "hsl(30, 90%, 55%)",  // orange
  "hsl(270, 60%, 55%)", // purple
  "hsl(50, 85%, 55%)",  // yellow
];

const GREY = "rgba(255,255,255,0.15)";
const GREY_NODE = "rgba(255,255,255,0.35)";
const TOTAL_NODES = 600;
const TOTAL_EDGES = 900;
const COLORED_RATIO = 0.25;

function createNetwork(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const numColored = Math.floor(TOTAL_NODES * COLORED_RATIO);

  // Create nodes in a sphere
  for (let i = 0; i < TOTAL_NODES; i++) {
    // Fibonacci sphere for even distribution
    const phi = Math.acos(1 - 2 * (i + 0.5) / TOTAL_NODES);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = 0.85 + Math.random() * 0.15;

    const cluster = i < numColored ? Math.floor(Math.random() * CLUSTER_COLORS.length) : -1;

    nodes.push({
      x: r * Math.sin(phi) * Math.cos(theta),
      y: r * Math.sin(phi) * Math.sin(theta),
      z: r * Math.cos(phi),
      vx: (Math.random() - 0.5) * 0.001,
      vy: (Math.random() - 0.5) * 0.001,
      baseSize: 1.2 + Math.random() * 1.8,
      cluster,
    });
  }

  // Group colored nodes by cluster for spatial coherence
  const coloredIndices = nodes.map((n, i) => (n.cluster >= 0 ? i : -1)).filter((i) => i >= 0);
  // Assign clusters based on angular position for spatial grouping
  coloredIndices.forEach((idx) => {
    const n = nodes[idx];
    const angle = Math.atan2(n.y, n.x);
    const normalizedAngle = (angle + Math.PI) / (2 * Math.PI);
    n.cluster = Math.floor(normalizedAngle * CLUSTER_COLORS.length) % CLUSTER_COLORS.length;
  });

  // Create edges - prefer nearby nodes
  const edges: Edge[] = [];
  for (let i = 0; i < TOTAL_EDGES; i++) {
    const a = Math.floor(Math.random() * TOTAL_NODES);
    // Find a nearby node
    let bestB = (a + 1) % TOTAL_NODES;
    let bestDist = Infinity;
    for (let attempt = 0; attempt < 15; attempt++) {
      const candidate = Math.floor(Math.random() * TOTAL_NODES);
      if (candidate === a) continue;
      const dx = nodes[a].x - nodes[candidate].x;
      const dy = nodes[a].y - nodes[candidate].y;
      const dz = nodes[a].z - nodes[candidate].z;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDist) {
        bestDist = dist;
        bestB = candidate;
      }
    }
    edges.push({ a, b: bestB });
  }

  return { nodes, edges };
}

// Animation phases
const PHASE_CELL = 0;       // dense dot
const PHASE_ZOOM = 1;       // expanding into network (grey)
const PHASE_HIGHLIGHT = 2;  // colored pathways emerge

const PHASE_DURATIONS = [2000, 2500, 2000]; // ms per phase
const PAUSE_AFTER = 4000; // hold final state

export default function CellAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const networkRef = useRef<ReturnType<typeof createNetwork> | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  const [phase, setPhase] = useState(PHASE_CELL);

  const draw = useCallback((timestamp: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    if (!startTimeRef.current) startTimeRef.current = timestamp;
    const elapsed = timestamp - startTimeRef.current;

    // Determine phase
    let currentPhase = PHASE_CELL;
    let phaseProgress = 0;
    let cumulative = 0;
    for (let p = 0; p < PHASE_DURATIONS.length; p++) {
      if (elapsed < cumulative + PHASE_DURATIONS[p]) {
        currentPhase = p;
        phaseProgress = (elapsed - cumulative) / PHASE_DURATIONS[p];
        break;
      }
      cumulative += PHASE_DURATIONS[p];
      if (p === PHASE_DURATIONS.length - 1) {
        currentPhase = p;
        phaseProgress = 1;
      }
    }

    setPhase(currentPhase);

    const totalDuration = PHASE_DURATIONS.reduce((a, b) => a + b, 0);
    const shouldLoop = elapsed > totalDuration + PAUSE_AFTER;
    if (shouldLoop) {
      startTimeRef.current = timestamp;
    }

    const { nodes, edges } = networkRef.current!;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.32;

    ctx.clearRect(0, 0, w, h);

    // Slow rotation
    const rotAngle = elapsed * 0.0001;
    const cosR = Math.cos(rotAngle);
    const sinR = Math.sin(rotAngle);

    // Easing
    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const ep = ease(Math.min(phaseProgress, 1));

    // Scale: in PHASE_CELL, everything compressed to a dot; in PHASE_ZOOM, expands
    let scale: number;
    if (currentPhase === PHASE_CELL) {
      scale = 0.02 + ep * 0.03; // tiny dot, slightly growing
    } else if (currentPhase === PHASE_ZOOM) {
      scale = 0.05 + ep * 0.95; // expand to full
    } else {
      scale = 1;
    }

    // Highlight progress
    const highlightAlpha = currentPhase === PHASE_HIGHLIGHT ? ep : 0;

    // Project 3D → 2D
    const project = (n: Node) => {
      const rx = n.x * cosR - n.z * sinR;
      const rz = n.x * sinR + n.z * cosR;
      const perspective = 1 / (1 + rz * 0.3);
      return {
        px: cx + rx * radius * scale * perspective,
        py: cy + n.y * radius * scale * perspective,
        depth: rz,
        perspective,
      };
    };

    // Draw edges
    if (scale > 0.1) {
      const edgeOpacity = Math.min((scale - 0.1) / 0.5, 1) * 0.6;
      edges.forEach(({ a, b }) => {
        const na = nodes[a];
        const nb = nodes[b];
        const pa = project(na);
        const pb = project(nb);

        const isColored = highlightAlpha > 0 && na.cluster >= 0 && nb.cluster >= 0 && na.cluster === nb.cluster;

        if (isColored) {
          const color = CLUSTER_COLORS[na.cluster];
          ctx.strokeStyle = color.replace(")", `, ${highlightAlpha * edgeOpacity})`).replace("hsl(", "hsla(");
          ctx.lineWidth = 1.2;
        } else {
          const fade = highlightAlpha > 0 ? 1 - highlightAlpha * 0.6 : 1;
          ctx.strokeStyle = `rgba(255,255,255,${0.06 * edgeOpacity * fade})`;
          ctx.lineWidth = 0.5;
        }

        ctx.beginPath();
        ctx.moveTo(pa.px, pa.py);
        ctx.lineTo(pb.px, pb.py);
        ctx.stroke();
      });
    }

    // Draw nodes
    nodes.forEach((n) => {
      const { px, py, depth, perspective } = project(n);
      const size = n.baseSize * (0.5 + perspective * 0.5) * Math.max(scale, 0.3);

      const isColored = n.cluster >= 0 && highlightAlpha > 0;

      if (isColored) {
        const color = CLUSTER_COLORS[n.cluster];
        // Glow
        const glowSize = size * (2 + highlightAlpha * 3);
        const gradient = ctx.createRadialGradient(px, py, 0, px, py, glowSize);
        gradient.addColorStop(0, color.replace(")", `, ${highlightAlpha * 0.8})`).replace("hsl(", "hsla("));
        gradient.addColorStop(1, color.replace(")", ", 0)").replace("hsl(", "hsla("));
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(px, py, glowSize, 0, Math.PI * 2);
        ctx.fill();

        // Core
        ctx.fillStyle = color.replace(")", `, ${highlightAlpha})`).replace("hsl(", "hsla(");
        ctx.beginPath();
        ctx.arc(px, py, size * 1.3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        const fade = highlightAlpha > 0 ? 1 - highlightAlpha * 0.5 : 1;
        const alpha = (0.3 + (1 + depth) * 0.2) * fade;
        ctx.fillStyle = `rgba(255,255,255,${Math.max(alpha, 0.05)})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // In cell phase, add a soft glow around the center
    if (currentPhase === PHASE_CELL) {
      const glowRadius = radius * scale * 2.5;
      const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowRadius);
      gradient.addColorStop(0, "rgba(255,255,255,0.08)");
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(cx, cy, glowRadius, 0, Math.PI * 2);
      ctx.fill();
    }

    animRef.current = requestAnimationFrame(draw);
  }, []);

  useEffect(() => {
    networkRef.current = createNetwork();

    const canvas = canvasRef.current;
    if (!canvas) return;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.scale(dpr, dpr);
      // Reset canvas dimensions for drawing
      canvas.width = canvas.offsetWidth * dpr;
      canvas.height = canvas.offsetHeight * dpr;
    };

    resize();
    window.addEventListener("resize", resize);
    animRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener("resize", resize);
      cancelAnimationFrame(animRef.current);
    };
  }, [draw]);

  const phaseLabels = [
    "Célula individual",
    "Red de interacción proteica",
    "Vías moleculares alteradas",
  ];

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ width: "100%", height: "100%" }}
      />

      {/* Logo / Title */}
      <div className="absolute top-8 left-8 z-10 flex items-center gap-4">
        <div className="font-display">
          <span className="text-3xl font-bold tracking-tight text-foreground">Onco</span>
          <span className="text-3xl font-bold tracking-tight text-primary">METS</span>
        </div>
      </div>

      {/* Headline */}
      <div className="absolute top-8 left-48 z-10 max-w-2xl">
        <p className="text-lg md:text-xl text-foreground">
          <span className="text-primary font-semibold">Biological LLM</span>
          <span className="text-muted-foreground">
            {" "}– Unraveling cancer complexity from a complete, unified picture of the patient
          </span>
        </p>
      </div>

      {/* Phase indicator */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex gap-3">
        {phaseLabels.map((label, i) => (
          <div
            key={i}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-display transition-all duration-500 ${
              phase >= i
                ? "bg-secondary text-foreground"
                : "bg-muted/30 text-muted-foreground"
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full transition-all duration-500 ${
                phase >= i ? "bg-primary" : "bg-muted-foreground"
              }`}
            />
            {label}
          </div>
        ))}
      </div>
    </div>
  );
}
