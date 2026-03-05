import { useRef, useEffect, useCallback } from "react";

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
const PHASE_ZOOM = 1;       // expanding into network (nodes only)
const PHASE_EDGES = 2;      // grey edges progressively connect

const PHASE_DURATIONS = [2000, 2000, 3000]; // ms per phase
const PAUSE_AFTER = 4000; // hold final state

export default function CellAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const networkRef = useRef<ReturnType<typeof createNetwork> | null>(null);
  const animRef = useRef<number>(0);
  const startTimeRef = useRef<number>(0);
  

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

    // Edge connection progress (0 in cell/zoom, 0→1 in PHASE_EDGES, 1 after)
    const edgeProgress = currentPhase === PHASE_EDGES ? ep : (currentPhase > PHASE_EDGES ? 1 : 0);

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
    if (edgeProgress > 0) {
      const visibleEdgeCount = Math.floor(edges.length * edgeProgress);
      for (let i = 0; i < visibleEdgeCount; i++) {
        const { a, b } = edges[i];
        const pa = project(nodes[a]);
        const pb = project(nodes[b]);

        const edgeAge = (edgeProgress * edges.length - i) / edges.length;
        const individualAlpha = Math.min(edgeAge * 10, 1);
        ctx.strokeStyle = `rgba(255,255,255,${0.12 * individualAlpha})`;
        ctx.lineWidth = 0.5;

        ctx.beginPath();
        ctx.moveTo(pa.px, pa.py);
        ctx.lineTo(pb.px, pb.py);
        ctx.stroke();
      }
    }

    // Draw nodes (all grey)
    nodes.forEach((n) => {
      const { px, py, depth, perspective } = project(n);
      const size = n.baseSize * (0.5 + perspective * 0.5) * Math.max(scale, 0.3);
      const alpha = 0.3 + (1 + depth) * 0.2;
      ctx.fillStyle = `rgba(255,255,255,${Math.max(alpha, 0.05)})`;
      ctx.beginPath();
      ctx.arc(px, py, size, 0, Math.PI * 2);
      ctx.fill();
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

  return (
    <div className="relative w-full h-screen bg-background overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ width: "100%", height: "100%" }}
      />
    </div>
  );
}
