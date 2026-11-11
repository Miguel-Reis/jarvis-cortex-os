import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { Box, Compass, Eye, Layers, RotateCcw } from 'lucide-react';
import type { SwarmLane, SwarmRun } from '../shared/types';

interface FileHeatEntry {
  filePath: string;
  symbolCount: number;
}

interface SwarmOffice3DProps {
  latestRun?: SwarmRun;
  fileHeatmap: FileHeatEntry[];
  sandboxesCount: number;
  selectedLane: SwarmLane | null;
  onSelectLane: (lane: SwarmLane | null) => void;
  onSelectFile?: (filePath: string) => void;
}

const LANE_CONFIG: {
  lane: SwarmLane;
  label: string;
  specialist: string;
  pos: [number, number];
  hex: number;
  cssText: string;
}[] = [
  {
    lane: 'UI',
    label: 'Lane UI · Frontend & 3D',
    specialist: 'UI-ARCHITECT-01',
    pos: [-5.2, -3.8],
    hex: 0x06b6d4,
    cssText: 'text-cyan-300',
  },
  {
    lane: 'API',
    label: 'Lane API · Express & MCP',
    specialist: 'API-GATEWAY-01',
    pos: [5.2, -3.8],
    hex: 0xf59e0b,
    cssText: 'text-amber-300',
  },
  {
    lane: 'TESTS',
    label: 'Lane TESTS · Verify Gates',
    specialist: 'QA-SENTINEL-01',
    pos: [-5.2, 3.8],
    hex: 0x10b981,
    cssText: 'text-emerald-300',
  },
  {
    lane: 'DOCS',
    label: 'Lane DOCS · Lineage & DOTS',
    specialist: 'DOCS-CURATOR-01',
    pos: [5.2, 3.8],
    hex: 0x38bdf8,
    cssText: 'text-sky-300',
  },
];

type CameraPreset = 'ISO' | 'TOP' | 'AST';

