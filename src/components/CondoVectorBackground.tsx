import housesJson from "@/data/houses.json";
import { MAP_SIZE, pointsOfInterest, roadEdges, roadNodes, type Point } from "@/data/map";

type HouseRecord = {
  id: string;
  label: string;
  quadra: string;
  numero: number;
  x: number;
  y: number;
};

const houses = housesJson as HouseRecord[];
const nodeIndex = new Map(roadNodes.map((node) => [node.id, node]));
const blockOrder = "ABCDEFGHIJKL".split("");

function convexHull(points: Point[]) {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: Point, a: Point, b: Point) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: Point[] = [];
  sorted.forEach((item) => {
    while (lower.length >= 2 && cross(lower.at(-2)!, lower.at(-1)!, item) <= 0) lower.pop();
    lower.push(item);
  });
  const upper: Point[] = [];
  [...sorted].reverse().forEach((item) => {
    while (upper.length >= 2 && cross(upper.at(-2)!, upper.at(-1)!, item) <= 0) upper.pop();
    upper.push(item);
  });
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

function expandedHull(points: Point[], padding = 14) {
  const hull = convexHull(points);
  const center = {
    x: hull.reduce((total, point) => total + point.x, 0) / hull.length,
    y: hull.reduce((total, point) => total + point.y, 0) / hull.length,
  };
  return hull.map((point) => {
    const distance = Math.hypot(point.x - center.x, point.y - center.y) || 1;
    return {
      x: point.x + ((point.x - center.x) / distance) * padding,
      y: point.y + ((point.y - center.y) / distance) * padding,
    };
  });
}

function Tree({ x, y, size = 6 }: { x: number; y: number; size?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <circle cy="1.5" r={size + 1} fill="#0f172a" opacity=".1" />
      <circle r={size} fill="#34d399" stroke="#059669" strokeWidth="1" />
      <circle cx={-size * .28} cy={-size * .3} r={size * .28} fill="#86efac" opacity=".9" />
    </g>
  );
}

function Label({ x, y, children, width = 48 }: { x: number; y: number; children: string; width?: number }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <rect x={-width / 2} y="-8" width={width} height="16" rx="8" fill="#0f766e" />
      <text textAnchor="middle" dominantBaseline="central" fill="white" fontSize="6" fontWeight="800">
        {children}
      </text>
    </g>
  );
}

const perimeterTrees = [
  [105, 350], [98, 385], [96, 420], [96, 457], [96, 494], [97, 531],
  [100, 566], [100, 603], [1084, 225], [1085, 262], [1086, 300], [1087, 339],
  [1088, 378], [1088, 418], [1088, 458], [1088, 500], [1088, 542], [1086, 584],
  [1020, 647], [1045, 645], [1070, 638],
] as const;

