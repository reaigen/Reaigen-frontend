"use client";

import * as React from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { robustPointCloudBounds } from "../lib/point-cloud-bounds";

type PlyScalar =
  | "char" | "int8" | "uchar" | "uint8"
  | "short" | "int16" | "ushort" | "uint16"
  | "int" | "int32" | "uint" | "uint32"
  | "float" | "float32" | "double" | "float64";

interface PlyProperty {
  name: string;
  type: PlyScalar;
  offset: number;
  bytes: number;
}

interface ParsedPointCloud {
  positions: Float32Array;
  colors: Float32Array;
  count: number;
}

const MAX_POINTS = 500_000;
const SH_C0 = 0.28209479177387814;
const TYPE_BYTES: Record<PlyScalar, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

function scalar(view: DataView, offset: number, type: PlyScalar): number {
  switch (type) {
    case "char": case "int8": return view.getInt8(offset);
    case "uchar": case "uint8": return view.getUint8(offset);
    case "short": case "int16": return view.getInt16(offset, true);
    case "ushort": case "uint16": return view.getUint16(offset, true);
    case "int": case "int32": return view.getInt32(offset, true);
    case "uint": case "uint32": return view.getUint32(offset, true);
    case "float": case "float32": return view.getFloat32(offset, true);
    case "double": case "float64": return view.getFloat64(offset, true);
  }
}

function headerEnd(bytes: Uint8Array): number {
  const marker = new TextEncoder().encode("end_header\n");
  const limit = Math.min(bytes.length, 128 * 1024);
  outer: for (let index = 0; index <= limit - marker.length; index += 1) {
    for (let part = 0; part < marker.length; part += 1) {
      if (bytes[index + part] !== marker[part]) continue outer;
    }
    return index + marker.length;
  }
  throw new Error("Point-cloud header is invalid.");
}

function parsePointCloud(buffer: ArrayBuffer): ParsedPointCloud {
  const bytes = new Uint8Array(buffer);
  const bodyOffset = headerEnd(bytes);
  const header = new TextDecoder("ascii").decode(bytes.subarray(0, bodyOffset));
  const lines = header.split(/\r?\n/);
  if (lines[0] !== "ply" || !lines.includes("format binary_little_endian 1.0")) {
    throw new Error("Point-cloud format is unsupported.");
  }

  let vertexCount = -1;
  let inVertices = false;
  let stride = 0;
  const properties: PlyProperty[] = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts[0] === "element") {
      inVertices = parts[1] === "vertex";
      if (inVertices) vertexCount = Number(parts[2]);
      continue;
    }
    if (!inVertices || parts[0] !== "property") continue;
    if (parts[1] === "list") throw new Error("Point-cloud vertex lists are unsupported.");
    const type = parts[1] as PlyScalar;
    const size = TYPE_BYTES[type];
    if (!size || !parts[2]) throw new Error("Point-cloud property is invalid.");
    properties.push({ name: parts[2], type, offset: stride, bytes: size });
    stride += size;
  }
  if (!Number.isInteger(vertexCount) || vertexCount <= 0 || vertexCount > MAX_POINTS || stride <= 0) {
    throw new Error("Point-cloud size is invalid.");
  }
  if (bodyOffset + vertexCount * stride > buffer.byteLength) {
    throw new Error("Point-cloud body is truncated.");
  }

  const byName = new Map(properties.map((property) => [property.name, property]));
  const xyz = [byName.get("x"), byName.get("y"), byName.get("z")];
  const rgb = [byName.get("red"), byName.get("green"), byName.get("blue")];
  const legacyDc = [byName.get("f_dc_0"), byName.get("f_dc_1"), byName.get("f_dc_2")];
  if (xyz.some((property) => !property)) throw new Error("Point-cloud positions are missing.");
  const hasRgb = rgb.every(Boolean);
  const hasLegacyDc = legacyDc.every(Boolean);
  if (!hasRgb && !hasLegacyDc) throw new Error("Point-cloud colors are missing.");

  const view = new DataView(buffer);
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  let valid = 0;
  for (let index = 0; index < vertexCount; index += 1) {
    const base = bodyOffset + index * stride;
    const x = scalar(view, base + xyz[0]!.offset, xyz[0]!.type);
    const y = scalar(view, base + xyz[1]!.offset, xyz[1]!.type);
    const z = scalar(view, base + xyz[2]!.offset, xyz[2]!.type);
    if (![x, y, z].every(Number.isFinite)) continue;
    const target = valid * 3;
    positions[target] = x;
    positions[target + 1] = y;
    positions[target + 2] = z;
    for (let channel = 0; channel < 3; channel += 1) {
      // Older preview artifacts stored only their constant color coefficient.
      // Read that color for rollout compatibility, but always render geometry
      // as THREE.Points and ignore scale, opacity, rotation, and covariance.
      const value = hasRgb
        ? scalar(view, base + rgb[channel]!.offset, rgb[channel]!.type) / 255
        : 0.5 + SH_C0 * scalar(
          view,
          base + legacyDc[channel]!.offset,
          legacyDc[channel]!.type,
        );
      colors[target + channel] = THREE.MathUtils.clamp(
        value,
        0,
        1,
      );
    }
    valid += 1;
  }
  if (valid <= 0) throw new Error("Point cloud contains no finite points.");
  return {
    positions: valid === vertexCount ? positions : positions.slice(0, valid * 3),
    colors: valid === vertexCount ? colors : colors.slice(0, valid * 3),
    count: valid,
  };
}

