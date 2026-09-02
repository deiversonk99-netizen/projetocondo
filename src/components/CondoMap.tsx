"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type PointerEvent,
  type WheelEvent,
} from "react";
import housesJson from "@/data/houses.json";
import {
  INITIAL_VIEW,
  MAP_SIZE,
  pointsOfInterest,
  roadEdges,
  roadNodes,
  type MapLocation,
  type Point,
} from "@/data/map";
import {
  buildDeliveryRoute,
  MAX_DELIVERY_STOPS,
  type DeliveryRouteResult,
} from "@/lib/routing";
import {
  createCalibration,
  isGpsCalibration,
  makeLiveLocation,
  projectGpsToMap,
  snapPointToRoad,
  type CalibrationAnchor,
  type GeoFix,
  type GpsCalibration,
} from "@/lib/gpsTracking";

type HouseRecord = { id: string; label: string; quadra: string; numero: number; x: number; y: number };
type ViewBox = { x: number; y: number; width: number; height: number };
type ActiveField = "origin" | "destination";
type GpsStatus = "idle" | "requesting" | "tracking" | "error" | "unsupported";
type LiveMapPosition = {
  point: Point;
  rawPoint: Point;
  accuracyInMapUnits: number;
  accuracyInMeters: number;
  matchedToRoad: boolean;
  street: string | null;
  timestamp: number;
};

const GPS_CALIBRATION_STORAGE_KEY = "duo-jardim-paraiso-gps-calibration-v1";

const houses: MapLocation[] = (housesJson as HouseRecord[]).map((house) => ({ ...house, type: "house" }));
const normalize = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();

const quadras: MapLocation[] = "ABCDEFGHIJKL".split("").map((quadra) => {
  const members = houses.filter((house) => house.quadra === quadra);
  return {
    id: `quadra-${quadra.toLowerCase()}`,
    label: `Quadra ${quadra}`,
    type: "quadra",
    quadra,
    x: members.reduce((total, house) => total + house.x, 0) / members.length,
    y: members.reduce((total, house) => total + house.y, 0) / members.length,
  };
});

const allLocations = [...pointsOfInterest, ...quadras, ...houses];
const featuredLocations = [pointsOfInterest[0], ...quadras, ...pointsOfInterest.slice(1)];
const roadNodeIndex = new Map(roadNodes.map((node) => [node.id, node]));
const calibrationLocations = [...pointsOfInterest, ...houses];

function resolveLocation(rawValue: string): MapLocation | null {
  const value = normalize(rawValue);
  if (!value) return null;
  return allLocations.find((location) => normalize(location.label) === value || normalize(location.id) === value)
    ?? houses.find((house) => normalize(house.label).replace("CASA", "") === value.replace("CASA", ""))
    ?? null;
}

function locationSearchText(location: MapLocation) {
  const shortHouse = location.type === "house" ? `${location.quadra}${location.numero}` : "";
  return normalize(`${location.label} ${location.id} ${shortHouse}`);
}

function locationDescription(location: MapLocation) {
  if (location.type === "house") return `Quadra ${location.quadra} • residência ${location.numero}`;
  if (location.type === "quadra") return `${houses.filter((house) => house.quadra === location.quadra).length} casas nesta quadra`;
  return location.id === "portaria" ? "Entrada principal do condomínio" : "Área comum";
}

function findSuggestions(rawValue: string) {
  const query = normalize(rawValue);
  if (!query) return featuredLocations.slice(0, 9);

  return allLocations
    .filter((location) => locationSearchText(location).includes(query))
    .sort((a, b) => {
      const aLabel = normalize(a.label);
      const bLabel = normalize(b.label);
      const aRank = aLabel === query ? 0 : aLabel.startsWith(query) ? 1 : 2;
      const bRank = bLabel === query ? 0 : bLabel.startsWith(query) ? 1 : 2;
      return aRank - bRank || a.label.localeCompare(b.label, "pt-BR", { numeric: true });
    })
    .slice(0, 9);
}

function clampViewBox(view: ViewBox): ViewBox {
  const width = Math.max(180, Math.min(INITIAL_VIEW.width, view.width));
  const height = Math.max(120, Math.min(INITIAL_VIEW.height, view.height));
  return {
    x: Math.max(0, Math.min(MAP_SIZE.width - width, view.x)),
    y: Math.max(0, Math.min(MAP_SIZE.height - height, view.y)),
    width,
    height,
  };
}

function fitPoints(points: Point[]): ViewBox {
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(280, maxX - minX + 150);
  const height = Math.max(210, maxY - minY + 130);
  return clampViewBox({
    x: (minX + maxX) / 2 - width / 2,
    y: (minY + maxY) / 2 - height / 2,
    width,
    height,
  });
}

function farthestCalibrationLocation(origin: MapLocation) {
  return calibrationLocations.reduce((farthest, location) => {
    const currentDistance = Math.hypot(location.x - origin.x, location.y - origin.y);
    const farthestDistance = Math.hypot(farthest.x - origin.x, farthest.y - origin.y);
    return currentDistance > farthestDistance ? location : farthest;
  }, calibrationLocations[0]!);
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "A permissão de localização foi negada. Libere o GPS nas configurações do navegador.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "O celular não conseguiu determinar sua posição. Tente em uma área aberta.";
  }
  if (error.code === error.TIMEOUT) {
    return "O GPS demorou para responder. Tente novamente.";
  }
  return "Não foi possível acessar a localização deste aparelho.";
}

function averageGeoFixes(fixes: GeoFix[]) {
  const recentFixes = fixes.filter((fix) => Date.now() - fix.timestamp <= 15_000).slice(-8);
  if (recentFixes.length === 0) return null;

  let weightTotal = 0;
  let latitudeTotal = 0;
  let longitudeTotal = 0;
  recentFixes.forEach((fix) => {
    const weight = 1 / Math.max(3, fix.accuracy) ** 2;
    weightTotal += weight;
    latitudeTotal += fix.latitude * weight;
    longitudeTotal += fix.longitude * weight;
  });

  return {
    latitude: latitudeTotal / weightTotal,
    longitude: longitudeTotal / weightTotal,
    accuracy: Math.min(...recentFixes.map((fix) => fix.accuracy)),
    timestamp: Math.max(...recentFixes.map((fix) => fix.timestamp)),
  } satisfies GeoFix;
}

