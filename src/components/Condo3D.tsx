"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  MAP_SIZE,
  pointsOfInterest,
  roadEdges,
  roadNodes,
  type MapLocation,
  type Point,
} from "@/data/map";

type Condo3DProps = {
  houses: MapLocation[];
  selectedIds: string[];
  routeSegments: Point[][];
  livePoint: Point | null;
  onSelectHouse: (house: MapLocation) => void;
};

type SceneApi = {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  renderer: THREE.WebGLRenderer;
  wallMesh: THREE.InstancedMesh;
  roofMesh: THREE.InstancedMesh;
  wallMatrices: THREE.Matrix4[];
  roofMatrices: THREE.Matrix4[];
  routeGroup: THREE.Group;
  liveGroup: THREE.Group;
  selectionGroup: THREE.Group;
  interiorGroup: THREE.Group;
  hemisphere: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  render: () => void;
  resetView: () => void;
  focusPoint?: (point: Point) => void;
  focusInterior?: (point: Point) => void;
};

const roadNodeIndex = new Map(roadNodes.map((node) => [node.id, node]));

const interiorRooms = [
  { label: "Quarto 1", area: "8,17 m²", color: "#91b99c" },
  { label: "Quarto 2", area: "8,17 m²", color: "#abc38f" },
  { label: "Banheiro", area: "2,83 m²", color: "#9fb9bf" },
  { label: "Sala/Jantar", area: "12,35 m²", color: "#d6b98b" },
  { label: "Cozinha", area: "5,14 m²", color: "#aaa69f" },
  { label: "Área de serviço", area: "4,76 m²", color: "#9eb7aa" },
] as const;

function toWorld(point: Point) {
  return new THREE.Vector3(point.x - MAP_SIZE.width / 2, 0, point.y - MAP_SIZE.height / 2);
}

function houseRotation(houses: MapLocation[], house: MapLocation) {
  let closest: MapLocation | null = null;
  let closestDistance = Number.POSITIVE_INFINITY;

  houses.forEach((candidate) => {
    if (candidate.id === house.id || candidate.quadra !== house.quadra) return;
    const distance = Math.hypot(candidate.x - house.x, candidate.y - house.y);
    if (distance < closestDistance) {
      closest = candidate;
      closestDistance = distance;
    }
  });

  if (!closest) return 0;
  const neighbor = closest as MapLocation;
  return -Math.atan2(neighbor.y - house.y, neighbor.x - house.x);
}

function roadDirectionForHouse(house: MapLocation) {
  let nearestPoint = { x: house.x, y: house.y - 1 };
  let nearestDistance = Number.POSITIVE_INFINITY;

  roadEdges.forEach((edge) => {
    const a = roadNodeIndex.get(edge.a);
    const b = roadNodeIndex.get(edge.b);
    if (!a || !b) return;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((house.x - a.x) * dx + (house.y - a.y) * dy) / lengthSquared));
    const point = { x: a.x + dx * projection, y: a.y + dy * projection };
    const distance = Math.hypot(point.x - house.x, point.y - house.y);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPoint = point;
    }
  });

  const length = Math.max(0.001, Math.hypot(nearestPoint.x - house.x, nearestPoint.y - house.y));
  return new THREE.Vector3(
    (nearestPoint.x - house.x) / length,
    0,
    (nearestPoint.y - house.y) / length,
  );
}

function addRoad(scene: THREE.Scene, a: Point, b: Point, material: THREE.Material) {
  const start = toWorld(a);
  const end = toWorld(b);
  const distance = start.distanceTo(end);
  const road = new THREE.Mesh(new THREE.BoxGeometry(distance, 0.65, 14), material);
  road.position.copy(start).add(end).multiplyScalar(0.5);
  road.position.y = 0.05;
  road.rotation.y = -Math.atan2(end.z - start.z, end.x - start.x);
  road.receiveShadow = true;
  scene.add(road);
}

function addRouteCylinder(
  group: THREE.Group,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
  material: THREE.Material,
) {
  const direction = end.clone().sub(start);
  const distance = direction.length();
  if (distance < 0.01) return;

  const geometry = new THREE.CylinderGeometry(radius, radius, distance, 8, 1, false);
  const cylinder = new THREE.Mesh(geometry, material);
  cylinder.position.copy(start).add(end).multiplyScalar(0.5);
  cylinder.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
  group.add(cylinder);
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => material.dispose());
  });
}