function decodeBase64PointCloud(encoded: string): ArrayBuffer {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

interface Props {
  pointCloudUrl: string;
  inlinePointCloudBase64?: string;
  gaugeRevision?: number;
  showFloorGrid?: boolean;
  className?: string;
  onError?: (reason: string) => void;
}

export default function ScanningPointCloudViewer({
  pointCloudUrl,
  inlinePointCloudBase64 = "",
  gaugeRevision = 0,
  showFloorGrid = false,
  className = "",
  onError,
}: Props) {
  const hostRef = React.useRef<HTMLDivElement>(null);
  const sceneRef = React.useRef<THREE.Scene | null>(null);
  const cameraRef = React.useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = React.useRef<OrbitControls | null>(null);
  const pointsRef = React.useRef<THREE.Points | null>(null);
  const gridRef = React.useRef<THREE.GridHelper | null>(null);
  const radiusRef = React.useRef(0);
  const gaugeRevisionRef = React.useRef<number | null>(null);
  const framedRef = React.useRef(false);
  const [loading, setLoading] = React.useState(true);

  const updateGrid = React.useCallback((radius: number) => {
    const scene = sceneRef.current;
    if (!scene) return;
    if (gridRef.current) {
      scene.remove(gridRef.current);
      gridRef.current.geometry.dispose();
      const oldMaterials = Array.isArray(gridRef.current.material)
        ? gridRef.current.material
        : [gridRef.current.material];
      oldMaterials.forEach((material) => material.dispose());
      gridRef.current = null;
    }
    if (!showFloorGrid) return;
    const size = Math.max(2, radius * 4);
    const divisions = Math.max(10, Math.min(80, Math.round(size)));
    const grid = new THREE.GridHelper(size, divisions, 0x52708f, 0x283747);
    const materials = Array.isArray(grid.material) ? grid.material : [grid.material];
    materials.forEach((material) => {
      material.transparent = true;
      material.opacity = 0.32;
      material.depthWrite = false;
    });
    grid.position.y = 0;
    scene.add(grid);
    gridRef.current = grid;
  }, [showFloorGrid]);

  React.useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111215);
    const camera = new THREE.PerspectiveCamera(55, 1, 0.01, 10_000);
    camera.up.set(0, 1, 0);
    camera.position.set(3, 2, 3);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.6));
    host.appendChild(renderer.domElement);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.screenSpacePanning = true;
    controls.target.set(0, 0.8, 0);
    const resize = () => {
      const width = Math.max(1, host.clientWidth);
      const height = Math.max(1, host.clientHeight);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    sceneRef.current = scene;
    cameraRef.current = camera;
    controlsRef.current = controls;
    return () => {
      observer.disconnect();
      renderer.setAnimationLoop(null);
      controls.dispose();
      pointsRef.current?.geometry.dispose();
      (pointsRef.current?.material as THREE.Material | undefined)?.dispose();
      gridRef.current?.geometry.dispose();
      const gridMaterial = gridRef.current?.material;
      if (gridMaterial) {
        const materials = Array.isArray(gridMaterial) ? gridMaterial : [gridMaterial];
        materials.forEach((material) => material.dispose());
      }
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      pointsRef.current = null;
      gridRef.current = null;
    };
  }, []);

  React.useEffect(() => {
    updateGrid(radiusRef.current);
  }, [showFloorGrid, updateGrid]);

  React.useEffect(() => {
    const controller = new AbortController();
    if (!pointsRef.current) setLoading(true);
    void (async () => {
      const renderPointCloud = (buffer: ArrayBuffer): boolean => {
        const parsed = parsePointCloud(buffer);
        if (controller.signal.aborted) return false;
        const scene = sceneRef.current;
        const camera = cameraRef.current;
        const controls = controlsRef.current;
        if (!scene || !camera || !controls) return false;
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(parsed.positions, 3));
        geometry.setAttribute("color", new THREE.BufferAttribute(parsed.colors, 3));
        geometry.computeBoundingSphere();
        if (!geometry.boundingSphere || !Number.isFinite(geometry.boundingSphere.radius)) {
          throw new Error("Point-cloud bounds are invalid.");
        }
        const bounds = robustPointCloudBounds(parsed.positions);
        const center = new THREE.Vector3(...bounds.center);
        const radius = bounds.radius;
        const material = new THREE.PointsMaterial({
          size: THREE.MathUtils.clamp(radius / 180, 0.006, 0.055),
          sizeAttenuation: true,
          vertexColors: true,
          transparent: true,
          opacity: 0.96,
          depthWrite: true,
        });
        const points = new THREE.Points(geometry, material);
        points.frustumCulled = true;
        if (pointsRef.current) {
          scene.remove(pointsRef.current);
          pointsRef.current.geometry.dispose();
          (pointsRef.current.material as THREE.Material).dispose();
        }
        scene.add(points);
        pointsRef.current = points;
        const gaugeChanged = (
          gaugeRevisionRef.current !== null
          && gaugeRevisionRef.current !== gaugeRevision
        );
        camera.near = Math.max(radius / 5_000, 0.002);
        camera.far = Math.max(radius * 1_000, 100);
        camera.updateProjectionMatrix();
        // A growing cloud must remain visually fixed in one world. Reframing
        // on changing bounds made a valid same-gauge update look like the room
        // jumped or reset. Only the first cloud, or an explicit backend gauge
        // revision, may move the viewer camera.
        const needsFrame = !framedRef.current || gaugeChanged;
        if (needsFrame) {
          const direction = new THREE.Vector3(1.35, 0.9, 1.35).normalize();
          controls.target.copy(center);
          camera.position.copy(center).addScaledVector(direction, radius * 2.8);
          controls.update();
          framedRef.current = true;
        }
        radiusRef.current = radius;
        gaugeRevisionRef.current = gaugeRevision;
        updateGrid(radius);
        setLoading(false);
        return true;
      };

      try {
        let renderedInline = false;
        let inlineError: unknown = null;
        if (inlinePointCloudBase64) {
          try {
            renderedInline = renderPointCloud(
              decodeBase64PointCloud(inlinePointCloudBase64),
            );
          } catch (error) {
            inlineError = error;
          }
        }
        if (pointCloudUrl) {
          try {
            const response = await fetch(pointCloudUrl, {
              cache: "no-store",
              signal: controller.signal,
            });
            if (!response.ok) {
              throw new Error(`Point-cloud download failed (${response.status}).`);
            }
            renderPointCloud(await response.arrayBuffer());
            return;
          } catch (error) {
            if (!renderedInline) throw error;
            return;
          }
        }
        if (!renderedInline) {
          throw inlineError instanceof Error
            ? inlineError
            : new Error("Point-cloud transport is unavailable.");
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoading(false);
        onError?.(error instanceof Error ? error.message : "Point cloud could not be displayed.");
      }
    })();
    return () => controller.abort();
  }, [gaugeRevision, inlinePointCloudBase64, onError, pointCloudUrl, updateGrid]);

  return (
    <div className={`relative overflow-hidden bg-[#111215] ${className}`}>
      <div ref={hostRef} className="absolute inset-0" />
      {loading ? (
        <div className="pointer-events-none absolute inset-0 grid place-items-center bg-[#111215]/35">
          <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80 motion-reduce:animate-none" />
        </div>
      ) : null}
    </div>
  );
}

export { parsePointCloud };