function formatCoordinate(value: number) {
  return value.toFixed(7);
}

type LocationPickerProps = {
  id: string;
  label: string;
  value: string;
  role: ActiveField;
  active: boolean;
  placeholder: string;
  onActivate: () => void;
  onValueChange: (value: string) => void;
  onSelect: (location: MapLocation) => void;
};

function LocationPicker({
  id,
  label,
  value,
  role,
  active,
  placeholder,
  onActivate,
  onValueChange,
  onSelect,
}: LocationPickerProps) {
  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const suggestions = useMemo(() => findSuggestions(value), [value]);
  const listId = `${id}-suggestions`;

  const choose = (location: MapLocation) => {
    onSelect(location);
    setOpen(false);
    setHighlightedIndex(0);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlightedIndex((current) => Math.min(suggestions.length - 1, current + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlightedIndex((current) => Math.max(0, current - 1));
    } else if (event.key === "Enter" && open && suggestions[highlightedIndex]) {
      event.preventDefault();
      choose(suggestions[highlightedIndex]);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLDivElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <div className={`location-picker${active ? " active-field" : ""}`} onBlur={handleBlur}>
      <label htmlFor={id}>
        <i className={`dot dot-${role}`} />
        {label}
      </label>
      <div className="picker-input-row">
        <input
          id={id}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={open && suggestions[highlightedIndex] ? `${id}-option-${highlightedIndex}` : undefined}
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            onValueChange(event.target.value);
            setOpen(true);
            setHighlightedIndex(0);
          }}
          onFocus={() => {
            onActivate();
            setOpen(true);
          }}
          onKeyDown={handleKeyDown}
        />
        {value && (
          <button
            type="button"
            className="clear-field"
            aria-label={`Limpar ${label.toLowerCase()}`}
            onClick={() => {
              onValueChange("");
              setOpen(true);
            }}
          >
            ×
          </button>
        )}
      </div>

      {open && (
        <ul id={listId} className="location-suggestions" role="listbox" aria-label={`Sugestões para ${label.toLowerCase()}`}>
          {suggestions.length > 0 ? suggestions.map((location, index) => (
            <li
              id={`${id}-option-${index}`}
              key={location.id}
              role="option"
              aria-selected={index === highlightedIndex}
            >
              <button type="button" tabIndex={-1} onClick={() => choose(location)}>
                <span>{location.label}</span>
                <small>{locationDescription(location)}</small>
              </button>
            </li>
          )) : (
            <li className="no-results">Nenhum local encontrado. Tente “A18” ou “Piscina”.</li>
          )}
        </ul>
      )}
    </div>
  );
}

const defaultOrigin = resolveLocation("Portaria")!;

