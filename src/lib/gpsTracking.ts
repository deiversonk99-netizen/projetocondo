import { roadEdges, roadNodes, type MapLocation, type Point } from "@/data/map";

const EARTH_RADIUS_METERS = 6_378_137;
const DEGREES_TO_RADIANS = Math.PI / 180;

export type GeoFix = {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
};

export type CalibrationAnchor = {
  locationId: string;
  label: string;
  mapPoint: Point;
  latitude: number;
  longitude: number;
  accuracy: number;
  capturedAt: number;
};

export type GpsCalibration = {
  anchors: [CalibrationAnchor, CalibrationAnchor];
  createdAt: number;
};

export type ProjectedGpsPosition = {
  point: Point;
  accuracyInMapUnits: number;
  mapUnitsPerMeter: number;
};

export type RoadMatch = {
  point: Point;
  distance: number;
  street: string;
};

const nodeIndex = new Map(roadNodes.map((node) => [node.id, node]));

function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function offsetInMeters(
  latitude: number,
  longitude: number,
  referenceLatitude: number,
  referenceLongitude: number,
) {
  const north = (latitude - referenceLatitude) * DEGREES_TO_RADIANS * EARTH_RADIUS_METERS;
  const east = (longitude - referenceLongitude)
    * DEGREES_TO_RADIANS
    * EARTH_RADIUS_METERS
    * Math.cos(referenceLatitude * DEGREES_TO_RADIANS);
  return { east, north };
}

function calibrationTransform(calibration: GpsCalibration) {
  const [first, second] = calibration.anchors;
  const geoVector = offsetInMeters(
    second.latitude,
    second.longitude,
    first.latitude,
    first.longitude,
  );
  const geoDistance = Math.hypot(geoVector.east, geoVector.north);
  const mapVector = {
    x: second.mapPoint.x - first.mapPoint.x,
    y: second.mapPoint.y - first.mapPoint.y,
  };
  const mapDistance = Math.hypot(mapVector.x, mapVector.y);

  if (geoDistance < 20 || mapDistance < 100) {
    throw new Error("Use dois pontos de calibração mais distantes entre si.");
  }

  const mapUnitsPerMeter = mapDistance / geoDistance;
  const rotation = Math.atan2(mapVector.y, mapVector.x)
    - Math.atan2(geoVector.north, geoVector.east);

  return {
    first,
    mapUnitsPerMeter,
    cosine: Math.cos(rotation),
    sine: Math.sin(rotation),
  };
}

export function createCalibration(
  first: CalibrationAnchor,
  second: CalibrationAnchor,
): GpsCalibration {
  if (first.locationId === second.locationId) {
    throw new Error("Escolha dois locais diferentes para calibrar o mapa.");
  }

  const calibration: GpsCalibration = {
    anchors: [first, second],
    createdAt: Date.now(),
  };
  calibrationTransform(calibration);
  return calibration;
}

export function isGpsCalibration(value: unknown): value is GpsCalibration {
  if (!value || typeof value !== "object") return false;
  const calibration = value as Partial<GpsCalibration>;
  if (!Array.isArray(calibration.anchors) || calibration.anchors.length !== 2) return false;

  return calibration.anchors.every((anchor) => (
    anchor
    && typeof anchor.locationId === "string"
    && typeof anchor.label === "string"
    && Number.isFinite(anchor.latitude)
    && Number.isFinite(anchor.longitude)
    && Number.isFinite(anchor.mapPoint?.x)
    && Number.isFinite(anchor.mapPoint?.y)
  ));
}

export function projectGpsToMap(
  fix: GeoFix,
  calibration: GpsCalibration,
): ProjectedGpsPosition {
  const transform = calibrationTransform(calibration);
  const offset = offsetInMeters(
    fix.latitude,
    fix.longitude,
    transform.first.latitude,
    transform.first.longitude,
  );
  const rotatedX = offset.east * transform.cosine - offset.north * transform.sine;
  const rotatedY = offset.east * transform.sine + offset.north * transform.cosine;

  return {
    point: {
      x: transform.first.mapPoint.x + rotatedX * transform.mapUnitsPerMeter,
      y: transform.first.mapPoint.y + rotatedY * transform.mapUnitsPerMeter,
    },
    accuracyInMapUnits: fix.accuracy * transform.mapUnitsPerMeter,
    mapUnitsPerMeter: transform.mapUnitsPerMeter,
  };
}

export function snapPointToRoad(point: Point): RoadMatch {
  let best: RoadMatch | null = null;

  roadEdges.forEach((edge) => {
    const start = nodeIndex.get(edge.a)!;
    const end = nodeIndex.get(edge.b)!;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const rawProgress = lengthSquared === 0
      ? 0
      : ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
    const progress = Math.max(0, Math.min(1, rawProgress));
    const projected = {
      x: start.x + dx * progress,
      y: start.y + dy * progress,
    };
    const candidate: RoadMatch = {
      point: projected,
      distance: distance(point, projected),
      street: edge.street,
    };
    if (!best || candidate.distance < best.distance) best = candidate;
  });

  if (!best) throw new Error("A malha de ruas não está disponível.");
  return best;
}

export function makeLiveLocation(point: Point): MapLocation {
  return {
    id: "live-location",
    label: "Minha localização (GPS)",
    type: "custom",
    x: point.x,
    y: point.y,
  };
}

