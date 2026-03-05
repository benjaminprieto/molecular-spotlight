import { useRef, useEffect, useCallback } from "react";

// --- Types ---
interface Node {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  baseSize: number;
  cluster: number; // -1 = no cluster, 0-3 = colored section
}

interface Edge {
  a: number;
  b: number;
}

// 4 section colors (HSL strings for canvas)
const SECTION_COLORS = [
  "hsl(330, 80%, 55%)", // pink
  "hsl(160, 70%, 50%)", // teal/green
  "hsl(210, 80%, 55%)", // blue
  "hsl(30, 90%, 55%)",  // orange
];

const TOTAL_NODES = 600;
const TOTAL_EDGES = 900;

// Each section is a spatial cone — define 4 center directions
const SECTION_CENTERS = [
  { x: 0.7, y: 0.5, z: 0.3 },   // upper-right-front
  { x: -0.6, y: -0.4, z: 0.5 },  // lower-left-front
  { x: -0.3, y: 0.7, z: -0.5 },  // upper-left-back
  { x: 0.5, y: -0.6, z: -0.4 },  // lower-right-back
];
const SECTION_RADIUS = 0.55; // how far from center direction a node can be to belong

function createNetwork(): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];

  // Create nodes in a sphere
  for (let i = 0; i < TOTAL_NODES; i++) {
    const phi = Math.acos(1 - 2 * (i + 0.5) / TOTAL_NODES);
    const theta = Math.PI * (1 + Math.sqrt(5)) * i;
    const r = 0.85 + Math.random() * 0.15;

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    // Assign to a spatial section if close enough to a section center
    let cluster = -1;
    let bestDist = SECTION_RADIUS;
    for (let s = 0; s < SECTION_CENTERS.length; s++) {
      const c = SECTION_CENTERS[s];
      const dist = Math.sqrt(
        (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2
      );
      if (dist < bestDist) {
        bestDist = dist;
        cluster = s;
      }
    }

    nodes.push({
      x, y, z,
      vx: (Math.random() - 0.5) * 0.001,
      vy: (Math.random() - 0.5) * 0.001,
      baseSize: 1.2 + Math.random() * 1.8,
      cluster,
    });
  }

  // Create edges
  const edges: Edge[] = [];
  const NEARBY_EDGES = Math.floor(TOTAL_EDGES * 0.50);
  const DISTANT_EDGES = Math.floor(TOTAL_EDGES * 0.35);

  for (let i = 0; i < NEARBY_EDGES; i++) {
    const a = Math.floor(Math.random() * TOTAL_NODES);
    let bestB = (a + 1) % TOTAL_NODES;
    let bestDistVal = Infinity;
    for (let attempt = 0; attempt < 10; attempt++) {
      const candidate = Math.floor(Math.random() * TOTAL_NODES);
      if (candidate === a) continue;
      const dx = nodes[a].x - nodes[candidate].x;
      const dy = nodes[a].y - nodes[candidate].y;
      const dz = nodes[a].z - nodes[candidate].z;
      const dist = dx * dx + dy * dy + dz * dz;
      if (dist < bestDistVal) {
        bestDistVal = dist;
        bestB = candidate;
      }
    }
    edges.push({ a, b: bestB });
  }

  for (let i = 0; i < DISTANT_EDGES; i++) {
    const a = Math.floor(Math.random() * TOTAL_NODES);
    let b = Math.floor(Math.random() * TOTAL_NODES);
    while (b === a) b = Math.floor(Math.random() * TOTAL_NODES);
    edges.push({ a, b });
  }

  return { nodes, edges };
}

// Animation phases
const PHASE_CELL = 0;
const PHASE_ZOOM = 1;
const PHASE_EDGES = 2;
const PHASE_COLOR = 3;

const PHASE_DURATIONS = [2000, 2000, 3000, 2500];
const PAUSE_AFTER = 4000;

// Helper: parse hsl string to rgba with alpha
function hslToRgba(hsl: string, alpha: number): string {
  return hsl.replace("hsl(", "hsla(").replace(")", `, ${alpha})`);
}

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
    if (elapsed > totalDuration + PAUSE_AFTER) {
      startTimeRef.current = timestamp;
    }

    const { nodes, edges } = networkRef.current!;
    const w = canvas.width;
    const h = canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.32;

    ctx.clearRect(0, 0, w, h);

    const rotAngle = elapsed * 0.0001;
    const cosR = Math.cos(rotAngle);
    const sinR = Math.sin(rotAngle);

    const ease = (t: number) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const ep = ease(Math.min(phaseProgress, 1));

    let scale: number;
    if (currentPhase === PHASE_CELL) {
      scale = 0.02 + ep * 0.03;
    } else if (currentPhase === PHASE_ZOOM) {
      scale = 0.05 + ep * 0.95;
    } else {
      scale = 1;
    }

    const edgeProgress = currentPhase === PHASE_EDGES ? ep : (currentPhase > PHASE_EDGES ? 1 : 0);
    
    // Color transition progress: 0 before PHASE_COLOR, 0→1 during, 1 after
    const colorProgress = currentPhase === PHASE_COLOR ? ep : (currentPhase > PHASE_COLOR ? 1 : 0);

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

        // Color edge if both nodes belong to the same cluster during color phase
        const na = nodes[a];
        const nb = nodes[b];
        if (colorProgress > 0 && na.cluster >= 0 && na.cluster === nb.cluster) {
          const color = SECTION_COLORS[na.cluster];
          ctx.strokeStyle = hslToRgba(color, 0.8 * colorProgress * individualAlpha);
          ctx.lineWidth = 2;
        } else {
          const dimEdge = 1 - colorProgress * 0.6;
          ctx.strokeStyle = `rgba(255,255,255,${0.35 * individualAlpha * dimEdge})`;
          ctx.lineWidth = 1;
        }

        ctx.beginPath();
        ctx.moveTo(pa.px, pa.py);
        ctx.lineTo(pb.px, pb.py);
        ctx.stroke();
      }
    }

    // Draw nodes
    nodes.forEach((n) => {
      const { px, py, depth, perspective } = project(n);
      const size = n.baseSize * (0.5 + perspective * 0.5) * Math.max(scale, 0.3);
      const alpha = 0.3 + (1 + depth) * 0.2;

      if (colorProgress > 0 && n.cluster >= 0) {
        const color = SECTION_COLORS[n.cluster];
        const boostedAlpha = Math.min((0.6 + (1 + depth) * 0.25) * colorProgress, 1);
        
        // Outer glow
        ctx.fillStyle = hslToRgba(color, 0.12 * colorProgress);
        ctx.beginPath();
        ctx.arc(px, py, size * 2.5, 0, Math.PI * 2);
        ctx.fill();
        
        // Bright colored node (same size)
        ctx.fillStyle = hslToRgba(color, boostedAlpha);
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
        
        // White hot center
        ctx.fillStyle = `rgba(255,255,255,${0.35 * colorProgress})`;
        ctx.beginPath();
        ctx.arc(px, py, size * 0.4, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Dim non-colored nodes during color phase
        const dimFactor = 1 - colorProgress * 0.7;
        ctx.fillStyle = `rgba(255,255,255,${Math.max(alpha * dimFactor, 0.03)})`;
        ctx.beginPath();
        ctx.arc(px, py, size, 0, Math.PI * 2);
        ctx.fill();
      }
    });

    // Glow in cell phase
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
