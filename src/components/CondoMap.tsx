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

type HouseRecord = { id: string; label: string; quadra: string; numero: number; x: number; y: number };
type ViewBox = { x: number; y: number; width: number; height: number };
type ActiveField = "origin" | "destination";

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
  const welcomeDialogRef = useRef<HTMLDialogElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
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

  const selectedLocations = useMemo(
    () => [resolveLocation(originValue), ...destinations],
    [originValue, destinations],
  );

  const highlightedQuadras = useMemo(() => {
    const selected = new Set<string>();
    selectedLocations.forEach((location) => {
      if (location?.type === "quadra" && location.quadra) selected.add(location.quadra);
    });
    return selected;
  }, [selectedLocations]);

  const clearCalculatedRoute = () => {
    setRoute(null);
    setMessage("Revise as paradas e toque em “Otimizar rota”.");
  };

  const calculateRoute = (originRaw: string, requestedDestinations = destinations) => {
    const origin = resolveLocation(originRaw);
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
    const origin = resolveLocation(originValue);
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
  const selectedOrigin = resolveLocation(originValue);
  const mappedDestinations = route?.destinations ?? destinations;

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
              <div><strong>Diga onde você está</strong><small>Escolha a Portaria, uma casa, quadra ou área comum.</small></div>
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
            <span>Sem GPS: você informa o ponto de partida diretamente no mapa.</span>
          </div>

          <button className="welcome-start" type="button" onClick={() => welcomeDialogRef.current?.close()}>
            Entendi, começar
          </button>
        </div>
      </dialog>

      <header className="topbar">
        <div className="brand-mark" aria-hidden="true">JP</div>
        <div className="brand-copy">
          <p className="eyebrow">Duo Jardim Paraíso</p>
          <h1>Encontre seus destinos</h1>
        </div>
        <span className="coordinate-badge">Sem GPS • mapa X/Y</span>
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
              value={originValue}
              active={activeField === "origin"}
              placeholder="Ex.: Portaria ou B12"
              onActivate={() => setActiveField("origin")}
              onValueChange={(value) => {
                setOriginValue(value);
                setActiveField("origin");
                clearCalculatedRoute();
              }}
              onSelect={(location) => chooseLocation(location, "origin")}
            />

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

        <section className="map-card" aria-label="Mapa esquemático interativo do condomínio">
          <div className="map-toolbar">
            <div>
              <strong>Mapa esquemático do condomínio</strong>
              <span>316 casas • quadras A a L • coordenadas X/Y</span>
            </div>
            <div className="map-actions" aria-label="Controles do mapa">
              <button type="button" onClick={() => zoom(.78)} aria-label="Aumentar zoom">+</button>
              <button type="button" onClick={() => zoom(1.28)} aria-label="Diminuir zoom">−</button>
              <button type="button" onClick={() => setViewBox(route ? fitPoints(route.points) : INITIAL_VIEW)}>
                {route ? "Rota" : "Tudo"}
              </button>
            </div>
          </div>

          <div className="map-viewport">
            <div className="map-mode-pill" aria-live="polite">
              <i className={`dot dot-${activeField}`} />
              Toque numa casa para {activeField === "origin" ? "definir a partida" : "adicionar um destino"}
            </div>

            <svg
              ref={svgRef}
              className="condo-map"
              viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`}
              role="img"
              aria-label="Mapa esquemático interativo do Duo Jardim Paraíso"
              onWheel={handleWheel}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerEnd}
              onPointerCancel={handlePointerEnd}
            >
              <image href="/mapa-esquematico.png" x="0" y="0" width={MAP_SIZE.width} height={MAP_SIZE.height} preserveAspectRatio="none" />

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

              <g className="route-markers" aria-hidden="true">
                {selectedOrigin && <circle className="route-origin" cx={selectedOrigin.x} cy={selectedOrigin.y} r="9" />}
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
            <span><i className="legend-dot legend-destination" /> Destinos numerados</span>
            <span><i className="legend-line" /> Melhor rota</span>
            <small>Representação funcional, sem escala técnica • arraste ou use pinça para navegar</small>
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