export default function CondoVectorBackground() {
  return (
    <g className="vector-map-background" aria-hidden="true" fontFamily="Inter, Arial, sans-serif">
      <defs>
        <pattern id="coordinate-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#cbd5e1" strokeWidth=".55" />
        </pattern>
        <filter id="map-shadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow dx="1.5" dy="2" stdDeviation="1.8" floodColor="#0f172a" floodOpacity=".12" />
        </filter>
      </defs>

      <rect width={MAP_SIZE.width} height={MAP_SIZE.height} fill="#f8fafc" />
      <rect width={MAP_SIZE.width} height={MAP_SIZE.height} fill="url(#coordinate-grid)" opacity=".38" />

      <path
        d="M 75 665 L 75 360 L 105 310 L 485 157 L 545 58 L 922 58 L 1100 157 L 1102 665 Z"
        fill="#f0fdf4"
        stroke="#94a3b8"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      <g className="vector-roads">
        {roadEdges.map((edge) => {
          const start = nodeIndex.get(edge.a)!;
          const end = nodeIndex.get(edge.b)!;
          return <line key={`curb-${edge.a}-${edge.b}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#cbd5e1" strokeWidth="44" strokeLinecap="round" />;
        })}
        {roadEdges.map((edge) => {
          const start = nodeIndex.get(edge.a)!;
          const end = nodeIndex.get(edge.b)!;
          return <line key={`road-${edge.a}-${edge.b}`} x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="#e2e8f0" strokeWidth="36" strokeLinecap="round" />;
        })}
      </g>

      <g className="vector-blocks">
        {blockOrder.map((quadra) => {
          const group = houses.filter((house) => house.quadra === quadra);
          const points = expandedHull(group.map(({ x, y }) => ({ x, y })));
          const xs = group.map((house) => house.x);
          const ys = group.map((house) => house.y);
          const minX = Math.min(...xs);
          const maxX = Math.max(...xs);
          const minY = Math.min(...ys);
          const maxY = Math.max(...ys);
          const narrowBlock = maxX - minX < 8 || maxY - minY < 8;
          const centerX = group.reduce((total, house) => total + house.x, 0) / group.length;
          const badge = quadra === "G" ? { x: 310, y: 166 } : { x: centerX, y: minY - 24 };
          return (
            <g key={quadra}>
              {narrowBlock ? (
                <rect
                  x={minX - 16}
                  y={minY - 16}
                  width={maxX - minX + 32}
                  height={maxY - minY + 32}
                  rx="13"
                  fill="white"
                  stroke="#94a3b8"
                  strokeWidth="1.4"
                />
              ) : (
                <polygon
                  points={points.map((point) => `${point.x},${point.y}`).join(" ")}
                  fill="white"
                  stroke="#94a3b8"
                  strokeWidth="1.4"
                  strokeLinejoin="round"
                />
              )}
              <Label x={badge.x} y={badge.y}>{`QUADRA ${quadra}`}</Label>
            </g>
          );
        })}
      </g>

      <g className="vector-houses" filter="url(#map-shadow)">
        {houses.map((house) => {
          const horizontal = house.quadra === "K" || house.quadra === "L";
          const diagonal = house.quadra === "G";
          const width = horizontal ? 18 : 29;
          const height = horizontal ? 28 : 17;
          const shortLabel = `${house.quadra}${house.numero}`;
          return (
            <g key={house.id} transform={`rotate(${diagonal ? -19 : 0} ${house.x} ${house.y})`}>
              <rect
                x={house.x - width / 2}
                y={house.y - height / 2}
                width={width}
                height={height}
                rx="2.8"
                fill="#ffffff"
                stroke="#64748b"
                strokeWidth="1"
              />
              <rect x={house.x - width / 2 + 2} y={house.y - height / 2 + 2} width="3" height={height - 4} rx="1.5" fill="#14b8a6" opacity=".38" />
              <text x={house.x} y={house.y + .5} textAnchor="middle" dominantBaseline="central" fill="#0f172a" fontSize="5.4" fontWeight="750">
                {shortLabel}
              </text>
            </g>
          );
        })}
      </g>

      <g className="vector-common-area">
        <rect x="548" y="72" width="380" height="105" rx="20" fill="#dcfce7" stroke="#86efac" strokeWidth="1.5" />

        <rect x="741" y="82" width="52" height="34" rx="8" fill="#38bdf8" stroke="#0284c7" strokeWidth="1.2" />
        <path d="M 750 99 Q 758 90 766 99 T 783 99" fill="none" stroke="#e0f2fe" strokeWidth="1.5" />
        <text x="767" y="126" textAnchor="middle" fill="#075985" fontSize="6" fontWeight="800">PISCINA</text>

        <rect x="654" y="100" width="53" height="44" rx="5" fill="#4ade80" stroke="#15803d" strokeWidth="1.2" />
        <rect x="660" y="106" width="41" height="32" fill="none" stroke="white" strokeWidth="1" />
        <line x1="680.5" y1="106" x2="680.5" y2="138" stroke="white" strokeWidth=".8" />
        <circle cx="680.5" cy="122" r="7" fill="none" stroke="white" strokeWidth=".8" />
        <text x="680" y="154" textAnchor="middle" fill="#166534" fontSize="6" fontWeight="800">QUADRA</text>

        <rect x="612" y="100" width="34" height="39" rx="6" fill="#fde68a" stroke="#ca8a04" strokeWidth="1.1" />
        <line x1="629" y1="105" x2="629" y2="134" stroke="white" strokeWidth="1" />
        <text x="629" y="151" textAnchor="middle" fill="#854d0e" fontSize="6" fontWeight="800">VÔLEI</text>

        <circle cx="585" cy="144" r="15" fill="#fb923c" stroke="#c2410c" strokeWidth="1.2" />
        <path d="M 575 142 L 585 133 L 595 142" fill="none" stroke="white" strokeWidth="2" />
        <text x="585" y="169" textAnchor="middle" fill="#9a3412" fontSize="6" fontWeight="800">QUIOSQUE</text>

        <rect x="810" y="88" width="58" height="48" rx="7" fill="#f1f5f9" stroke="#64748b" strokeWidth="1.2" />
        <path d="M 820 101 H 858 M 820 111 H 858 M 820 121 H 848" stroke="#94a3b8" strokeWidth="1" />
        <text x="839" y="146" textAnchor="middle" fill="#334155" fontSize="6" fontWeight="800">CLUBE SOCIAL</text>

        <rect x="875" y="105" width="37" height="35" rx="6" fill="#ccfbf1" stroke="#0f766e" strokeWidth="1.1" />
        <path d="M 883 132 V 113 M 893 132 V 110 M 903 132 V 115" stroke="#0f766e" strokeWidth="1.4" />
        <text x="893" y="151" textAnchor="middle" fill="#115e59" fontSize="6" fontWeight="800">ACADEMIA</text>

        <rect x="850" y="153" width="72" height="22" rx="4" fill="#f8fafc" stroke="#94a3b8" strokeWidth="1" />
        {[858, 871, 884, 897, 910].map((x) => <line key={x} x1={x} y1="156" x2={x - 5} y2="172" stroke="#94a3b8" strokeWidth=".8" />)}
      </g>

      <g className="vector-landscape">
        {perimeterTrees.map(([x, y], index) => <Tree key={index} x={x} y={y} size={index % 3 === 0 ? 7 : 6} />)}
        {[[558, 92], [581, 86], [604, 82], [720, 82], [800, 78], [878, 78], [908, 88], [915, 125]].map(([x, y], index) => <Tree key={`common-${index}`} x={x} y={y} size={6} />)}
      </g>

      <g fill="#64748b" fontSize="6.2" fontWeight="800">
        <text x="570" y="191">RUA 2</text>
        <text x="570" y="584">RUA 3</text>
        {[[934, "RUA 4"], [828, "RUA 5"], [720, "RUA 6"], [615, "RUA 7"], [507, "RUA 8"], [399, "RUA 9"], [293, "RUA 10"], [188, "RUA 11"]].map(([x, label]) => (
          <text key={String(label)} x={Number(x)} y="410" textAnchor="middle" transform={`rotate(-90 ${x} 410)`}>{label}</text>
        ))}
      </g>

      <g transform="translate(1014 180)">
        <circle r="12" fill="#f97316" stroke="white" strokeWidth="3" />
        <path d="M -4 1 L -4 -5 L 4 -5 L 4 5 L -1 5" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" />
      </g>
      <Label x={1060} y={180} width={62}>PORTARIA</Label>

      {pointsOfInterest.map((poi) => (
        <circle key={poi.id} cx={poi.x} cy={poi.y} r="2.2" fill="#0f766e" opacity=".65" />
      ))}

      <g transform="translate(87 72)">
        <rect width="250" height="47" rx="14" fill="white" stroke="#cbd5e1" />
        <circle cx="22" cy="23.5" r="13" fill="#0f766e" />
        <text x="22" y="24" textAnchor="middle" dominantBaseline="central" fill="white" fontSize="6.5" fontWeight="900">JP</text>
        <text x="45" y="19" fill="#0f172a" fontSize="9" fontWeight="900">MAPA VETORIAL</text>
        <text x="45" y="34" fill="#0f766e" fontSize="5.5" fontWeight="800">ORIENTAÇÃO POR COORDENADAS X/Y</text>
      </g>

      <g transform="translate(805 649)">
        <rect width="292" height="32" rx="11" fill="white" stroke="#cbd5e1" />
        <text x="146" y="17" textAnchor="middle" dominantBaseline="central" fill="#64748b" fontSize="6.2" fontWeight="700">
          Representação funcional independente • sem escala técnica
        </text>
      </g>
    </g>
  );
}

