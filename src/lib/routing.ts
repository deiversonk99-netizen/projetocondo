import { roadEdges, roadNodes, type MapLocation, type Point } from "@/data/map";

type RouteEdge = { a: string; b: string; street: string; weight: number };

export type RouteSegment = {
  street: string;
  coordinateDistance: number;
};

export type RouteResult = {
  points: Point[];
  streets: string[];
  segments: RouteSegment[];
  coordinateDistance: number;
  origin: MapLocation;
  destination: MapLocation;
};

export type DeliveryLeg = RouteResult & {
  stopNumber: number;
};

export type DeliveryRouteResult = {
  origin: MapLocation;
  destinations: MapLocation[];
  legs: DeliveryLeg[];
  points: Point[];
  coordinateDistance: number;
  optimization: "exact" | "heuristic";
};

export const MAX_DELIVERY_STOPS = 20;
const MAX_EXACT_STOPS = 10;

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

function projectToSegment(point: Point, start: Point, end: Point) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const rawT = lengthSquared === 0 ? 0 : ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
  const t = Math.max(0, Math.min(1, rawT));
  const projected = { x: start.x + dx * t, y: start.y + dy * t };
  return { t, point: projected, distance: distance(point, projected) };
}

export function buildRoute(origin: MapLocation, destination: MapLocation): RouteResult {
  const baseNodes = new Map(roadNodes.map((node) => [node.id, { x: node.x, y: node.y }]));
  const projectionsByEdge = new Map<number, Array<{ id: string; t: number; point: Point }>>();

  const attachLocation = (location: MapLocation, role: "origin" | "destination") => {
    let best: { edgeIndex: number; t: number; point: Point; distance: number } | null = null;
    for (const [edgeIndex, edge] of roadEdges.entries()) {
      const projection = projectToSegment(location, baseNodes.get(edge.a)!, baseNodes.get(edge.b)!);
      if (!best || projection.distance < best.distance) best = { edgeIndex, ...projection };
    }
    if (!best) throw new Error("Não foi possível conectar o ponto à malha de ruas.");
    const snapId = `${role}-snap`;
    const items = projectionsByEdge.get(best.edgeIndex) ?? [];
    items.push({ id: snapId, t: best.t, point: best.point });
    projectionsByEdge.set(best.edgeIndex, items);
    return { locationId: role, snapId, snapPoint: best.point };
  };

  const originAttachment = attachLocation(origin, "origin");
  const destinationAttachment = attachLocation(destination, "destination");
  const nodes = new Map(baseNodes);
  nodes.set("origin", { x: origin.x, y: origin.y });
  nodes.set("destination", { x: destination.x, y: destination.y });
  nodes.set(originAttachment.snapId, originAttachment.snapPoint);
  nodes.set(destinationAttachment.snapId, destinationAttachment.snapPoint);

  const edges: RouteEdge[] = [];
  roadEdges.forEach((edge, edgeIndex) => {
    const start = baseNodes.get(edge.a)!;
    const end = baseNodes.get(edge.b)!;
    const splitPoints = [
      { id: edge.a, t: 0, point: start },
      ...(projectionsByEdge.get(edgeIndex) ?? []),
      { id: edge.b, t: 1, point: end },
    ].sort((a, b) => a.t - b.t);

    for (let index = 0; index < splitPoints.length - 1; index += 1) {
      const current = splitPoints[index];
      const next = splitPoints[index + 1];
      if (current.id === next.id) continue;
      edges.push({ a: current.id, b: next.id, street: edge.street, weight: distance(current.point, next.point) });
    }
  });

  edges.push({
    a: originAttachment.locationId,
    b: originAttachment.snapId,
    street: "Acesso",
    weight: distance(origin, originAttachment.snapPoint),
  });
  edges.push({
    a: destinationAttachment.locationId,
    b: destinationAttachment.snapId,
    street: "Acesso",
    weight: distance(destination, destinationAttachment.snapPoint),
  });

  const unvisited = new Set(nodes.keys());
  const distances = new Map(Array.from(nodes.keys(), (id) => [id, Number.POSITIVE_INFINITY]));
  const previous = new Map<string, { node: string; street: string; weight: number }>();
  distances.set("origin", 0);

  while (unvisited.size > 0) {
    let current: string | null = null;
    let smallest = Number.POSITIVE_INFINITY;
    unvisited.forEach((id) => {
      const value = distances.get(id)!;
      if (value < smallest) {
        smallest = value;
        current = id;
      }
    });
    if (!current || smallest === Number.POSITIVE_INFINITY) break;
    if (current === "destination") break;
    unvisited.delete(current);

    edges.forEach((edge) => {
      const neighbor = edge.a === current ? edge.b : edge.b === current ? edge.a : null;
      if (!neighbor || !unvisited.has(neighbor)) return;
      const candidate = smallest + edge.weight;
      if (candidate < distances.get(neighbor)!) {
        distances.set(neighbor, candidate);
        previous.set(neighbor, { node: current!, street: edge.street, weight: edge.weight });
      }
    });
  }

  const nodePath = ["destination"];
  const traversedEdges: Array<{ street: string; weight: number }> = [];
  while (nodePath[0] !== "origin") {
    const step = previous.get(nodePath[0]);
    if (!step) throw new Error("Não existe uma rota conectada entre os pontos selecionados.");
    traversedEdges.unshift({ street: step.street, weight: step.weight });
    nodePath.unshift(step.node);
  }

  const segments = traversedEdges.reduce<RouteSegment[]>((result, edge) => {
    if (edge.street === "Acesso") return result;
    const previousSegment = result.at(-1);
    if (previousSegment?.street === edge.street) {
      previousSegment.coordinateDistance += edge.weight;
    } else {
      result.push({ street: edge.street, coordinateDistance: edge.weight });
    }
    return result;
  }, []);

  return {
    points: nodePath.map((id) => nodes.get(id)!),
    streets: segments.map((segment) => segment.street),
    segments,
    coordinateDistance: distances.get("destination")!,
    origin,
    destination,
  };
}