export const SwarmOffice3D: React.FC<SwarmOffice3DProps> = ({
  latestRun,
  fileHeatmap,
  sandboxesCount,
  selectedLane,
  onSelectLane,
  onSelectFile,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);

  const [webglFallback, setWebglFallback] = useState(false);
  const [hoveredLabel, setHoveredLabel] = useState<string>(
    'SCOUT-01 Shared AST Nexus · Clica num quadrante ou torre AST para inspecionar'
  );
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('ISO');

  const topFiles = fileHeatmap.slice(0, 14);

  const applyCameraPreset = (preset: CameraPreset) => {
    setCameraPreset(preset);
    const cam = cameraRef.current;
    const ctrl = controlsRef.current;
    if (!cam || !ctrl) return;
    if (preset === 'ISO') {
      cam.position.set(14.5, 12.2, 15.5);
      ctrl.target.set(0, 0.8, -1.2);
    } else if (preset === 'TOP') {
      cam.position.set(0.01, 22.5, 0.01);
      ctrl.target.set(0, 0, -1.5);
    } else {
      cam.position.set(0, 6.8, 5.8);
      ctrl.target.set(0, 2.2, -8.2);
    }
    ctrl.update();
  };

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl = probeCanvas.getContext('webgl2') || probeCanvas.getContext('webgl');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFallback(true);
      return;
    }

    const width = container.clientWidth || 880;
    const height = container.clientHeight || 390;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const onContextLost = (ev: Event) => {
      ev.preventDefault();
      setWebglFallback(true);
    };
    renderer.domElement.addEventListener('webglcontextlost', onContextLost);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07090e);
    scene.fog = new THREE.FogExp2(0x07090e, 0.021);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 140);
    camera.position.set(14.5, 12.2, 15.5);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.06;
    controls.maxPolarAngle = Math.PI / 2.12;
    controls.minDistance = 7;
    controls.maxDistance = 34;
    controls.target.set(0, 0.8, -1.2);
    controls.update();
    controlsRef.current = controls;

    const disposables: { dispose: () => void }[] = [envTarget];
    const track = <T extends { dispose: () => void }>(item: T): T => {
      disposables.push(item);
      return item;
    };

    // Three-point architectural lighting + central cyan nexus glow
    const hemiLight = new THREE.HemisphereLight(0x94a3b8, 0x05070c, 0.72);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xf1f5f9, 2.0);
    keyLight.position.set(11, 18, 10);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 48;
    const d = 15;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const nexusPointLight = new THREE.PointLight(0x06b6d4, 15, 22, 1.6);
    nexusPointLight.position.set(0, 3.2, 0);
    scene.add(nexusPointLight);

    const terraceLight = new THREE.PointLight(0xf59e0b, 9, 20, 1.5);
    terraceLight.position.set(0, 4.5, -8.2);
    scene.add(terraceLight);

    // Obsidian architectural baseplate + tactical grid
    const floorGeo = track(new THREE.BoxGeometry(24, 0.35, 22));
    const floorMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x0b1018,
        roughness: 0.55,
        metalness: 0.45,
      })
    );
    const floorMesh = new THREE.Mesh(floorGeo, floorMat);
    floorMesh.position.set(0, -0.18, -1);
    floorMesh.receiveShadow = true;
    scene.add(floorMesh);

    const grid = new THREE.GridHelper(24, 24, 0x1e293b, 0x111827);
    grid.position.set(0, 0.01, -1);
    scene.add(grid);

    // Central SCOUT-01 Shared AST Core
    const scoutBaseGeo = track(new THREE.CylinderGeometry(1.55, 1.85, 0.32, 32));
    const scoutBaseMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x151c26,
        roughness: 0.32,
        metalness: 0.78,
        emissive: 0x06b6d4,
        emissiveIntensity: 0.16,
      })
    );
    const scoutBase = new THREE.Mesh(scoutBaseGeo, scoutBaseMat);
    scoutBase.position.set(0, 0.16, 0);
    scoutBase.castShadow = true;
    scoutBase.receiveShadow = true;
    scoutBase.userData = {
      kind: 'scout',
      label: 'SCOUT-01 Shared AST Core · 1 leitura alimenta 48 workers (-97% leituras redundantes)',
    };
    scene.add(scoutBase);

    const scoutCoreGeo = track(new THREE.OctahedronGeometry(0.88, 1));
    const scoutCoreMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x06b6d4,
        roughness: 0.18,
        metalness: 0.85,
        emissive: 0x06b6d4,
        emissiveIntensity: 0.55,
      })
    );
    const scoutCore = new THREE.Mesh(scoutCoreGeo, scoutCoreMat);
    scoutCore.position.set(0, 1.9, 0);
    scoutCore.castShadow = true;
    scoutCore.userData = scoutBase.userData;
    scene.add(scoutCore);

    const scoutRingGeo = track(new THREE.TorusGeometry(1.45, 0.04, 12, 48));
    const scoutRingMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x06b6d4,
        emissiveIntensity: 0.6,
        roughness: 0.25,
        metalness: 0.8,
      })
    );
    const scoutRing = new THREE.Mesh(scoutRingGeo, scoutRingMat);
    scoutRing.position.set(0, 1.9, 0);
    scoutRing.rotation.x = Math.PI / 2.6;
    scene.add(scoutRing);

    const pickables: THREE.Object3D[] = [scoutBase, scoutCore];
    const photonPackets: {
      mesh: THREE.Mesh;
      curve: THREE.QuadraticBezierCurve3;
      speed: number;
      offset: number;
    }[] = [];
    const agentSatellites: {
      pivot: THREE.Group;
      speed: number;
    }[] = [];

    // 4 Asymmetric Swarm Lane Pods + Pheromone Arcs + Orbiting Specialist Beacons
    const podGeo = track(new THREE.BoxGeometry(3.4, 0.42, 3.0));
    const beaconGeo = track(new THREE.CylinderGeometry(0.32, 0.44, 1.35, 20));
    const satGeo = track(new THREE.SphereGeometry(0.14, 14, 14));
    const photonGeo = track(new THREE.SphereGeometry(0.1, 12, 12));

    LANE_CONFIG.forEach((cfg, idx) => {
      const laneTasks = latestRun?.tasks.filter((t) => t.lane === cfg.lane) || [];
      const verifiedCount = laneTasks.filter((t) =>
        Boolean(t.verify1?.passed && t.verify2?.passed)
      ).length;
      const isSelected = selectedLane === cfg.lane;

      const podMat = track(
        new THREE.MeshStandardMaterial({
          color: isSelected ? 0x1e293b : 0x121923,
          roughness: 0.35,
          metalness: 0.68,
          emissive: cfg.hex,
          emissiveIntensity: isSelected ? 0.35 : 0.12,
        })
      );
      const pod = new THREE.Mesh(podGeo, podMat);
      pod.position.set(cfg.pos[0], 0.21, cfg.pos[1]);
      pod.castShadow = true;
      pod.receiveShadow = true;
      pod.userData = {
        kind: 'lane',
        lane: cfg.lane,
        label: `${cfg.label} (${cfg.specialist}) · ${verifiedCount}/${laneTasks.length || 12} tarefas verificadas`,
      };
      scene.add(pod);
      pickables.push(pod);

      const beaconMat = track(
        new THREE.MeshStandardMaterial({
          color: cfg.hex,
          roughness: 0.22,
          metalness: 0.78,
          emissive: cfg.hex,
          emissiveIntensity: isSelected ? 0.68 : 0.38,
        })
      );
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(cfg.pos[0], 1.08, cfg.pos[1]);
      beacon.castShadow = true;
      beacon.userData = pod.userData;
      scene.add(beacon);
      pickables.push(beacon);

      // Orbiting subagent workers
      const pivot = new THREE.Group();
      pivot.position.set(cfg.pos[0], 1.18, cfg.pos[1]);
      const workerNodes = Math.min(6, Math.max(3, Math.ceil((laneTasks.length || 12) / 3)));
      const satMat = track(
        new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
          emissive: cfg.hex,
          emissiveIntensity: 0.85,
          roughness: 0.2,
        })
      );
      for (let w = 0; w < workerNodes; w++) {
        const angle = (w / workerNodes) * Math.PI * 2;
        const sat = new THREE.Mesh(satGeo, satMat);
        sat.position.set(Math.cos(angle) * 1.15, (w % 2) * 0.24, Math.sin(angle) * 1.15);
        pivot.add(sat);
      }
      scene.add(pivot);
      agentSatellites.push({ pivot, speed: 0.65 + idx * 0.14 });

      // Ruflo Pheromone Bezier Arc from SCOUT-01 Nexus to Lane Pod
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 1.9, 0),
        new THREE.Vector3(cfg.pos[0] * 0.5, 3.6 + (idx % 2) * 0.5, cfg.pos[1] * 0.5),
        new THREE.Vector3(cfg.pos[0], 1.5, cfg.pos[1])
      );
      const arcPoints = curve.getPoints(32);
      const arcGeo = track(new THREE.BufferGeometry().setFromPoints(arcPoints));
      const arcMat = track(
        new THREE.LineBasicMaterial({
          color: cfg.hex,
          transparent: true,
          opacity: isSelected ? 0.9 : 0.45,
        })
      );
      const arcLine = new THREE.Line(arcGeo, arcMat);
      scene.add(arcLine);

      const photonMat = track(
        new THREE.MeshBasicMaterial({
          color: cfg.hex,
        })
      );
      const photon = new THREE.Mesh(photonGeo, photonMat);
      scene.add(photon);
      photonPackets.push({
        mesh: photon,
        curve,
        speed: 0.36 + idx * 0.06,
        offset: idx * 0.25,
      });
    });

    // InstancedMesh 3D AST File Heatmap Terrace along rear wall (z = -8.4)
    let instancedHeatmap: THREE.InstancedMesh | null = null;
    if (topFiles.length > 0) {
      const towerGeo = track(new THREE.BoxGeometry(0.95, 1, 0.95));
      const towerMat = track(
        new THREE.MeshStandardMaterial({
          roughness: 0.26,
          metalness: 0.76,
        })
      );
      instancedHeatmap = new THREE.InstancedMesh(towerGeo, towerMat, topFiles.length);
      instancedHeatmap.castShadow = true;
      instancedHeatmap.receiveShadow = true;

      const maxSymbols = Math.max(1, ...topFiles.map((f) => f.symbolCount));
      const dummy = new THREE.Object3D();
      const color = new THREE.Color();
      const totalSpan = (topFiles.length - 1) * 1.45;

      topFiles.forEach((entry, i) => {
        const ratio = entry.symbolCount / maxSymbols;
        const barH = 0.65 + ratio * 3.8;
        const x = -totalSpan / 2 + i * 1.45;
        dummy.position.set(x, barH / 2, -8.4);
        dummy.scale.set(1, barH, 1);
        dummy.updateMatrix();
        instancedHeatmap!.setMatrixAt(i, dummy.matrix);

        // Interpolate Stark Cyan -> Mark-VII Gold based on AST symbol density
        color.setHex(ratio > 0.68 ? 0xf59e0b : ratio > 0.38 ? 0x06b6d4 : 0x38bdf8);
        instancedHeatmap!.setColorAt(i, color);
      });

      instancedHeatmap.instanceMatrix.needsUpdate = true;
      if (instancedHeatmap.instanceColor) instancedHeatmap.instanceColor.needsUpdate = true;
      instancedHeatmap.computeBoundingSphere();
      instancedHeatmap.userData = { kind: 'heatmap' };
      scene.add(instancedHeatmap);
      pickables.push(instancedHeatmap);
    }

    // CoW Sandbox Containment Cubes on right flank (x = 9.4)
    const sbCount = Math.min(5, Math.max(1, sandboxesCount));
    const sbGeo = track(new THREE.BoxGeometry(0.85, 0.85, 0.85));
    const sbMat = track(
      new THREE.MeshStandardMaterial({
        color: 0x10b981,
        emissive: 0x10b981,
        emissiveIntensity: 0.25,
        roughness: 0.24,
        metalness: 0.72,
        wireframe: false,
      })
    );
    for (let s = 0; s < sbCount; s++) {
      const cube = new THREE.Mesh(sbGeo, sbMat);
      cube.position.set(9.4, 0.55, -4 + s * 1.6);
      cube.castShadow = true;
      cube.userData = {
        kind: 'sandbox',
        label: `CoW Sandbox #${s + 1} · Snapshot zlib + SHA-256 ativo`,
      };
      scene.add(cube);
      pickables.push(cube);
    }

    // Raycasting for Click & Hover inspection
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();

    const getHit = (ev: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObjects(pickables, false);
      return hits[0] || null;
    };

    const onPointerMove = (ev: PointerEvent) => {
      const hit = getHit(ev);
      if (!hit) {
        renderer.domElement.style.cursor = 'grab';
        return;
      }
      renderer.domElement.style.cursor = 'pointer';
      if (hit.object === instancedHeatmap && typeof hit.instanceId === 'number') {
        const f = topFiles[hit.instanceId];
        if (f) {
          setHoveredLabel(
            `Torre AST: ${f.filePath} · ${f.symbolCount} símbolos indexados (:Lstart-end)`
          );
        }
      } else if (hit.object.userData?.label) {
        setHoveredLabel(String(hit.object.userData.label));
      }
    };

    let downPos = { x: 0, y: 0 };
    const onPointerDown = (ev: PointerEvent) => {
      downPos = { x: ev.clientX, y: ev.clientY };
    };

    const onPointerUp = (ev: PointerEvent) => {
      const moved = Math.hypot(ev.clientX - downPos.x, ev.clientY - downPos.y);
      if (moved > 6) return;
      const hit = getHit(ev);
      if (!hit) return;

      if (hit.object === instancedHeatmap && typeof hit.instanceId === 'number') {
        const f = topFiles[hit.instanceId];
        if (f) {
          setHoveredLabel(`Selecionado AST: ${f.filePath} (${f.symbolCount} símbolos)`);
          onSelectFile?.(f.filePath);
        }
        return;
      }

      if (hit.object.userData?.kind === 'lane') {
        const clickedLane = hit.object.userData.lane as SwarmLane;
        onSelectLane(selectedLane === clickedLane ? null : clickedLane);
      } else if (hit.object.userData?.kind === 'scout') {
        onSelectLane(null);
      }
    };

    renderer.domElement.addEventListener('pointermove', onPointerMove);
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        if (!container) return;
        const w = container.clientWidth || 880;
        const h = container.clientHeight || 390;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
      });
      resizeObserver.observe(container);
    }

    const timer = new THREE.Timer();
    let frameId = 0;
    let disposed = false;

    const afterDraw = (cb: () => void) => {
      const gl = renderer.getContext() as WebGL2RenderingContext | null;
      if (!gl || typeof gl.fenceSync !== 'function') {
        frameId = window.setTimeout(cb, 80);
        return;
      }
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    };

    const animate = () => {
      if (disposed) return;
      timer.update();
      const elapsed = timer.getElapsed();

      scoutCore.rotation.y = elapsed * 0.7;
      scoutCore.position.y = 1.9 + Math.sin(elapsed * 2.1) * 0.12;
      scoutRing.rotation.z = elapsed * 0.5;

      agentSatellites.forEach((sat) => {
        sat.pivot.rotation.y = elapsed * sat.speed;
      });

      photonPackets.forEach((pkt) => {
        const tNorm = (elapsed * pkt.speed + pkt.offset) % 1;
        const pt = pkt.curve.getPointAt(tNorm);
        pkt.mesh.position.copy(pt);
      });

      controls.update();
      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(animate);
      } else {
        frameId = requestAnimationFrame(animate);
      }
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      timer.dispose();
      resizeObserver?.disconnect();
      renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
      disposables.forEach((d) => d.dispose());
      renderer.dispose();
    };
  }, [latestRun, fileHeatmap, sandboxesCount, selectedLane]);

  return (
    <div className="bg-[#0d1117] border border-slate-800/80 rounded-xl overflow-hidden">
      {/* Top 3D Viewport Control Bar */}
      <div className="px-5 py-3 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <Box className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-100 truncate">
              Escritório Espacial 3D de Agentes & Mapa de Calor AST (InstancedMesh)
            </h2>
            <p className="text-xs text-slate-400 truncate">
              4 quadrantes assimétricos + núcleo <code className="text-cyan-300">SCOUT-01</code> +
              arcos de feromonas Ruflo em tempo real.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {(
            [
              ['ISO', 'Isométrica', Compass],
              ['TOP', 'Radar Topo', Layers],
              ['AST', 'Terraço AST', Eye],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => applyCameraPreset(id)}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap ${
                cameraPreset === id
                  ? 'bg-[#151c26] border-cyan-500/60 text-cyan-300'
                  : 'bg-[#07090e] border-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
          {selectedLane && (
            <button
              type="button"
              onClick={() => onSelectLane(null)}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-amber-500/15 border border-amber-500/50 text-amber-300 whitespace-nowrap"
            >
              <RotateCcw className="w-3 h-3" />
              Todas ({selectedLane})
            </button>
          )}
        </div>
      </div>

      {/* 3D Canvas or Interactive 2D Isometric SVG Fallback */}
      {webglFallback ? (
        <div className="p-6 bg-[#07090e] space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {LANE_CONFIG.map((cfg) => {
              const count = latestRun?.tasks.filter((t) => t.lane === cfg.lane).length || 12;
              const active = selectedLane === cfg.lane;
              return (
                <button
                  key={cfg.lane}
                  type="button"
                  onClick={() => onSelectLane(active ? null : cfg.lane)}
                  className={`p-4 rounded-lg border text-left transition-colors ${
                    active
                      ? 'bg-[#151c26] border-cyan-500/60'
                      : 'bg-[#0d1117] border-slate-800 hover:border-slate-700'
                  }`}
                >
                  <p className={`text-xs font-semibold ${cfg.cssText}`}>{cfg.label}</p>
                  <p className="text-xs text-slate-400 font-mono mt-1">{cfg.specialist}</p>
                  <p className="text-xs text-slate-500 font-mono mt-1">{count} workers</p>
                </button>
              );
            })}
          </div>
          <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800/80">
            {topFiles.map((f) => (
              <button
                key={f.filePath}
                type="button"
                onClick={() => onSelectFile?.(f.filePath)}
                className="px-2.5 py-1 text-xs font-mono bg-[#0d1117] border border-slate-800 rounded-md text-slate-300 hover:border-cyan-500/50"
              >
                {f.filePath} ({f.symbolCount})
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div
          ref={containerRef}
          data-testid="swarm-office-3d-canvas"
          className="w-full h-[380px] bg-[#07090e] select-none"
        />
      )}

      {/* Bottom Tactical Inspection Readout */}
      <div className="px-5 py-2.5 bg-[#07090e] border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-mono text-cyan-300 truncate">{hoveredLabel}</span>
        <div className="flex items-center gap-4 font-mono tabular-nums text-slate-400 shrink-0">
          <span>Arrastar: Orbitar · Scroll: Zoom · Clique: Filtrar Lane/AST</span>
          <span className="text-emerald-400">{sandboxesCount} Sandboxes CoW</span>
        </div>
      </div>
    </div>
  );
};