function addInteriorBox(
  group: THREE.Group,
  size: [number, number, number],
  position: [number, number, number],
  color: THREE.ColorRepresentation,
  roughness = 0.9,
) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(...size),
    new THREE.MeshStandardMaterial({ color, roughness }),
  );
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildHouseInterior(houses: MapLocation[], house: MapLocation) {
  const group = new THREE.Group();
  const position = toWorld(house);
  group.position.set(position.x, 0, position.z);
  group.rotation.y = houseRotation(houses, house);

  addInteriorBox(group, [12.1, 0.3, 14.5], [0, 0.44, 0], "#eee8dc");

  const roomFloors: Array<{
    size: [number, number, number];
    position: [number, number, number];
    color: THREE.ColorRepresentation;
  }> = [
    { size: [4.45, 0.08, 6.1], position: [-3.72, 0.63, 3.58], color: "#d9e7dc" },
    { size: [4.45, 0.08, 2.75], position: [-3.72, 0.63, -0.85], color: "#dce4e6" },
    { size: [4.45, 0.08, 4.15], position: [-3.72, 0.63, -4.28], color: "#e1e8d9" },
    { size: [6.75, 0.08, 8], position: [2.28, 0.63, 2.8], color: "#e8dcc8" },
    { size: [6.75, 0.08, 3.55], position: [2.28, 0.63, -3], color: "#dad7d0" },
    { size: [6.75, 0.08, 1.75], position: [2.28, 0.63, -5.7], color: "#d3ddd8" },
  ];
  roomFloors.forEach((room) => addInteriorBox(group, room.size, room.position, room.color));

  const wallColor = "#f6f0e5";
  addInteriorBox(group, [0.34, 2.5, 14.5], [-6.05, 1.75, 0], wallColor);
  addInteriorBox(group, [0.34, 2.5, 14.5], [6.05, 1.75, 0], wallColor);
  addInteriorBox(group, [12.1, 2.5, 0.34], [0, 1.75, -7.25], wallColor);
  addInteriorBox(group, [12.1, 1.2, 0.34], [0, 1.1, 7.25], wallColor);
  addInteriorBox(group, [0.3, 2.15, 14.1], [-1.36, 1.57, 0], wallColor);
  addInteriorBox(group, [4.55, 2.15, 0.3], [-3.7, 1.57, 0.48], wallColor);
  addInteriorBox(group, [4.55, 2.15, 0.3], [-3.7, 1.57, -2.28], wallColor);
  addInteriorBox(group, [7.05, 2.15, 0.3], [2.35, 1.57, -1.22], wallColor);
  addInteriorBox(group, [7.05, 2.15, 0.3], [2.35, 1.57, -4.78], wallColor);

  addInteriorBox(group, [3.2, 0.65, 2.15], [-3.65, 0.98, 4.65], "#f6f4ed", 0.7);
  addInteriorBox(group, [3.2, 0.65, 2.15], [-3.65, 0.98, -4.35], "#f6f4ed", 0.7);
  addInteriorBox(group, [2.8, 0.62, 1.15], [1.2, 0.97, 4.65], "#678879", 0.75);
  addInteriorBox(group, [1.15, 0.62, 2.75], [4.35, 0.97, 3.2], "#678879", 0.75);
  addInteriorBox(group, [2.3, 0.42, 1.35], [2.65, 0.84, 1.15], "#9a7655", 0.72);
  addInteriorBox(group, [5.9, 0.78, 0.78], [2.45, 1.02, -4.25], "#b7b2a9", 0.55);
  addInteriorBox(group, [0.9, 0.75, 2.65], [4.95, 1.01, -2.85], "#b7b2a9", 0.55);

  const table = new THREE.Mesh(
    new THREE.CylinderGeometry(1.05, 1.05, 0.42, 18),
    new THREE.MeshStandardMaterial({ color: "#a17a52", roughness: 0.68 }),
  );
  table.position.set(2.75, 1.05, 1.05);
  table.castShadow = true;
  group.add(table);

  const bathroomFixture = new THREE.Mesh(
    new THREE.CylinderGeometry(0.48, 0.58, 0.6, 14),
    new THREE.MeshStandardMaterial({ color: "#f7faf8", roughness: 0.4 }),
  );
  bathroomFixture.position.set(-4.55, 1, -0.85);
  bathroomFixture.castShadow = true;
  group.add(bathroomFixture);

  return group;
}

