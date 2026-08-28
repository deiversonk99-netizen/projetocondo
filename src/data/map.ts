export type Point = { x: number; y: number };

export type MapLocation = Point & {
  id: string;
  label: string;
  type: "house" | "quadra" | "poi" | "custom";
  quadra?: string;
  numero?: number;
};

export type RoadNode = Point & { id: string };

export type RoadEdge = {
  a: string;
  b: string;
  street: string;
};

export const MAP_SIZE = { width: 1190.52, height: 841.92 };
export const INITIAL_VIEW = { x: 72, y: 58, width: 1092, height: 610 };

export const pointsOfInterest: MapLocation[] = [
  { id: "portaria", label: "Portaria", type: "poi", x: 1014, y: 180 },
  { id: "piscina", label: "Piscina", type: "poi", x: 765, y: 103 },
  { id: "clube-social", label: "Clube Social", type: "poi", x: 839, y: 119 },
  { id: "quadra-poliesportiva", label: "Quadra Poliesportiva", type: "poi", x: 679, y: 128 },
  { id: "campo-volei", label: "Campo de Vôlei de Areia", type: "poi", x: 637, y: 117 },
  { id: "quiosque", label: "Quiosque", type: "poi", x: 585, y: 146 },
  { id: "academia", label: "Academia ao Ar Livre", type: "poi", x: 893, y: 132 },
  { id: "estacionamento", label: "Estacionamento de Visitantes", type: "poi", x: 876, y: 168 },
];

export const roadNodes: RoadNode[] = [
  { id: "portaria", x: 1014, y: 180 },
  { id: "t4", x: 934, y: 196 },
  { id: "t5", x: 828, y: 196 },
  { id: "t6", x: 720, y: 196 },
  { id: "t7", x: 615, y: 196 },
  { id: "t8", x: 507, y: 221 },
  { id: "t9", x: 399, y: 262 },
  { id: "t10", x: 293, y: 306 },
  { id: "t11", x: 188, y: 381 },
  { id: "tl", x: 121, y: 410 },
  { id: "b4", x: 934, y: 580 },
  { id: "b5", x: 828, y: 580 },
  { id: "b6", x: 720, y: 580 },
  { id: "b7", x: 615, y: 580 },
  { id: "b8", x: 507, y: 580 },
  { id: "b9", x: 399, y: 580 },
  { id: "b10", x: 293, y: 580 },
  { id: "b11", x: 188, y: 580 },
  { id: "bl", x: 121, y: 580 },
];

export const roadEdges: RoadEdge[] = [
  { a: "portaria", b: "t4", street: "Rua 1" },
  { a: "t4", b: "t5", street: "Rua 2" },
  { a: "t5", b: "t6", street: "Rua 2" },
  { a: "t6", b: "t7", street: "Rua 2" },
  { a: "t7", b: "t8", street: "Rua 2" },
  { a: "t8", b: "t9", street: "Rua 2" },
  { a: "t9", b: "t10", street: "Rua 2" },
  { a: "t10", b: "t11", street: "Rua 2" },
  { a: "t11", b: "tl", street: "Rua 2" },
  { a: "t4", b: "b4", street: "Rua 4" },
  { a: "t5", b: "b5", street: "Rua 5" },
  { a: "t6", b: "b6", street: "Rua 6" },
  { a: "t7", b: "b7", street: "Rua 7" },
  { a: "t8", b: "b8", street: "Rua 8" },
  { a: "t9", b: "b9", street: "Rua 9" },
  { a: "t10", b: "b10", street: "Rua 10" },
  { a: "t11", b: "b11", street: "Rua 11" },
  { a: "tl", b: "bl", street: "Rua 11" },
  { a: "b4", b: "b5", street: "Rua 3" },
  { a: "b5", b: "b6", street: "Rua 3" },
  { a: "b6", b: "b7", street: "Rua 3" },
  { a: "b7", b: "b8", street: "Rua 3" },
  { a: "b8", b: "b9", street: "Rua 3" },
  { a: "b9", b: "b10", street: "Rua 3" },
  { a: "b10", b: "b11", street: "Rua 3" },
  { a: "b11", b: "bl", street: "Rua 3" },
];