export default function CondoMap() {
  const [originValue, setOriginValue] = useState(defaultOrigin.label);
  const [destinations, setDestinations] = useState<MapLocation[]>([]);
  const [newDestinationValue, setNewDestinationValue] = useState("");
  const [activeField, setActiveField] = useState<ActiveField>("destination");
  const [route, setRoute] = useState<DeliveryRouteResult | null>(null);
  const [message, setMessage] = useState("Adicione um ou mais destinos para traçar a melhor rota.");
  const [viewBox, setViewBox] = useState<ViewBox>(INITIAL_VIEW);
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>("idle");
  const [gpsTrackingRequested, setGpsTrackingRequested] = useState(false);
  const [gpsError, setGpsError] = useState("");
  const [coordinateCopyStatus, setCoordinateCopyStatus] = useState("");
  const [gpsFix, setGpsFix] = useState<GeoFix | null>(null);
  const [gpsCalibration, setGpsCalibration] = useState<GpsCalibration | null>(null);
  const [gpsOriginEnabled, setGpsOriginEnabled] = useState(false);
  const [draftAnchors, setDraftAnchors] = useState<CalibrationAnchor[]>([]);
  const [calibrationLocationId, setCalibrationLocationId] = useState("portaria");
  const [calibrationMessage, setCalibrationMessage] = useState(
    "Registre dois locais conhecidos e distantes entre si.",
  );
  const welcomeDialogRef = useRef<HTMLDialogElement>(null);
  const calibrationDialogRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gpsWatchIdRef = useRef<number | null>(null);
  const gpsStartupTimerRef = useRef<number | null>(null);
  const gpsTrackingRequestedRef = useRef(false);
  const latestGpsFixRef = useRef<GeoFix | null>(null);
  const gpsSamplesRef = useRef<GeoFix[]>([]);
  const lastGpsRouteUpdateRef = useRef<{ point: Point; timestamp: number } | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const gesture = useRef<
    | { mode: "pan"; pointerId: number; x: number; y: number; view: ViewBox }
    | { mode: "pinch"; distance: number; view: ViewBox }
    | null
  >(null);

  useEffect(() => {
    const dialog = welcomeDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!window.isSecureContext) {
        setGpsStatus("unsupported");
        setGpsError("O GPS exige uma conexão segura (HTTPS). Abra o endereço publicado do aplicativo.");
        return;
      }
      if (!("geolocation" in navigator)) {
        setGpsStatus("unsupported");
        setGpsError("Este navegador não oferece acesso à localização.");
        return;
      }

      try {
        const savedCalibration = window.localStorage.getItem(GPS_CALIBRATION_STORAGE_KEY);
        if (!savedCalibration) return;
        const parsedCalibration: unknown = JSON.parse(savedCalibration);
        if (isGpsCalibration(parsedCalibration)) {
          setGpsCalibration(parsedCalibration);
        }
      } catch {
        window.localStorage.removeItem(GPS_CALIBRATION_STORAGE_KEY);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    gpsTrackingRequestedRef.current = false;
    if (gpsWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }
    if (gpsStartupTimerRef.current !== null) {
      window.clearTimeout(gpsStartupTimerRef.current);
    }
  }, []);

  const gpsProjection = useMemo<{ position: LiveMapPosition | null; error: string }>(() => {
    if (!gpsFix || !gpsCalibration) return { position: null, error: "" };

    try {
      const projected = projectGpsToMap(gpsFix, gpsCalibration);
      const roadMatch = snapPointToRoad(projected.point);
      const snapTolerance = Math.max(28, Math.min(95, projected.accuracyInMapUnits * 1.5));
      const matchedToRoad = roadMatch.distance <= snapTolerance;
      return {
        position: {
          point: matchedToRoad ? roadMatch.point : projected.point,
          rawPoint: projected.point,
          accuracyInMapUnits: projected.accuracyInMapUnits,
          accuracyInMeters: gpsFix.accuracy,
          matchedToRoad,
          street: matchedToRoad ? roadMatch.street : null,
          timestamp: gpsFix.timestamp,
        },
        error: "",
      };
    } catch (error) {
      return {
        position: null,
        error: error instanceof Error ? error.message : "Não foi possível converter o GPS para o mapa.",
      };
    }
  }, [gpsFix, gpsCalibration]);
  const liveMapPosition = gpsProjection.position;

  const liveLocation = useMemo(
    () => liveMapPosition ? makeLiveLocation(liveMapPosition.point) : null,
    [liveMapPosition],
  );
  const selectedOrigin = gpsOriginEnabled && liveLocation
    ? liveLocation
    : resolveLocation(originValue);
  const routeIsActive = route !== null;

  const selectedLocations = useMemo(
    () => [selectedOrigin, ...destinations],
    [selectedOrigin, destinations],
  );

  useEffect(() => {
    if (!gpsOriginEnabled || !liveLocation || !routeIsActive || destinations.length === 0) return;

    const now = Date.now();
    const previousUpdate = lastGpsRouteUpdateRef.current;
    const moved = previousUpdate
      ? Math.hypot(
          liveLocation.x - previousUpdate.point.x,
          liveLocation.y - previousUpdate.point.y,
        )
      : Number.POSITIVE_INFINITY;
    if (previousUpdate && moved < 4 && now - previousUpdate.timestamp < 5_000) return;

    const timer = window.setTimeout(() => {
      try {
        setRoute(buildDeliveryRoute(liveLocation, destinations));
        lastGpsRouteUpdateRef.current = { point: liveLocation, timestamp: now };
      } catch {
        // Keep the last valid route while the current GPS sample is unstable.
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [destinations, gpsOriginEnabled, liveLocation, routeIsActive]);

  const highlightedQuadras = useMemo(() => {
    const selected = new Set<string>();
    selectedLocations.forEach((location) => {
      if (location?.type === "quadra" && location.quadra) selected.add(location.quadra);
    });
    return selected;
  }, [selectedLocations]);

  const openCalibrationDialog = () => {
    gpsSamplesRef.current = [];
    setDraftAnchors([]);
    setCalibrationLocationId("portaria");
    setCalibrationMessage("Fique exatamente no local escolhido e aguarde uma leitura estável do GPS.");
    const dialog = calibrationDialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
  };

  const clearGpsStartupTimer = () => {
    if (gpsStartupTimerRef.current !== null) {
      window.clearTimeout(gpsStartupTimerRef.current);
      gpsStartupTimerRef.current = null;
    }
  };

  const acceptGpsPosition = (position: GeolocationPosition) => {
    if (!gpsTrackingRequestedRef.current) return;

    const nextFix: GeoFix = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      timestamp: position.timestamp,
    };
    latestGpsFixRef.current = nextFix;
    gpsSamplesRef.current = [...gpsSamplesRef.current, nextFix]
      .filter((fix) => Date.now() - fix.timestamp <= 15_000)
      .slice(-8);
    clearGpsStartupTimer();
    setGpsFix(nextFix);
    setCoordinateCopyStatus("");
    setGpsStatus("tracking");
    setGpsError("");
  };

  const finishGpsAttempt = (errorMessage: string) => {
    gpsTrackingRequestedRef.current = false;
    setGpsTrackingRequested(false);
    clearGpsStartupTimer();
    if (gpsWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }
    gpsWatchIdRef.current = null;
    setGpsStatus("error");
    setGpsError(errorMessage);
  };

  const handleGpsError = (error: GeolocationPositionError) => {
    if (!gpsTrackingRequestedRef.current) return;

    if (error.code === error.PERMISSION_DENIED) {
      finishGpsAttempt(geolocationErrorMessage(error));
      return;
    }

    if (latestGpsFixRef.current) {
      setGpsStatus("tracking");
      setGpsError("Sinal temporariamente instável. Mantendo a última posição recebida.");
      return;
    }

    setGpsStatus("requesting");
    setGpsError(
      error.code === error.TIMEOUT
        ? "Ainda procurando o sinal. Mantenha a tela aberta e confirme se a Localização do celular está ativada."
        : geolocationErrorMessage(error),
    );
  };

  const startGpsTracking = () => {
    if (!window.isSecureContext) {
      setGpsStatus("unsupported");
      setGpsError("O GPS exige HTTPS. Abra o endereço publicado do aplicativo.");
      return;
    }
    if (!("geolocation" in navigator)) {
      setGpsStatus("unsupported");
      setGpsError("Este navegador não oferece acesso à localização.");
      return;
    }
    if (gpsTrackingRequestedRef.current) return;

    gpsTrackingRequestedRef.current = true;
    setGpsTrackingRequested(true);
    setGpsStatus("requesting");
    setGpsError("");
    latestGpsFixRef.current = null;

    // A leitura rápida aceita uma posição recente do aparelho, enquanto o watch
    // de alta precisão continua refinando o ponto para a navegação interna.
    navigator.geolocation.getCurrentPosition(
      acceptGpsPosition,
      (error) => {
        if (error.code === error.PERMISSION_DENIED) handleGpsError(error);
      },
      {
        enableHighAccuracy: false,
        maximumAge: 60_000,
        timeout: 12_000,
      },
    );

    gpsWatchIdRef.current = navigator.geolocation.watchPosition(
      acceptGpsPosition,
      handleGpsError,
      {
        enableHighAccuracy: true,
        maximumAge: 15_000,
        timeout: 30_000,
      },
    );

    gpsStartupTimerRef.current = window.setTimeout(() => {
      if (gpsTrackingRequestedRef.current && !latestGpsFixRef.current) {
        finishGpsAttempt(
          "Não recebemos uma localização em 45 segundos. Ative a Localização do celular, permita o acesso para este site e tente novamente em uma área aberta.",
        );
      }
    }, 45_000);
  };

  const stopGpsTracking = () => {
    gpsTrackingRequestedRef.current = false;
    setGpsTrackingRequested(false);
    clearGpsStartupTimer();
    if (gpsWatchIdRef.current !== null && "geolocation" in navigator) {
      navigator.geolocation.clearWatch(gpsWatchIdRef.current);
    }
    gpsWatchIdRef.current = null;
    latestGpsFixRef.current = null;
    gpsSamplesRef.current = [];
    lastGpsRouteUpdateRef.current = null;
    setGpsStatus("idle");
    setGpsFix(null);
    if (gpsOriginEnabled) {
      setGpsOriginEnabled(false);
      setRoute(null);
      setMessage("GPS pausado. Escolha novamente o ponto de partida.");
    }
  };

  const beginCalibration = () => {
    openCalibrationDialog();
    startGpsTracking();
  };

  const copyCurrentCoordinates = async () => {
    if (!gpsFix) return;
    const coordinates = `${formatCoordinate(gpsFix.latitude)}, ${formatCoordinate(gpsFix.longitude)}`;
    try {
      await navigator.clipboard.writeText(coordinates);
      setCoordinateCopyStatus("Coordenadas copiadas");
    } catch {
      setCoordinateCopyStatus("Não foi possível copiar automaticamente");
    }
  };

  const captureCalibrationAnchor = () => {
    const calibrationFix = averageGeoFixes(gpsSamplesRef.current);
    if (!calibrationFix) {
      setCalibrationMessage("Aguardando o primeiro sinal do GPS.");
      return;
    }
    if (calibrationFix.accuracy > 30) {
      setCalibrationMessage(`Precisão atual de ${Math.round(calibrationFix.accuracy)} m. Aguarde melhorar para menos de 30 m.`);
      return;
    }

    const location = calibrationLocations.find((item) => item.id === calibrationLocationId);
    if (!location) return;
    if (draftAnchors.some((anchor) => anchor.locationId === location.id)) {
      setCalibrationMessage("Escolha outro local para o segundo ponto.");
      return;
    }

    const anchor: CalibrationAnchor = {
      locationId: location.id,
      label: location.label,
      mapPoint: { x: location.x, y: location.y },
      latitude: calibrationFix.latitude,
      longitude: calibrationFix.longitude,
      accuracy: calibrationFix.accuracy,
      capturedAt: Date.now(),
    };

    if (draftAnchors.length === 0) {
      const nextLocation = farthestCalibrationLocation(location);
      setDraftAnchors([anchor]);
      gpsSamplesRef.current = [];
      setCalibrationLocationId(nextLocation.id);
      setCalibrationMessage(`Primeiro ponto registrado. Vá até ${nextLocation.label} ou escolha outro local distante.`);
      return;
    }

    try {
      const nextCalibration = createCalibration(draftAnchors[0], anchor);
      setGpsCalibration(nextCalibration);
      window.localStorage.setItem(GPS_CALIBRATION_STORAGE_KEY, JSON.stringify(nextCalibration));
      setDraftAnchors([draftAnchors[0], anchor]);
      setCalibrationMessage("Calibração concluída. O GPS já pode ser convertido para o mapa X/Y.");
      setGpsStatus("tracking");
    } catch (error) {
      setCalibrationMessage(error instanceof Error ? error.message : "Não foi possível concluir a calibração.");
    }
  };

  const clearGpsCalibration = () => {
    window.localStorage.removeItem(GPS_CALIBRATION_STORAGE_KEY);
    setGpsCalibration(null);
    setDraftAnchors([]);
    setGpsOriginEnabled(false);
    setRoute(null);
    setCalibrationMessage("Calibração apagada. Registre novamente dois pontos conhecidos.");
  };

  const activateGpsOrigin = () => {
    if (!gpsCalibration) {
      setMessage("Calibre dois pontos antes de usar o GPS como partida.");
      beginCalibration();
      return;
    }
    if (!liveLocation) {
      setMessage("Aguardando uma posição válida do GPS.");
      startGpsTracking();
      return;
    }

    setGpsOriginEnabled(true);
    setActiveField("origin");
    setRoute(null);
    setMessage("Sua localização em tempo real será usada como ponto de partida.");
    locateGpsOnMap();
  };

  const locateGpsOnMap = () => {
    if (!liveLocation) return;
    const width = 300;
    const height = 220;
    setViewBox(clampViewBox({
      x: liveLocation.x - width / 2,
      y: liveLocation.y - height / 2,
      width,
      height,
    }));
  };

  const clearCalculatedRoute = () => {
    setRoute(null);
    setMessage("Revise as paradas e toque em “Otimizar rota”.");
  };

  const calculateRoute = (originRaw: string, requestedDestinations = destinations) => {
    const origin = gpsOriginEnabled && liveLocation ? liveLocation : resolveLocation(originRaw);
    if (!origin) {
      setRoute(null);
      setMessage("Selecione um ponto de partida válido.");
      return;
    }
    if (requestedDestinations.length === 0) {
      setRoute(null);
      setMessage("Adicione pelo menos um destino.");
      return;
    }

    try {
      const nextRoute = buildDeliveryRoute(origin, requestedDestinations);
      setRoute(nextRoute);
      setMessage(`Ordem de ${nextRoute.destinations.length} ${nextRoute.destinations.length === 1 ? "parada otimizada" : "paradas otimizadas"} pela menor distância.`);
      setViewBox(fitPoints(nextRoute.points));
    } catch (error) {
      setRoute(null);
      setMessage(error instanceof Error ? error.message : "Não foi possível calcular a rota.");
    }
  };

  const addDestination = (location: MapLocation) => {
    const origin = selectedOrigin;
    if (origin?.id === location.id) {
      setMessage("O destino não pode ser igual ao ponto de partida.");
      return;
    }
    if (destinations.some((destination) => destination.id === location.id)) {
      setMessage(`${location.label} já está na lista de destinos.`);
      return;
    }
    if (destinations.length >= MAX_DELIVERY_STOPS) {
      setMessage(`Você pode adicionar até ${MAX_DELIVERY_STOPS} pontos por rota.`);
      return;
    }

    setDestinations((current) => [...current, location]);
    setNewDestinationValue("");
    setActiveField("destination");
    setRoute(null);
    setMessage(`${location.label} adicionado como destino.`);
  };

  const removeDestination = (location: MapLocation) => {
    setDestinations((current) => current.filter((destination) => destination.id !== location.id));
    setRoute(null);
    setMessage(`${location.label} removida da rota.`);
  };

  const addTypedDestination = () => {
    const destination = resolveLocation(newDestinationValue);
    if (!destination) {
      setMessage("Selecione uma casa, quadra ou área comum válida para adicionar.");
      return;
    }
    addDestination(destination);
  };

  const chooseLocation = (location: MapLocation, field = activeField) => {
    if (field === "destination") {
      addDestination(location);
      return;
    }
    if (destinations.some((destination) => destination.id === location.id)) {
      setMessage("Remova esta parada antes de usá-la como ponto de partida.");
      return;
    }
    setOriginValue(location.label);
    setGpsOriginEnabled(false);
    setActiveField("origin");
    setRoute(null);
    setMessage(`${location.label} definida como ponto de partida.`);
  };

  const zoom = (factor: number) => {
    setViewBox((current) => clampViewBox({
      x: current.x + (current.width - current.width * factor) / 2,
      y: current.y + (current.height - current.height * factor) / 2,
      width: current.width * factor,
      height: current.height * factor,
    }));
  };

  const handleWheel = (event: WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    zoom(event.deltaY > 0 ? 1.12 : 0.88);
  };

  const pointerDistance = () => {
    const [first, second] = Array.from(pointers.current.values());
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  };

  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if ((event.target as Element).closest("[data-house]")) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.current.size === 1) {
      gesture.current = { mode: "pan", pointerId: event.pointerId, x: event.clientX, y: event.clientY, view: viewBox };
    } else if (pointers.current.size === 2) {
      gesture.current = { mode: "pinch", distance: pointerDistance(), view: viewBox };
    }
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(event.pointerId) || !svgRef.current) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const bounds = svgRef.current.getBoundingClientRect();

    if (pointers.current.size >= 2 && gesture.current?.mode === "pinch") {
      const currentDistance = pointerDistance();
      if (!currentDistance) return;
      const factor = gesture.current.distance / currentDistance;
      const nextWidth = gesture.current.view.width * factor;
      const nextHeight = gesture.current.view.height * factor;
      setViewBox(clampViewBox({
        x: gesture.current.view.x + (gesture.current.view.width - nextWidth) / 2,
        y: gesture.current.view.y + (gesture.current.view.height - nextHeight) / 2,
        width: nextWidth,
        height: nextHeight,
      }));
      return;
    }

    if (gesture.current?.mode === "pan" && gesture.current.pointerId === event.pointerId) {
      const dx = ((event.clientX - gesture.current.x) / bounds.width) * gesture.current.view.width;
      const dy = ((event.clientY - gesture.current.y) / bounds.height) * gesture.current.view.height;
      setViewBox(clampViewBox({
        ...gesture.current.view,
        x: gesture.current.view.x - dx,
        y: gesture.current.view.y - dy,
      }));
    }
  };

  const handlePointerEnd = (event: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const remaining = Array.from(pointers.current.entries())[0];
    gesture.current = remaining
      ? { mode: "pan", pointerId: remaining[0], x: remaining[1].x, y: remaining[1].y, view: viewBox }
      : null;
  };

  const handleHouseKey = (event: KeyboardEvent<SVGGElement>, house: MapLocation) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      chooseLocation(house);
    }
  };

  const selectedIds = new Set(selectedLocations.map((location) => location?.id));
  const mappedDestinations = route?.destinations ?? destinations;
  const gpsIsRunning = gpsTrackingRequested;
  const gpsDisplayError = gpsError || gpsProjection.error;
  const gpsStatusLabel = gpsProjection.error
    ? "Falha na calibração"
    : gpsStatus === "unsupported"
    ? "GPS indisponível"
      : gpsStatus === "error"
      ? gpsTrackingRequested ? "Procurando sinal" : "Falha no GPS"
      : gpsStatus === "requesting"
        ? "Conectando ao GPS"
        : gpsStatus === "tracking"
          ? gpsCalibration ? "GPS em tempo real" : "GPS conectado"
          : gpsCalibration
            ? "GPS pronto"
            : "GPS não configurado";
  const livePointIsVisible = liveMapPosition
    && liveMapPosition.point.x >= -40
    && liveMapPosition.point.x <= MAP_SIZE.width + 40
    && liveMapPosition.point.y >= -40
    && liveMapPosition.point.y <= MAP_SIZE.height + 40;

  return (
    <main className="app-shell">
      <dialog
        ref={welcomeDialogRef}
        className="welcome-dialog"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-description"
      >
        <div className="welcome-content">
          <div className="welcome-heading">
            <span className="welcome-mark" aria-hidden="true">JP</span>
            <button
              className="welcome-close"
              type="button"
              aria-label="Fechar apresentação"
              onClick={() => welcomeDialogRef.current?.close()}
            >
              ×
            </button>
          </div>

          <p className="welcome-eyebrow">Mapa do condomínio</p>
          <h2 id="welcome-title">Bem-vindo ao Duo Jardim Paraíso</h2>
          <p id="welcome-description" className="welcome-description">
            Encontre casas, quadras e áreas comuns com facilidade. O mapa pode ser usado por moradores,
            visitantes, prestadores de serviço e entregadores.
          </p>

          <ol className="welcome-steps">
            <li>
              <span>1</span>
              <div><strong>Diga onde você está</strong><small>Use o GPS calibrado ou escolha uma partida no mapa.</small></div>
            </li>
            <li>
              <span>2</span>
              <div><strong>Adicione seus destinos</strong><small>Inclua um ou vários lugares que deseja visitar.</small></div>
            </li>
            <li>
              <span>3</span>
              <div><strong>Siga a melhor rota</strong><small>O sistema organiza o caminho pelas ruas internas do condomínio.</small></div>
            </li>
          </ol>

          <div className="welcome-note">
            <i className="dot dot-origin" aria-hidden="true" />
            <span>Modo híbrido: o GPS é convertido e ajustado às coordenadas X/Y das ruas internas.</span>
          </div>

          <button className="welcome-start" type="button" onClick={() => welcomeDialogRef.current?.close()}>
            Entendi, começar
          </button>
        </div>
      </dialog>

      <dialog
        ref={calibrationDialogRef}
        className="gps-calibration-dialog"
        aria-labelledby="gps-calibration-title"
        aria-describedby="gps-calibration-description"
      >
        <div className="gps-calibration-content">
          <div className="gps-calibration-heading">
            <span className="gps-symbol" aria-hidden="true">◎</span>
            <button
              className="welcome-close"
              type="button"
              aria-label="Fechar calibração"
              onClick={() => calibrationDialogRef.current?.close()}
            >
              ×
            </button>
          </div>

          <p className="welcome-eyebrow">GPS + coordenadas X/Y</p>
          <h2 id="gps-calibration-title">Calibrar o mapa</h2>
          <p id="gps-calibration-description" className="gps-calibration-description">
            Escolha abaixo o local onde você está e registre o primeiro ponto. Depois vá até outro local conhecido,
            distante pelo menos 20 metros, e registre o segundo. Isso é feito uma única vez neste aparelho.
          </p>

          <div className="gps-calibration-progress" aria-label={`${draftAnchors.length} de 2 pontos registrados`}>
            <span className={draftAnchors.length >= 1 ? "complete" : ""}>1</span>
            <i />
            <span className={draftAnchors.length >= 2 ? "complete" : ""}>2</span>
          </div>

          {draftAnchors.length > 0 && (
            <ol className="gps-anchor-list">
              {draftAnchors.map((anchor) => (
                <li key={anchor.locationId}>
                  <strong>{anchor.label}</strong>
                  <small>Precisão registrada: ±{Math.round(anchor.accuracy)} m</small>
                  <small>{formatCoordinate(anchor.latitude)}, {formatCoordinate(anchor.longitude)}</small>
                </li>
              ))}
            </ol>
          )}

          {draftAnchors.length < 2 && (
            <div className="gps-calibration-form">
              <label htmlFor="gps-reference-location">Estou exatamente em</label>
              <select
                id="gps-reference-location"
                value={calibrationLocationId}
                onChange={(event) => setCalibrationLocationId(event.target.value)}
              >
                <optgroup label="Áreas comuns">
                  {pointsOfInterest.map((location) => (
                    <option key={location.id} value={location.id}>{location.label}</option>
                  ))}
                </optgroup>
                <optgroup label="Casas">
                  {houses.map((location) => (
                    <option key={location.id} value={location.id}>{location.label}</option>
                  ))}
                </optgroup>
              </select>
              <div className="gps-reading">
                <span className={`gps-state-dot gps-state-${gpsStatus}`} aria-hidden="true" />
                {gpsFix
                  ? `Sinal recebido • precisão ±${Math.round(gpsFix.accuracy)} m`
                  : gpsStatus === "error"
                    ? "Sinal do GPS ainda não recebido"
                    : "Aguardando sinal do GPS…"}
              </div>
              {gpsFix && (
                <div className="gps-coordinate-box" aria-label="Coordenadas atuais do GPS">
                  <div>
                    <span>Latitude</span>
                    <strong>{formatCoordinate(gpsFix.latitude)}</strong>
                  </div>
                  <div>
                    <span>Longitude</span>
                    <strong>{formatCoordinate(gpsFix.longitude)}</strong>
                  </div>
                  <button type="button" onClick={copyCurrentCoordinates}>
                    {coordinateCopyStatus === "Coordenadas copiadas" ? "Copiado" : "Copiar coordenadas"}
                  </button>
                </div>
              )}
              {gpsError && <p className="gps-calibration-error" role="alert">{gpsError}</p>}
              {gpsStatus === "error" && !gpsIsRunning && (
                <button className="gps-retry-button" type="button" onClick={startGpsTracking}>
                  Tentar conectar novamente
                </button>
              )}
              <button
                className="gps-capture-button"
                type="button"
                disabled={!gpsFix}
                onClick={captureCalibrationAnchor}
              >
                Registrar ponto {draftAnchors.length + 1}
              </button>
            </div>
          )}

          <p className="gps-calibration-message" aria-live="polite">{calibrationMessage}</p>

          <div className="gps-calibration-actions">
            {gpsCalibration && (
              <button className="gps-text-button danger" type="button" onClick={clearGpsCalibration}>
                Apagar calibração
              </button>
            )}
            <button
              className="gps-finish-button"
              type="button"
              disabled={draftAnchors.length < 2 && !gpsCalibration}
              onClick={() => {
                calibrationDialogRef.current?.close();
                activateGpsOrigin();
              }}
            >
              {draftAnchors.length >= 2 ? "Localizar no mapa" : "Usar calibração salva"}
            </button>
          </div>
        </div>
      </dialog>

      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">JP</div>
        <div className="brand-copy">
          <p className="eyebrow">Duo Jardim Paraíso</p>
          <h1>Encontre seus destinos</h1>
        </div>
        <span className="coordinate-badge">GPS + mapa X/Y</span>
      </header>

      <div className="workspace">
        <aside className="route-panel" aria-label="Planejar rota">
          <div className="panel-intro">
            <span className="step-number">1</span>
            <div>
              <h2>Planeje sua rota</h2>
              <p>Escolha a partida e adicione os pontos que precisa visitar.</p>
            </div>
          </div>

          <div className="location-fields">
            <LocationPicker
              id="route-origin"
              label="Ponto de partida"
              role="origin"
              value={gpsOriginEnabled ? "Minha localização (GPS)" : originValue}
              active={activeField === "origin"}
              placeholder="Ex.: Portaria ou B12"
              onActivate={() => setActiveField("origin")}
              onValueChange={(value) => {
                setGpsOriginEnabled(false);
                setOriginValue(value);
                setActiveField("origin");
                clearCalculatedRoute();
              }}
              onSelect={(location) => chooseLocation(location, "origin")}
            />

            <section className={`gps-tracking-card gps-${gpsStatus}`} aria-label="Localização em tempo real">
              <div className="gps-tracking-heading">
                <div>
                  <span className={`gps-state-dot gps-state-${gpsStatus}`} aria-hidden="true" />
                  <strong>{gpsStatusLabel}</strong>
                </div>
                {gpsFix && <span>±{Math.round(gpsFix.accuracy)} m</span>}
              </div>

              <p>
                {liveMapPosition
                  ? liveMapPosition.matchedToRoad && liveMapPosition.street
                    ? `Posição ajustada para ${liveMapPosition.street}.`
                    : "Posição recebida; aguardando aproximação da malha de ruas."
                  : gpsFix
                    ? "GPS conectado. Agora calibre o mapa para converter a posição em coordenadas X/Y."
                  : gpsTrackingRequested
                    ? "Buscando a primeira posição do celular. Isso pode levar alguns segundos em local fechado."
                  : gpsStatus === "error" || gpsStatus === "unsupported"
                    ? "O aparelho ainda não forneceu uma posição para o aplicativo."
                  : gpsCalibration
                    ? "Ative o GPS para acompanhar sua posição no mapa."
                    : "Calibre dois pontos para relacionar latitude/longitude ao mapa X/Y."}
              </p>

              {gpsFix && (
                <div className="gps-live-coordinates" aria-label="Coordenadas capturadas">
                  <span>{formatCoordinate(gpsFix.latitude)}, {formatCoordinate(gpsFix.longitude)}</span>
                  <button type="button" onClick={copyCurrentCoordinates}>
                    {coordinateCopyStatus === "Coordenadas copiadas" ? "Copiado" : "Copiar"}
                  </button>
                </div>
              )}

              {coordinateCopyStatus && coordinateCopyStatus !== "Coordenadas copiadas" && (
                <p className="gps-error" role="status">{coordinateCopyStatus}</p>
              )}

              {gpsDisplayError && <p className="gps-error" role="alert">{gpsDisplayError}</p>}

              {(gpsStatus === "error" || gpsStatus === "unsupported") && (
                <p className="gps-mobile-help">
                  No celular, confirme que a Localização está ativada e que Safari ou Chrome tem permissão para este site.
                </p>
              )}

              <div className="gps-tracking-actions">
                <button type="button" onClick={() => gpsIsRunning ? stopGpsTracking() : startGpsTracking()}>
                  {gpsIsRunning ? "Pausar GPS" : gpsStatus === "error" ? "Tentar novamente" : "Ativar GPS"}
                </button>
                <button type="button" onClick={beginCalibration}>
                  {gpsCalibration ? "Recalibrar" : "Calibrar"}
                </button>
                {liveMapPosition && (
                  <button
                    type="button"
                    className={gpsOriginEnabled ? "active" : ""}
                    onClick={() => {
                      if (gpsOriginEnabled) {
                        setGpsOriginEnabled(false);
                        setRoute(null);
                        setMessage("Escolha uma partida manual ou reative a posição GPS.");
                      } else {
                        activateGpsOrigin();
                      }
                    }}
                  >
                    {gpsOriginEnabled ? "Partida GPS ativa" : "Usar como partida"}
                  </button>
                )}
              </div>
            </section>

            <div className="delivery-builder">
              <div className="delivery-builder-heading">
                <div>
                  <i className="dot dot-destination" />
                  <strong>Destinos</strong>
                </div>
                <span>{destinations.length}/{MAX_DELIVERY_STOPS}</span>
              </div>

              {destinations.length > 0 ? (
                <ol className="delivery-list" aria-label="Destinos adicionados">
                  {(route?.destinations ?? destinations).map((destination, index) => (
                    <li key={destination.id}>
                      <span className="delivery-number">{index + 1}</span>
                      <div>
                        <strong>{destination.label}</strong>
                        <small>{route ? "ordem otimizada" : locationDescription(destination)}</small>
                      </div>
                      <button type="button" aria-label={`Remover ${destination.label}`} onClick={() => removeDestination(destination)}>×</button>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="empty-deliveries">Nenhum destino adicionado.</p>
              )}

              <LocationPicker
                id="route-destination"
                label="Adicionar ponto"
                role="destination"
                value={newDestinationValue}
                active={activeField === "destination"}
                placeholder="Ex.: A18 ou Piscina"
                onActivate={() => setActiveField("destination")}
                onValueChange={(value) => {
                  setNewDestinationValue(value);
                  setActiveField("destination");
                }}
                onSelect={addDestination}
              />

              <button className="add-destination-button" type="button" onClick={addTypedDestination} disabled={!newDestinationValue.trim()}>
                <span aria-hidden="true">+</span> Adicionar à rota
              </button>
            </div>
          </div>

          <button className="primary-button" type="button" onClick={() => calculateRoute(originValue)}>
            Traçar melhor rota
          </button>

          <div className="hint-card">
            <strong>Também funciona pelo mapa</strong>
            <p>Ative “Adicionar ponto” e toque nas casas que deseja visitar.</p>
          </div>

          <p className="status-message" aria-live="polite">{message}</p>
        </aside>

        <section className="map-card" aria-label="Mapa interativo do condomínio">
          <div className="map-toolbar">
            <div>
              <strong>Mapa do condomínio</strong>
              <span>316 casas • quadras A a L</span>
            </div>
            <div className="map-actions" aria-label="Controles do mapa">
              <button type="button" onClick={() => zoom(.78)} aria-label="Aumentar zoom">+</button>
              <button type="button" onClick={() => zoom(1.28)} aria-label="Diminuir zoom">−</button>
              {liveMapPosition && (
                <button type="button" onClick={locateGpsOnMap} aria-label="Centralizar na minha localização">◎</button>
              )}
              <button type="button" onClick={() => setViewBox(route ? fitPoints(route.points) : INITIAL_VIEW)}>
                {route ? "Rota" : "Tudo"}
              </button>
            </div>
          </div>

          <div className="map-viewport">
            <div className="map-mode-pill" aria-live="polite">
              <i className={`dot ${gpsOriginEnabled ? "dot-gps" : `dot-${activeField}`}`} />
              {gpsOriginEnabled
                ? "GPS acompanhando sua posição em X/Y"
                : `Toque numa casa para ${activeField === "origin" ? "definir a partida" : "adicionar um destino"}`}
            </div>

            <svg
              ref={svgRef}
              className="condo-map"
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              role="img"
              aria-label="Planta interativa do Duo Jardim Paraíso"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              <g className="plan-artwork" aria-hidden="true">
                <image
                  href="/planta-condominio.svg"
                  x="0"
                  y="0"
                  width={MAP_SIZE.height}
                  height={MAP_SIZE.width}
                  preserveAspectRatio="none"
                  transform={`translate(0 ${MAP_SIZE.height}) rotate(-90)`}
                />
                <rect className="plan-redaction" x="0" y="0" width="70" height={MAP_SIZE.height} />
                <rect className="plan-redaction" x="994" y="205" width="197" height="465" />
                <rect className="plan-redaction" x="70" y="670" width="1121" height="172" />
              </g>

              <g className="road-network" aria-hidden="true">
                {roadEdges.map((edge) => {
                  const a = roadNodeIndex.get(edge.a)!;
                  const b = roadNodeIndex.get(edge.b)!;
                  return <line key={`${edge.a}-${edge.b}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />;
                })}
              </g>

              <g className="house-layer">
                {houses.map((house) => {
                  const selected = selectedIds.has(house.id);
                  const highlighted = house.quadra ? highlightedQuadras.has(house.quadra) : false;
                  return (
                    <g
                      key={house.id}
                      data-house={house.id}
                      className="house-target"
                      tabIndex={0}
                      role="button"
                      aria-label={`${house.label}. ${activeField === "origin" ? "Definir como partida" : "Adicionar como destino"}`}
                      onClick={() => chooseLocation(house)}
                      onKeyDown={(event) => handleHouseKey(event, house)}
                    >
                      <circle className="house-hit-area" cx={house.x} cy={house.y} r="11" />
                      <circle
                        className={`house-point${selected ? " selected" : ""}${highlighted ? " quadra-selected" : ""}`}
                        cx={house.x}
                        cy={house.y}
                        r={selected ? 6.5 : 4.8}
                      />
                      <title>{house.label}</title>
                    </g>
                  );
                })}
              </g>

              {route && (
                <g className="active-route" aria-hidden="true">
                  {route.legs.map((leg) => (
                    <g key={`${leg.origin.id}-${leg.destination.id}`}>
                      <polyline className="route-halo" points={leg.points.map((point) => `${point.x},${point.y}`).join(" ")} />
                      <polyline className="route-line" points={leg.points.map((point) => `${point.x},${point.y}`).join(" ")} />
                    </g>
                  ))}
                </g>
              )}

              {livePointIsVisible && liveMapPosition && (
                <g className="gps-live-marker" aria-hidden="true">
                  <circle
                    className="gps-live-accuracy"
                    cx={liveMapPosition.point.x}
                    cy={liveMapPosition.point.y}
                    r={Math.max(14, Math.min(80, liveMapPosition.accuracyInMapUnits))}
                  />
                  <circle
                    className="gps-live-pulse"
                    cx={liveMapPosition.point.x}
                    cy={liveMapPosition.point.y}
                    r="13"
                  />
                  <circle
                    className="gps-live-dot"
                    cx={liveMapPosition.point.x}
                    cy={liveMapPosition.point.y}
                    r="7"
                  />
                </g>
              )}

              <g className="route-markers" aria-hidden="true">
                {selectedOrigin && selectedOrigin.id !== "live-location" && (
                  <circle className="route-origin" cx={selectedOrigin.x} cy={selectedOrigin.y} r="9" />
                )}
                {mappedDestinations.map((destination, index) => (
                  <g className="route-stop" key={destination.id}>
                    <circle cx={destination.x} cy={destination.y} r="11" />
                    <text x={destination.x} y={destination.y}>{index + 1}</text>
                  </g>
                ))}
              </g>
            </svg>
          </div>

          <footer className="map-legend">
            <span><i className="legend-dot legend-origin" /> Partida</span>
            {liveMapPosition && <span><i className="legend-dot legend-gps" /> GPS ao vivo</span>}
            <span><i className="legend-dot legend-destination" /> Destinos numerados</span>
            <span><i className="legend-line" /> Melhor rota</span>
            <small>Planta de referência • arraste ou use pinça para navegar</small>
          </footer>
        </section>

        {route && (
          <section className="route-summary-card" aria-live="polite">
            <div className="summary-heading">
              <span className="step-number">2</span>
              <div>
                <h2>Rota calculada</h2>
                <p>{route.origin.label} + {route.destinations.length} {route.destinations.length === 1 ? "parada" : "paradas"}</p>
              </div>
            </div>

            <div className="route-total">
              <span>{route.optimization === "exact" ? "Menor sequência calculada" : "Sequência otimizada"}</span>
              <strong>{Math.round(route.coordinateDistance)} un. X/Y</strong>
            </div>

            <ol className="delivery-route">
              <li className="delivery-origin-row">
                <span className="delivery-route-marker origin-marker">P</span>
                <div><small>Partida</small><strong>{route.origin.label}</strong></div>
              </li>
              {route.legs.map((leg, index) => (
                <li key={`${leg.origin.id}-${leg.destination.id}`}>
                  <details open={index === 0}>
                    <summary>
                      <span className="delivery-route-marker">{leg.stopNumber}</span>
                      <div>
                        <small>Destino {leg.stopNumber}</small>
                        <strong>{leg.destination.label}</strong>
                      </div>
                      <span className="leg-distance">{Math.round(leg.coordinateDistance)} un.</span>
                    </summary>
                    <div className="leg-instructions">
                      <p>Saindo de <strong>{leg.origin.label}</strong></p>
                      <div>
                        {leg.segments.map((segment, segmentIndex) => (
                          <span key={`${segment.street}-${segmentIndex}`}>
                            {segment.street} • {Math.round(segment.coordinateDistance)} un.
                          </span>
                        ))}
                      </div>
                    </div>
                  </details>
                </li>
              ))}
            </ol>

            <p className="route-note">As paradas são reorganizadas automaticamente para reduzir o percurso, usando somente as ruas internas cadastradas.</p>
          </section>
        )}
      </div>
    </main>
  );
}