export default function Condo3D({
  houses,
  selectedIds,
  routeSegments,
  livePoint,
  onSelectHouse,
}: Condo3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<SceneApi | null>(null);
  const onSelectHouseRef = useRef(onSelectHouse);
  const [nightMode, setNightMode] = useState(false);
  const [interiorMode, setInteriorMode] = useState(false);
  const [tourMode, setTourMode] = useState(false);
  const selectedKey = selectedIds.join("|");
  const selectedHouseIds = useMemo(() => selectedKey ? selectedKey.split("|") : [], [selectedKey]);
  const activeHouse = useMemo(
    () => [...selectedHouseIds].reverse().map((id) => houses.find((house) => house.id === id)).find(Boolean),
    [houses, selectedHouseIds],
  );
  const activeHouseLabel = activeHouse?.label ?? "";

  useEffect(() => {
    onSelectHouseRef.current = onSelectHouse;
  }, [onSelectHouse]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#dce9df");
    scene.fog = new THREE.Fog("#dce9df", 850, 4200);

    const camera = new THREE.PerspectiveCamera(45, 1, 1, 3500);
    const renderer = new THREE.WebGLRenderer({
      antialias: window.devicePixelRatio <= 1.5,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.55));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.className = "condo-3d-canvas";
    renderer.domElement.setAttribute("aria-label", "Vista 3D interativa do condomínio");
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.enablePan = true;
    controls.minDistance = 65;
    controls.maxDistance = 2400;
    controls.minPolarAngle = 0.22;
    controls.maxPolarAngle = Math.PI / 2.08;
    controls.target.set(0, 0, 0);

    const hemisphere = new THREE.HemisphereLight("#f9fff8", "#6f8a70", 2.1);
    scene.add(hemisphere);

    const sun = new THREE.DirectionalLight("#fff0d2", 2.5);
    sun.position.set(-320, 620, 420);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -640;
    sun.shadow.camera.right = 640;
    sun.shadow.camera.top = 520;
    sun.shadow.camera.bottom = -520;
    sun.shadow.camera.near = 50;
    sun.shadow.camera.far = 1400;
    scene.add(sun);

    const groundMaterial = new THREE.MeshStandardMaterial({ color: "#afc99d", roughness: 1 });
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(MAP_SIZE.width + 90, MAP_SIZE.height + 90),
      groundMaterial,
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.55;
    ground.receiveShadow = true;
    scene.add(ground);

    const roadMaterial = new THREE.MeshStandardMaterial({ color: "#5d6661", roughness: 0.94 });
    roadEdges.forEach((edge) => {
      const a = roadNodeIndex.get(edge.a);
      const b = roadNodeIndex.get(edge.b);
      if (a && b) addRoad(scene, a, b, roadMaterial);
    });

    const boundaryPoints = [
      new THREE.Vector3(-MAP_SIZE.width / 2, 0.4, -MAP_SIZE.height / 2),
      new THREE.Vector3(MAP_SIZE.width / 2, 0.4, -MAP_SIZE.height / 2),
      new THREE.Vector3(MAP_SIZE.width / 2, 0.4, MAP_SIZE.height / 2),
      new THREE.Vector3(-MAP_SIZE.width / 2, 0.4, MAP_SIZE.height / 2),
    ];
    const boundaryGeometry = new THREE.BufferGeometry().setFromPoints([...boundaryPoints, boundaryPoints[0]]);
    scene.add(new THREE.Line(boundaryGeometry, new THREE.LineBasicMaterial({ color: "#527b61" })));

    const foundationGeometry = new THREE.BoxGeometry(13.8, 0.8, 16.5);
    const wallGeometry = new THREE.BoxGeometry(12.4, 7.4, 14.8);
    const roofGeometry = new THREE.ConeGeometry(1, 4.3, 4, 1, false).rotateY(Math.PI / 4);
    const foundationMesh = new THREE.InstancedMesh(
      foundationGeometry,
      new THREE.MeshStandardMaterial({ color: "#d6d0be", roughness: 1 }),
      houses.length,
    );
    const wallMesh = new THREE.InstancedMesh(
      wallGeometry,
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.88 }),
      houses.length,
    );
    const roofMesh = new THREE.InstancedMesh(
      roofGeometry,
      new THREE.MeshStandardMaterial({ color: "#ffffff", roughness: 0.82 }),
      houses.length,
    );
    const houseHitMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(18, 18, 19),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      houses.length,
    );
    const doorMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(1.9, 4.7, 0.32),
      new THREE.MeshStandardMaterial({ color: "#365a4a", roughness: 0.72 }),
      houses.length,
    );
    const windowFrameGeometry = new THREE.BoxGeometry(3.18, 3.2, 0.3);
    const windowFrameMaterial = new THREE.MeshStandardMaterial({ color: "#f7f2e7", roughness: 0.82 });
    const windowFrameMeshA = new THREE.InstancedMesh(windowFrameGeometry, windowFrameMaterial, houses.length);
    const windowFrameMeshB = new THREE.InstancedMesh(windowFrameGeometry, windowFrameMaterial.clone(), houses.length);
    const windowGeometry = new THREE.BoxGeometry(2.7, 2.75, 0.24);
    const windowMaterial = new THREE.MeshStandardMaterial({
      color: "#9dc6c3",
      emissive: "#162927",
      emissiveIntensity: 0.2,
      metalness: 0.08,
      roughness: 0.35,
    });
    const windowMeshA = new THREE.InstancedMesh(windowGeometry, windowMaterial, houses.length);
    const windowMeshB = new THREE.InstancedMesh(windowGeometry, windowMaterial.clone(), houses.length);
    const porchSlabMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(10.8, 0.52, 4.2),
      new THREE.MeshStandardMaterial({ color: "#c9c3b5", roughness: 1 }),
      houses.length,
    );
    const porchCanopyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(11.25, 0.45, 4.45),
      new THREE.MeshStandardMaterial({ color: "#e7ddca", roughness: 0.9 }),
      houses.length,
    );
    const porchColumnGeometry = new THREE.BoxGeometry(0.65, 6.45, 0.65);
    const porchColumnMaterial = new THREE.MeshStandardMaterial({ color: "#dfd5c3", roughness: 0.9 });
    const porchColumnMeshA = new THREE.InstancedMesh(porchColumnGeometry, porchColumnMaterial, houses.length);
    const porchColumnMeshB = new THREE.InstancedMesh(porchColumnGeometry, porchColumnMaterial.clone(), houses.length);
    const walkwayMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(2.3, 0.18, 8.4),
      new THREE.MeshStandardMaterial({ color: "#d7d2c6", roughness: 1 }),
      houses.length,
    );
    const chimneyMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.72, 4.7, 0.72),
      new THREE.MeshStandardMaterial({ color: "#ddd4c3", roughness: 0.9 }),
      houses.length,
    );

    const dummy = new THREE.Object3D();
    const wallMatrices: THREE.Matrix4[] = [];
    const roofMatrices: THREE.Matrix4[] = [];
    houses.forEach((house, index) => {
      const position = toWorld(house);
      const rotation = houseRotation(houses, house);

      dummy.position.set(position.x, 0, position.z);
      dummy.rotation.set(0, rotation, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      foundationMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.y = 4.05;
      dummy.updateMatrix();
      wallMesh.setMatrixAt(index, dummy.matrix);
      wallMatrices[index] = dummy.matrix.clone();

      dummy.position.y = 9;
      dummy.updateMatrix();
      houseHitMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.y = 9.85;
      dummy.scale.set(12.4 / Math.SQRT2, 1, 14.8 / Math.SQRT2);
      dummy.updateMatrix();
      roofMesh.setMatrixAt(index, dummy.matrix);
      roofMatrices[index] = dummy.matrix.clone();

      const forward = roadDirectionForHouse(house);
      const sideways = new THREE.Vector3(forward.z, 0, -forward.x);
      const facadeCenter = position.clone().addScaledVector(forward, 7.5);
      const facadeRotation = Math.atan2(forward.x, forward.z);

      dummy.scale.set(1, 1, 1);
      dummy.rotation.set(0, facadeRotation, 0);
      dummy.position.copy(facadeCenter).addScaledVector(forward, 2.05);
      dummy.position.y = 0.22;
      dummy.updateMatrix();
      porchSlabMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.y = 7.05;
      dummy.updateMatrix();
      porchCanopyMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(facadeCenter).addScaledVector(forward, 3.65).addScaledVector(sideways, -4.75);
      dummy.position.y = 3.52;
      dummy.updateMatrix();
      porchColumnMeshA.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(facadeCenter).addScaledVector(forward, 3.65).addScaledVector(sideways, 4.75);
      dummy.updateMatrix();
      porchColumnMeshB.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(facadeCenter).addScaledVector(forward, 7.95).addScaledVector(sideways, -3.6);
      dummy.position.y = 0.08;
      dummy.updateMatrix();
      walkwayMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(facadeCenter).addScaledVector(sideways, -3.6);
      dummy.position.y = 2.75;
      dummy.updateMatrix();
      doorMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(facadeCenter).addScaledVector(sideways, -0.55);
      dummy.position.y = 4.15;
      dummy.updateMatrix();
      windowFrameMeshA.setMatrixAt(index, dummy.matrix);
      dummy.position.addScaledVector(forward, 0.18);
      dummy.updateMatrix();
      windowMeshA.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(facadeCenter).addScaledVector(sideways, 3.15);
      dummy.position.y = 4.15;
      dummy.updateMatrix();
      windowFrameMeshB.setMatrixAt(index, dummy.matrix);
      dummy.position.addScaledVector(forward, 0.18);
      dummy.updateMatrix();
      windowMeshB.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(position).addScaledVector(sideways, 3.8).addScaledVector(forward, -1.2);
      dummy.position.y = 9.2;
      dummy.updateMatrix();
      chimneyMesh.setMatrixAt(index, dummy.matrix);
    });

    foundationMesh.receiveShadow = true;
    wallMesh.castShadow = true;
    wallMesh.receiveShadow = true;
    roofMesh.castShadow = true;
    roofMesh.receiveShadow = true;
    porchSlabMesh.receiveShadow = true;
    porchCanopyMesh.castShadow = true;
    porchCanopyMesh.receiveShadow = true;
    porchColumnMeshA.castShadow = true;
    porchColumnMeshB.castShadow = true;
    walkwayMesh.receiveShadow = true;
    scene.add(
      foundationMesh,
      wallMesh,
      roofMesh,
      porchSlabMesh,
      porchCanopyMesh,
      porchColumnMeshA,
      porchColumnMeshB,
      walkwayMesh,
      chimneyMesh,
      doorMesh,
      windowFrameMeshA,
      windowFrameMeshB,
      windowMeshA,
      windowMeshB,
      houseHitMesh,
    );

    pointsOfInterest.forEach((point) => {
      const position = toWorld(point);
      const isPool = point.id === "piscina";
      const isCourt = point.id.includes("quadra") || point.id.includes("volei");
      const marker = new THREE.Mesh(
        new THREE.CylinderGeometry(isPool ? 13 : 9, isPool ? 13 : 9, 1.5, 20),
        new THREE.MeshStandardMaterial({
          color: isPool ? "#4aa8d8" : isCourt ? "#d59d55" : "#3f8d68",
          roughness: 0.78,
        }),
      );
      marker.position.set(position.x, 0.6, position.z);
      marker.receiveShadow = true;
      scene.add(marker);
    });

    const routeGroup = new THREE.Group();
    const liveGroup = new THREE.Group();
    const selectionGroup = new THREE.Group();
    const interiorGroup = new THREE.Group();
    scene.add(routeGroup, liveGroup, selectionGroup, interiorGroup);

    const render = () => renderer.render(scene, camera);
    let cameraAnimationFrame = 0;

    const setOverviewCamera = () => {
      window.cancelAnimationFrame(cameraAnimationFrame);
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      const aspect = width / height;
      const verticalSpan = Math.max(MAP_SIZE.height, MAP_SIZE.width / Math.max(aspect, 0.9));
      const distance = (verticalSpan / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      controls.target.set(0, 0, 0);
      camera.position.set(0, distance * 0.66, distance * 0.82);
      camera.near = Math.max(1, distance / 1000);
      camera.far = Math.max(3500, distance * 4);
      camera.updateProjectionMatrix();
      if (scene.fog instanceof THREE.Fog) {
        scene.fog.near = Math.min(850, distance * 0.4);
        scene.fog.far = Math.max(2400, distance * 1.8);
      }
      controls.update();
      render();
    };

    const animateCamera = (endTarget: THREE.Vector3, endCamera: THREE.Vector3, duration = 420) => {
      window.cancelAnimationFrame(cameraAnimationFrame);
      const startAt = performance.now();
      const startTarget = controls.target.clone();
      const startCamera = camera.position.clone();

      const animate = (time: number) => {
        const progress = Math.min(1, (time - startAt) / duration);
        const eased = 1 - (1 - progress) ** 3;
        controls.target.lerpVectors(startTarget, endTarget, eased);
        camera.position.lerpVectors(startCamera, endCamera, eased);
        camera.lookAt(controls.target);
        render();
        if (progress < 1) cameraAnimationFrame = window.requestAnimationFrame(animate);
      };
      cameraAnimationFrame = window.requestAnimationFrame(animate);
    };

    const focusPoint = (point: Point) => {
      const destination = toWorld(point);
      const endTarget = new THREE.Vector3(destination.x, 3.5, destination.z);
      const direction = camera.position.clone().sub(controls.target).normalize();
      if (direction.y < 0.38) direction.y = 0.38;
      const endCamera = endTarget.clone().add(direction.normalize().multiplyScalar(145));
      animateCamera(endTarget, endCamera);
    };

    const focusInterior = (point: Point) => {
      const destination = toWorld(point);
      const endTarget = new THREE.Vector3(destination.x, 0.8, destination.z);
      const endCamera = new THREE.Vector3(destination.x + 26, 82, destination.z + 36);
      animateCamera(endTarget, endCamera, 520);
    };

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      render();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    controls.addEventListener("change", render);
    resize();
    setOverviewCamera();

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | null = null;
    let pointerMoved = false;

    const handlePointerDown = (event: globalThis.PointerEvent) => {
      setTourMode(false);
      pointerStart = { x: event.clientX, y: event.clientY };
      pointerMoved = false;
    };

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (pointerStart && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 7) {
        pointerMoved = true;
      }
    };

    const handleClick = (event: globalThis.MouseEvent) => {
      if (pointerMoved) return;

      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects([houseHitMesh, roofMesh, wallMesh], false)[0];
      if (hit?.instanceId === undefined) return;

      const house = houses[hit.instanceId];
      if (!house) return;
      onSelectHouseRef.current(house);
    };

    renderer.domElement.addEventListener("pointerdown", handlePointerDown);
    renderer.domElement.addEventListener("pointermove", handlePointerMove);
    renderer.domElement.addEventListener("click", handleClick);

    apiRef.current = {
      scene,
      camera,
      controls,
      renderer,
      wallMesh,
      roofMesh,
      wallMatrices,
      roofMatrices,
      routeGroup,
      liveGroup,
      selectionGroup,
      interiorGroup,
      hemisphere,
      sun,
      render,
      resetView: setOverviewCamera,
      focusPoint,
      focusInterior,
    };

    return () => {
      apiRef.current = null;
      window.cancelAnimationFrame(cameraAnimationFrame);
      resizeObserver.disconnect();
      controls.removeEventListener("change", render);
      controls.dispose();
      renderer.domElement.removeEventListener("pointerdown", handlePointerDown);
      renderer.domElement.removeEventListener("pointermove", handlePointerMove);
      renderer.domElement.removeEventListener("click", handleClick);
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh) child.geometry.dispose();
      });
      const materials = new Set<THREE.Material>();
      scene.traverse((child) => {
        if (!(child instanceof THREE.Mesh || child instanceof THREE.Line)) return;
        const childMaterials = Array.isArray(child.material) ? child.material : [child.material];
        childMaterials.forEach((material) => materials.add(material));
      });
      materials.forEach((material) => material.dispose());
      renderer.dispose();
      container.removeChild(renderer.domElement);
    };
  }, [houses]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    const selected = new Set(selectedHouseIds);
    const wallDefault = new THREE.Color("#eadfc8");
    const roofDefault = new THREE.Color("#c96f4e");
    const wallSelected = new THREE.Color("#fff2d8");
    const roofSelected = new THREE.Color("#ef6a3b");

    houses.forEach((house, index) => {
      api.wallMesh.setColorAt(index, selected.has(house.id) ? wallSelected : wallDefault);
      api.roofMesh.setColorAt(index, selected.has(house.id) ? roofSelected : roofDefault);
    });
    if (api.wallMesh.instanceColor) api.wallMesh.instanceColor.needsUpdate = true;
    if (api.roofMesh.instanceColor) api.roofMesh.instanceColor.needsUpdate = true;

    disposeObject(api.selectionGroup);
    api.selectionGroup.clear();
    selectedHouseIds.forEach((id, index) => {
      const house = houses.find((candidate) => candidate.id === id);
      if (!house) return;
      const position = toWorld(house);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(9.7, 11.2, 32),
        new THREE.MeshBasicMaterial({
          color: index === selectedHouseIds.length - 1 ? "#ff6a3c" : "#f3a27f",
          transparent: true,
          opacity: 0.9,
          side: THREE.DoubleSide,
          depthTest: false,
        }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(position.x, 0.76, position.z);
      ring.renderOrder = 5;

      const beacon = new THREE.Mesh(
        new THREE.SphereGeometry(2.25, 12, 8),
        new THREE.MeshBasicMaterial({ color: "#ff6a3c", depthTest: false }),
      );
      beacon.position.set(position.x, 18.5, position.z);
      beacon.renderOrder = 5;
      api.selectionGroup.add(ring, beacon);
    });

    const lastSelectedHouse = [...selectedHouseIds].reverse().map((id) => houses.find((house) => house.id === id)).find(Boolean);
    if (lastSelectedHouse) {
      api.focusPoint?.(lastSelectedHouse);
    }
    api.render();
  }, [houses, selectedHouseIds]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    api.wallMatrices.forEach((matrix, index) => api.wallMesh.setMatrixAt(index, matrix));
    api.roofMatrices.forEach((matrix, index) => api.roofMesh.setMatrixAt(index, matrix));
    api.wallMesh.instanceMatrix.needsUpdate = true;
    api.roofMesh.instanceMatrix.needsUpdate = true;
    disposeObject(api.interiorGroup);
    api.interiorGroup.clear();

    if (!interiorMode || !activeHouse) {
      if (activeHouse) api.focusPoint?.(activeHouse);
      api.render();
      return;
    }

    const activeIndex = houses.findIndex((house) => house.id === activeHouse.id);
    if (activeIndex < 0) return;
    const hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
    const position = toWorld(activeHouse);
    hiddenMatrix.setPosition(position);
    api.wallMesh.setMatrixAt(activeIndex, hiddenMatrix);
    api.roofMesh.setMatrixAt(activeIndex, hiddenMatrix);
    api.wallMesh.instanceMatrix.needsUpdate = true;
    api.roofMesh.instanceMatrix.needsUpdate = true;
    api.interiorGroup.add(buildHouseInterior(houses, activeHouse));
    api.focusInterior?.(activeHouse);
    api.render();
  }, [activeHouse, houses, interiorMode]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    disposeObject(api.routeGroup);
    api.routeGroup.clear();

    const haloMaterial = new THREE.MeshBasicMaterial({ color: "#fffdf8" });
    const routeMaterial = new THREE.MeshBasicMaterial({ color: "#ef5f35" });

    routeSegments.forEach((segment) => {
      for (let index = 1; index < segment.length; index += 1) {
        const start = toWorld(segment[index - 1]);
        const end = toWorld(segment[index]);
        start.y = 2.1;
        end.y = 2.1;
        addRouteCylinder(api.routeGroup, start, end, 3.6, haloMaterial.clone());
        addRouteCylinder(api.routeGroup, start, end, 2.15, routeMaterial.clone());
      }
    });
    api.render();
  }, [routeSegments]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    disposeObject(api.liveGroup);
    api.liveGroup.clear();

    if (livePoint) {
      const position = toWorld(livePoint);
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(7, 18, 12),
        new THREE.MeshBasicMaterial({ color: "#2477d4" }),
      );
      marker.position.set(position.x, 10, position.z);
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(10, 13, 28),
        new THREE.MeshBasicMaterial({ color: "#78b7f0", transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(position.x, 1.2, position.z);
      api.liveGroup.add(marker, ring);
    }
    api.render();
  }, [livePoint]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;
    const background = nightMode ? "#081a29" : "#dce9df";
    api.scene.background = new THREE.Color(background);
    const cameraDistance = api.camera.position.distanceTo(api.controls.target);
    api.scene.fog = new THREE.Fog(
      background,
      Math.min(nightMode ? 720 : 850, cameraDistance * 0.4),
      Math.max(nightMode ? 2200 : 2400, cameraDistance * 1.8),
    );
    api.hemisphere.color.set(nightMode ? "#9bbcff" : "#f9fff8");
    api.hemisphere.groundColor.set(nightMode ? "#29483f" : "#6f8a70");
    api.hemisphere.intensity = nightMode ? 2 : 2.1;
    api.sun.color.set(nightMode ? "#b8ccff" : "#fff0d2");
    api.sun.intensity = nightMode ? 1.75 : 2.5;
    api.renderer.toneMappingExposure = nightMode ? 1.08 : 1.05;
    const wallMaterial = api.wallMesh.material as THREE.MeshStandardMaterial;
    const roofMaterial = api.roofMesh.material as THREE.MeshStandardMaterial;
    wallMaterial.emissive.set(nightMode ? "#2f2417" : "#000000");
    wallMaterial.emissiveIntensity = nightMode ? 0.5 : 0;
    roofMaterial.emissive.set(nightMode ? "#26100b" : "#000000");
    roofMaterial.emissiveIntensity = nightMode ? 0.25 : 0;
    api.render();
  }, [nightMode]);

  useEffect(() => {
    const api = apiRef.current;
    if (!api) return;

    let animationFrame = 0;
    api.controls.autoRotate = tourMode;
    api.controls.autoRotateSpeed = 1.25;

    if (tourMode) {
      const animateTour = () => {
        api.controls.update();
        animationFrame = window.requestAnimationFrame(animateTour);
      };
      animationFrame = window.requestAnimationFrame(animateTour);
    } else {
      api.controls.update();
      api.render();
    }

    return () => {
      window.cancelAnimationFrame(animationFrame);
      api.controls.autoRotate = false;
    };
  }, [tourMode]);

  return (
    <div ref={containerRef} className="condo-3d" role="application" aria-label="Navegação 3D do condomínio">
      <div className="condo-3d-actions" aria-label="Controles da visualização 3D">
        <button
          type="button"
          onClick={() => {
            setTourMode(false);
            apiRef.current?.resetView();
          }}
        >
          Visão geral
        </button>
        {activeHouse && (
          <button
            type="button"
            onClick={() => {
              setTourMode(false);
              setInteriorMode(false);
              apiRef.current?.focusPoint?.(activeHouse);
            }}
          >
            Ver casa
          </button>
        )}
        {activeHouse && (
          <button
            type="button"
            aria-pressed={interiorMode}
            onClick={() => setInteriorMode((current) => !current)}
          >
            {interiorMode ? "Ver fachada" : "Ver por dentro"}
          </button>
        )}
        {activeHouse && (
          <button
            type="button"
            aria-pressed={tourMode}
            className={tourMode ? "active" : undefined}
            onClick={() => setTourMode((current) => !current)}
          >
            {tourMode ? "Parar tour" : "Tour 360°"}
          </button>
        )}
        <button type="button" aria-pressed={nightMode} onClick={() => setNightMode((current) => !current)}>
          {nightMode ? "Modo dia" : "Modo noite"}
        </button>
      </div>
      {interiorMode && activeHouse && (
        <div className="condo-3d-room-list" aria-label="Ambientes e áreas aproximadas da casa">
          {interiorRooms.map((room) => (
            <span key={room.label}>
              <i style={{ backgroundColor: room.color }} />
              <strong>{room.label}</strong>
              <small>{room.area}</small>
            </span>
          ))}
        </div>
      )}
      <div className="condo-3d-selection" aria-live="polite">
        <div>
          <strong>{activeHouseLabel || "Toque numa casa"}</strong>
          <small>
            {interiorMode
              ? "Planta aberta • 2 quartos • aproximadamente 47 m² úteis"
              : activeHouseLabel
                ? "Modelo padrão Casa 2/4"
                : "Todas as casas usam o mesmo modelo-base"}
          </small>
        </div>
        <span>{tourMode ? "Tour em execução • toque para assumir o controle" : "Arraste para girar • pinça para ampliar"}</span>
      </div>
    </div>
  );
}