function buildDistanceMatrix(locations: MapLocation[]) {
  const matrix = Array.from({ length: locations.length }, () => Array(locations.length).fill(0));
  for (let from = 0; from < locations.length; from += 1) {
    for (let to = from + 1; to < locations.length; to += 1) {
      const route = buildRoute(locations[from], locations[to]);
      matrix[from][to] = route.coordinateDistance;
      matrix[to][from] = route.coordinateDistance;
    }
  }
  return matrix;
}

function exactStopOrder(matrix: number[][], stopCount: number) {
  const stateCount = 1 << stopCount;
  const costs = Array.from({ length: stateCount }, () => Array(stopCount).fill(Number.POSITIVE_INFINITY));
  const previous = Array.from({ length: stateCount }, () => Array(stopCount).fill(-1));

  for (let stop = 0; stop < stopCount; stop += 1) {
    costs[1 << stop][stop] = matrix[0][stop + 1];
  }

  for (let mask = 1; mask < stateCount; mask += 1) {
    for (let last = 0; last < stopCount; last += 1) {
      if ((mask & (1 << last)) === 0) continue;
      const previousMask = mask ^ (1 << last);
      if (previousMask === 0) continue;

      for (let candidate = 0; candidate < stopCount; candidate += 1) {
        if ((previousMask & (1 << candidate)) === 0) continue;
        const nextCost = costs[previousMask][candidate] + matrix[candidate + 1][last + 1];
        if (nextCost < costs[mask][last]) {
          costs[mask][last] = nextCost;
          previous[mask][last] = candidate;
        }
      }
    }
  }

  const fullMask = stateCount - 1;
  let lastStop = 0;
  for (let stop = 1; stop < stopCount; stop += 1) {
    if (costs[fullMask][stop] < costs[fullMask][lastStop]) lastStop = stop;
  }

  const order: number[] = [];
  let mask = fullMask;
  while (lastStop >= 0) {
    order.unshift(lastStop);
    const nextLast = previous[mask][lastStop];
    mask ^= 1 << lastStop;
    lastStop = nextLast;
  }
  return order;
}

function heuristicStopOrder(matrix: number[][], stopCount: number) {
  const remaining = new Set(Array.from({ length: stopCount }, (_, index) => index));
  const order: number[] = [];
  let currentLocation = 0;

  while (remaining.size > 0) {
    let nearest = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    remaining.forEach((stop) => {
      const candidateDistance = matrix[currentLocation][stop + 1];
      if (candidateDistance < nearestDistance) {
        nearest = stop;
        nearestDistance = candidateDistance;
      }
    });
    order.push(nearest);
    remaining.delete(nearest);
    currentLocation = nearest + 1;
  }

  let improved = true;
  while (improved) {
    improved = false;
    for (let start = 0; start < order.length - 1; start += 1) {
      for (let end = start + 1; end < order.length; end += 1) {
        const beforeStart = start === 0 ? 0 : order[start - 1] + 1;
        const first = order[start] + 1;
        const last = order[end] + 1;
        const afterEnd = end === order.length - 1 ? null : order[end + 1] + 1;
        const currentCost = matrix[beforeStart][first] + (afterEnd === null ? 0 : matrix[last][afterEnd]);
        const reversedCost = matrix[beforeStart][last] + (afterEnd === null ? 0 : matrix[first][afterEnd]);
        if (reversedCost + 0.001 < currentCost) {
          order.splice(start, end - start + 1, ...order.slice(start, end + 1).reverse());
          improved = true;
        }
      }
    }
  }

  return order;
}

export function buildDeliveryRoute(origin: MapLocation, requestedDestinations: MapLocation[]): DeliveryRouteResult {
  if (requestedDestinations.length === 0) throw new Error("Adicione pelo menos um ponto de entrega.");
  if (requestedDestinations.length > MAX_DELIVERY_STOPS) {
    throw new Error(`Esta rota aceita até ${MAX_DELIVERY_STOPS} pontos de entrega.`);
  }

  const seen = new Set([origin.id]);
  requestedDestinations.forEach((destination) => {
    if (seen.has(destination.id)) throw new Error("Cada ponto da rota deve ser diferente.");
    seen.add(destination.id);
  });

  const locations = [origin, ...requestedDestinations];
  const matrix = buildDistanceMatrix(locations);
  const optimization = requestedDestinations.length <= MAX_EXACT_STOPS ? "exact" : "heuristic";
  const order = optimization === "exact"
    ? exactStopOrder(matrix, requestedDestinations.length)
    : heuristicStopOrder(matrix, requestedDestinations.length);
  const destinations = order.map((index) => requestedDestinations[index]);
  const legs: DeliveryLeg[] = [];
  let current = origin;

  destinations.forEach((destination, index) => {
    legs.push({ ...buildRoute(current, destination), stopNumber: index + 1 });
    current = destination;
  });

  return {
    origin,
    destinations,
    legs,
    points: legs.flatMap((leg, index) => index === 0 ? leg.points : leg.points.slice(1)),
    coordinateDistance: legs.reduce((total, leg) => total + leg.coordinateDistance, 0),
    optimization,
  };
}
