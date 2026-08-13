import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AtlasDataNode, AtlasDataPack, AtlasSpriteKind } from "../lib/game-data";
import { bridge } from "../lib/bridge";
import {
  ATLAS_WORKSPACE_KEY,
  allocateAtlasPath,
  atlasAllocationAnalysis,
  compareAtlasLoadouts,
  createAtlasPresetBundle,
  decodeAtlasUrl,
  encodeAtlasUrl,
  parseAtlasWorkspace,
  parseAtlasPresetBundle,
  refundAtlasNode,
  validateAtlasAllocation,
  type AtlasLoadout,
  type AtlasWorkspace,
} from "../lib/atlas";
import "./AtlasCommandCenter.css";

interface Viewport {
  centerX: number;
  centerY: number;
  zoom: number;
  fitZoom: number;
}

interface AtlasCanvasProps {
  atlas: AtlasDataPack;
  allocated: ReadonlySet<number>;
  selectedId: number | null;
  searchMatches: ReadonlySet<number>;
  focusNodeId: number | null;
  onNode: (id: number) => void;
  onHover: (id: number | null) => void;
}

function spriteKind(node: AtlasDataNode, active: boolean): AtlasSpriteKind {
  if (node.mastery) return "mastery";
  if (node.gateway) return active ? "wormholeActive" : "wormholeInactive";
  if (node.keystone) return active ? "keystoneActive" : "keystoneInactive";
  if (node.notable) return active ? "notableActive" : "notableInactive";
  return active ? "normalActive" : "normalInactive";
}

function spriteKey(node: AtlasDataNode) {
  return node.gateway ? "Wormhole" : node.icon;
}

function frameKey(node: AtlasDataNode, active: boolean, highlighted = false, canAllocate = false) {
  if (node.gateway) {
    if (active) return "WormholeFrameAllocated";
    if (highlighted) return "WormholeFrameHighlight";
    return canAllocate ? "WormholeFrameCanAllocate" : "WormholeFrameUnallocated";
  }
  if (node.keystone) {
    if (active) return "KeystoneFrameAllocated";
    return highlighted || canAllocate ? "KeystoneFrameCanAllocate" : "KeystoneFrameUnallocated";
  }
  if (node.notable) {
    if (active) return "NotableFrameAllocated";
    return highlighted || canAllocate ? "NotableFrameCanAllocate" : "NotableFrameUnallocated";
  }
  return active ? "PSSkillFrameActive" : highlighted || canAllocate ? "PSSkillFrameHighlighted" : "PSSkillFrame";
}

function nodeScale(zoom: number) {
  return Math.min(1, Math.max(0.075, zoom / 0.45));
}

function AtlasNodeArt({ atlas, node, active }: { atlas: AtlasDataPack; node: AtlasDataNode; active: boolean }) {
  const sheet = atlas.sprites[spriteKind(node, active)];
  const coordinates = sheet.coords[spriteKey(node)];
  if (!coordinates) return <span className="atlas-node-art-fallback" />;
  if (node.mastery) {
    return (
      <span
        className="atlas-node-art atlas-node-art--mastery"
        style={{
          width: coordinates.w,
          height: coordinates.h,
          backgroundImage: `url("${sheet.filename}")`,
          backgroundPosition: `-${coordinates.x}px -${coordinates.y}px`,
          backgroundSize: `${sheet.width}px ${sheet.height}px`,
        }}
      />
    );
  }
  const frameSheet = atlas.sprites.frame;
  const frame = frameSheet.coords[frameKey(node, active)];
  if (!frame) return <span className="atlas-node-art-fallback" />;
  const displayScale = node.keystone || node.gateway ? 0.43 : node.notable ? 0.58 : 0.78;
  return (
    <span
      className="atlas-node-art"
      style={{
        width: frame.w * displayScale,
        height: frame.h * displayScale,
      }}
    >
      <span className="atlas-node-art-layers" style={{ width: frame.w, height: frame.h, transform: `translate(-50%, -50%) scale(${displayScale})` }}>
        <span
          className="atlas-node-art-icon"
          style={{
            width: coordinates.w,
            height: coordinates.h,
            marginLeft: -coordinates.w / 2,
            marginTop: -coordinates.h / 2,
            backgroundImage: `url("${sheet.filename}")`,
            backgroundPosition: `-${coordinates.x}px -${coordinates.y}px`,
            backgroundSize: `${sheet.width}px ${sheet.height}px`,
          }}
        />
        <span
          className="atlas-node-art-frame"
          style={{
            width: frame.w,
            height: frame.h,
            backgroundImage: `url("${frameSheet.filename}")`,
            backgroundPosition: `-${frame.x}px -${frame.y}px`,
            backgroundSize: `${frameSheet.width}px ${frameSheet.height}px`,
          }}
        />
      </span>
    </span>
  );
}

function drawConnector(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  coordinate: { x: number; y: number; w: number; h: number } | undefined,
  from: { x: number; y: number },
  to: { x: number; y: number },
  thickness: number,
) {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  if (!coordinate || !image?.complete || length < 1) return false;
  context.save();
  context.translate(from.x, from.y);
  context.rotate(Math.atan2(to.y - from.y, to.x - from.x));
  context.drawImage(
    image,
    coordinate.x,
    coordinate.y,
    coordinate.w,
    coordinate.h,
    0,
    -thickness / 2,
    length,
    thickness,
  );
  context.restore();
  return true;
}

function drawOrbit(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement | undefined,
  coordinate: { x: number; y: number; w: number; h: number } | undefined,
  center: { x: number; y: number },
  width: number,
  height: number,
) {
  if (!coordinate || !image?.complete) return;
  for (let quarter = 0; quarter < 4; quarter += 1) {
    context.save();
    context.translate(center.x, center.y);
    context.rotate(quarter * Math.PI / 2);
    context.drawImage(
      image,
      coordinate.x,
      coordinate.y,
      coordinate.w,
      coordinate.h,
      -width,
      -height,
      width,
      height,
    );
    context.restore();
  }
}

function atlasCenter(atlas: AtlasDataPack) {
  return {
    x: (atlas.bounds.minX + atlas.bounds.maxX) / 2,
    y: (atlas.bounds.minY + atlas.bounds.maxY) / 2,
  };
}

function AtlasCanvas({ atlas, allocated, selectedId, searchMatches, focusNodeId, onNode, onHover }: AtlasCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const dragRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);
  const [size, setSize] = useState({ width: 900, height: 650 });
  const [imageRevision, setImageRevision] = useState(0);
  const [viewport, setViewport] = useState<Viewport>(() => {
    const center = atlasCenter(atlas);
    return { centerX: center.x, centerY: center.y, zoom: 0.08, fitZoom: 0.08 };
  });

  const nodes = useMemo(() => new Map(atlas.nodes.map((node) => [node.id, node])), [atlas]);

  const fit = useCallback((width = size.width, height = size.height) => {
    const center = atlasCenter(atlas);
    const fitZoom = Math.max(0.02, Math.min(
      width / ((atlas.bounds.maxX - atlas.bounds.minX) * 1.08),
      height / ((atlas.bounds.maxY - atlas.bounds.minY) * 1.08),
    ));
    setViewport({ centerX: center.x, centerY: center.y, zoom: fitZoom, fitZoom });
  }, [atlas, size.height, size.width]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const width = Math.max(280, Math.floor(entry.contentRect.width));
      const height = Math.max(420, Math.floor(entry.contentRect.height));
      setSize({ width, height });
      const center = atlasCenter(atlas);
      const fitZoom = Math.max(0.02, Math.min(
        width / ((atlas.bounds.maxX - atlas.bounds.minX) * 1.08),
        height / ((atlas.bounds.maxY - atlas.bounds.minY) * 1.08),
      ));
      setViewport((current) => current.fitZoom === current.zoom
        ? { centerX: center.x, centerY: center.y, zoom: fitZoom, fitZoom }
        : { ...current, fitZoom });
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, [atlas]);

  useEffect(() => {
    const sources = new Set(Object.values(atlas.sprites).map((sprite) => sprite.filename));
    for (const source of sources) {
      if (imagesRef.current.has(source)) continue;
      const image = new Image();
      image.decoding = "async";
      image.addEventListener("load", () => setImageRevision((value) => value + 1), { once: true });
      image.src = source;
      imagesRef.current.set(source, image);
    }
  }, [atlas]);

  useEffect(() => {
    if (focusNodeId == null) return;
    const node = nodes.get(focusNodeId);
    if (!node) return;
    setViewport((current) => ({
      ...current,
      centerX: node.x,
      centerY: node.y,
      zoom: Math.max(current.zoom, current.fitZoom * 4),
    }));
  }, [focusNodeId, nodes]);

  const worldToScreen = useCallback((x: number, y: number, view = viewport) => ({
    x: size.width / 2 + (x - view.centerX) * view.zoom,
    y: size.height / 2 + (y - view.centerY) * view.zoom,
  }), [size.height, size.width, viewport]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(size.width * ratio);
    canvas.height = Math.floor(size.height * ratio);
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, size.width, size.height);
    const canvasStyles = getComputedStyle(canvas);
    context.fillStyle = canvasStyles.getPropertyValue("--atlas-canvas-bg").trim() || "#06090a";
    context.fillRect(0, 0, size.width, size.height);

    const background = atlas.sprites.atlasBackground;
    const backgroundImage = imagesRef.current.get(background.filename);
    const backgroundCoordinates = background.coords.AtlasPassiveBackground;
    if (backgroundImage?.complete && backgroundCoordinates) {
      const center = worldToScreen(0, (atlas.bounds.minY + atlas.bounds.maxY) / 2);
      const width = (backgroundCoordinates.w / 0.5) * viewport.zoom;
      const height = (backgroundCoordinates.h / 0.5) * viewport.zoom;
      context.globalAlpha = 0.56;
      context.drawImage(
        backgroundImage,
        backgroundCoordinates.x,
        backgroundCoordinates.y,
        backgroundCoordinates.w,
        backgroundCoordinates.h,
        center.x - width / 2,
        center.y - height / 2,
        width,
        height,
      );
      context.globalAlpha = 1;
    }

    const accent = canvasStyles.getPropertyValue("--teal").trim() || "#2ee6b8";
    const lineSheet = atlas.sprites.line;
    const lineImage = imagesRef.current.get(lineSheet.filename);
    const groupSheet = atlas.sprites.groupBackground;
    const groupImage = imagesRef.current.get(groupSheet.filename);
    for (const group of atlas.groups) {
      const point = worldToScreen(group.x, group.y);
      if (group.background) {
        const coordinate = groupSheet.coords[group.background];
        if (coordinate && groupImage?.complete) {
          const width = (coordinate.w / 0.5) * viewport.zoom;
          const height = (coordinate.h / 0.5) * viewport.zoom;
          context.globalAlpha = 0.82;
          context.drawImage(
            groupImage,
            coordinate.x,
            coordinate.y,
            coordinate.w,
            coordinate.h,
            point.x - width / 2,
            point.y - height / 2,
            width,
            height,
          );
          context.globalAlpha = 1;
        }
      }
      const groupNodes = group.nodeIds.map((id) => nodes.get(id)).filter((node) => node != null);
      for (const orbit of group.orbits) {
        if (orbit === 0) continue;
        const orbitNodes = groupNodes.filter((node) => node.orbit === orbit);
        const active = orbitNodes.some((node) => allocated.has(node.id));
        const available = !active && orbitNodes.some((node) => node.neighbors.some((id) => id === atlas.rootId || allocated.has(id)));
        const key = `Orbit${orbit}${active ? "Active" : available ? "Intermediate" : "Normal"}`;
        const coordinate = lineSheet.coords[key];
        if (!coordinate || !lineImage?.complete) continue;
        const width = (coordinate.w / 0.5) * viewport.zoom;
        const height = (coordinate.h / 0.5) * viewport.zoom;
        drawOrbit(context, lineImage, coordinate, point, width, height);
      }
    }
    context.lineCap = "round";
    for (const node of atlas.nodes) {
      const from = worldToScreen(node.x, node.y);
      for (const neighborId of node.neighbors) {
        if (neighborId <= node.id) continue;
        const neighbor = nodes.get(neighborId);
        if (!neighbor || (node.gateway && neighbor.gateway)) continue;
        const to = worldToScreen(neighbor.x, neighbor.y);
        const active = (node.id === atlas.rootId || allocated.has(node.id))
          && (neighbor.id === atlas.rootId || allocated.has(neighbor.id));
        const available = !active && (
          node.id === atlas.rootId || neighbor.id === atlas.rootId || allocated.has(node.id) || allocated.has(neighbor.id)
        );
        const lineKey = active ? "LineConnectorActive" : available ? "LineConnectorIntermediate" : "LineConnectorNormal";
        const scale = nodeScale(viewport.zoom);
        const textured = drawConnector(context, lineImage, lineSheet.coords[lineKey], from, to, Math.max(1.2, 17 * scale));
        if (!textured) {
          context.strokeStyle = active ? accent : available ? "rgba(176, 142, 83, 0.5)" : "rgba(88, 102, 104, 0.34)";
          context.lineWidth = active ? 2 : 1;
          context.beginPath();
          context.moveTo(from.x, from.y);
          context.lineTo(to.x, to.y);
          context.stroke();
        }
      }
    }

    const orderedNodes = [...atlas.nodes].sort((left, right) => Number(left.id === selectedId) - Number(right.id === selectedId));
    for (const node of orderedNodes) {
      const point = worldToScreen(node.x, node.y);
      if (point.x < -80 || point.y < -80 || point.x > size.width + 80 || point.y > size.height + 80) continue;
      const active = allocated.has(node.id) || node.id === atlas.rootId;
      const kind = node.id === atlas.rootId ? "startNode" : spriteKind(node, active);
      const sheet = atlas.sprites[kind];
      const key = node.id === atlas.rootId ? "AtlasPassiveSkillScreenStart" : spriteKey(node);
      const coordinate = sheet.coords[key];
      const image = imagesRef.current.get(sheet.filename);
      const matched = searchMatches.has(node.id);
      const selected = selectedId === node.id;
      const scale = nodeScale(viewport.zoom);
      const canAllocate = !active && node.neighbors.some((id) => id === atlas.rootId || allocated.has(id));
      if (coordinate && image?.complete) {
        const drawWidth = coordinate.w * scale;
        const drawHeight = coordinate.h * scale;
        context.globalAlpha = node.mastery ? 0.32 : active ? 1 : 0.78;
        context.drawImage(
          image,
          coordinate.x,
          coordinate.y,
          coordinate.w,
          coordinate.h,
          point.x - drawWidth / 2,
          point.y - drawHeight / 2,
          drawWidth,
          drawHeight,
        );
        context.globalAlpha = 1;
      }
      if (!node.mastery && node.id !== atlas.rootId) {
        const frameSheet = atlas.sprites.frame;
        const frame = frameSheet.coords[frameKey(node, active, matched || selected, canAllocate)];
        const frameImage = imagesRef.current.get(frameSheet.filename);
        if (frame && frameImage?.complete) {
          const drawWidth = frame.w * scale;
          const drawHeight = frame.h * scale;
          if (matched || selected) {
            context.save();
            context.shadowColor = selected ? accent : "#68a9ff";
            context.shadowBlur = selected ? 16 : 10;
            context.globalAlpha = 0.95;
            context.drawImage(frameImage, frame.x, frame.y, frame.w, frame.h, point.x - drawWidth / 2, point.y - drawHeight / 2, drawWidth, drawHeight);
            context.restore();
          } else {
            context.drawImage(frameImage, frame.x, frame.y, frame.w, frame.h, point.x - drawWidth / 2, point.y - drawHeight / 2, drawWidth, drawHeight);
          }
        }
      }
    }
  }, [allocated, atlas, imageRevision, nodes, searchMatches, selectedId, size.height, size.width, viewport, worldToScreen]);

  const nodeAt = (clientX: number, clientY: number) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    let best: { id: number; distance: number } | null = null;
    for (const node of atlas.nodes) {
      if (node.mastery || node.id === atlas.rootId) continue;
      const point = worldToScreen(node.x, node.y);
      const kind = spriteKind(node, allocated.has(node.id));
      const coordinate = atlas.sprites[kind].coords[spriteKey(node)];
      const frame = atlas.sprites.frame.coords[frameKey(node, allocated.has(node.id))];
      const scale = nodeScale(viewport.zoom);
      const hitRadius = frame || coordinate
        ? Math.max(6, Math.min(40, Math.max(frame?.w || coordinate?.w || 0, frame?.h || coordinate?.h || 0) * scale * 0.48))
        : 8;
      const distance = Math.hypot(point.x - x, point.y - y);
      if (distance <= hitRadius && (!best || distance < best.distance)) best = { id: node.id, distance };
    }
    return best?.id ?? null;
  };

  const zoomBy = (factor: number, clientX?: number, clientY?: number) => setViewport((current) => {
    const zoom = Math.max(current.fitZoom * 0.75, Math.min(current.fitZoom * 14, current.zoom * factor));
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect || clientX == null || clientY == null) return { ...current, zoom };
    const x = clientX - rect.left - size.width / 2;
    const y = clientY - rect.top - size.height / 2;
    const worldX = current.centerX + x / current.zoom;
    const worldY = current.centerY + y / current.zoom;
    return {
      ...current,
      centerX: worldX - x / zoom,
      centerY: worldY - y / zoom,
      zoom,
    };
  });

  return (
    <div className="atlas-canvas-host" ref={hostRef}>
      <canvas
        ref={canvasRef}
        aria-label="Interactive official Path of Exile Atlas passive tree"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const drag = dragRef.current;
          if (!drag || drag.pointerId !== event.pointerId) {
            onHover(nodeAt(event.clientX, event.clientY));
            return;
          }
          const dx = event.clientX - drag.x;
          const dy = event.clientY - drag.y;
          if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
          drag.x = event.clientX;
          drag.y = event.clientY;
          setViewport((current) => ({ ...current, centerX: current.centerX - dx / current.zoom, centerY: current.centerY - dy / current.zoom }));
        }}
        onPointerUp={(event) => {
          const drag = dragRef.current;
          dragRef.current = null;
          if (drag && !drag.moved) {
            const id = nodeAt(event.clientX, event.clientY);
            if (id != null) onNode(id);
          }
        }}
        onPointerLeave={() => onHover(null)}
        onWheel={(event) => {
          event.preventDefault();
          zoomBy(event.deltaY < 0 ? 1.16 : 1 / 1.16, event.clientX, event.clientY);
        }}
      />
      <div className="atlas-zoom-controls" aria-label="Atlas view controls">
        <button type="button" onClick={() => zoomBy(1.25)}>+</button>
        <button type="button" onClick={() => zoomBy(0.8)}>−</button>
        <button type="button" onClick={() => fit()}>Fit</button>
      </div>
      <span className="atlas-canvas-hint">Drag to pan · wheel or controls to zoom · click a node for its shortest connected path</span>
    </div>
  );
}

function nodeSummary(atlas: AtlasDataPack, ids: readonly number[]) {
  const nodes = new Map(atlas.nodes.map((node) => [node.id, node]));
  return ids.slice(0, 10).map((id) => nodes.get(id)?.name || `Node ${id}`);
}

export function AtlasCommandCenter({ atlas, initialQuery = "", initialPresetId, navigationNonce = 0 }: {
  atlas: AtlasDataPack;
  initialQuery?: string;
  initialPresetId?: string;
  navigationNonce?: number;
}) {
  const migration = useMemo(() => parseAtlasWorkspace(atlas, localStorage.getItem(ATLAS_WORKSPACE_KEY)), [atlas]);
  const [workspace, setWorkspace] = useState<AtlasWorkspace>(migration.workspace);
  const [message, setMessage] = useState(() => migration.changedVersion
    ? `Migrated saved Atlas work to PoE ${atlas.gameVersion}; ${migration.droppedNodeIds.length} incompatible node${migration.droppedNodeIds.length === 1 ? " was" : "s were"} dropped.`
    : `Official PoE ${atlas.gameVersion} Atlas graph is ready.`);
  const [query, setQuery] = useState(initialQuery);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [focusNodeId, setFocusNodeId] = useState<number | null>(null);
  const [importValue, setImportValue] = useState("");
  const [loadoutName, setLoadoutName] = useState("");
  const [loadoutFolder, setLoadoutFolder] = useState("");
  const [loadoutTags, setLoadoutTags] = useState("");
  const [loadoutNotes, setLoadoutNotes] = useState("");
  const [presetQuery, setPresetQuery] = useState("");
  const [compareLeft, setCompareLeft] = useState("");
  const [compareRight, setCompareRight] = useState("");
  const nodes = useMemo(() => new Map(atlas.nodes.map((node) => [node.id, node])), [atlas]);
  const allocated = useMemo(() => new Set(workspace.nodeIds), [workspace.nodeIds]);
  const analysis = useMemo(
    () => atlasAllocationAnalysis(atlas, workspace.nodeIds, workspace.basePoints),
    [atlas, workspace.basePoints, workspace.nodeIds],
  );
  const searchResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return [];
    return atlas.nodes.filter((node) => !node.mastery && node.id !== atlas.rootId
      && `${node.name} ${node.stats.join(" ")} ${node.reminderText.join(" ")}`.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => Number(right.keystone) - Number(left.keystone)
        || Number(right.notable) - Number(left.notable) || left.name.localeCompare(right.name))
      .slice(0, 16);
  }, [atlas, query]);
  const searchMatches = useMemo(() => new Set(searchResults.map((node) => node.id)), [searchResults]);
  const selected = nodes.get(hoverId ?? selectedId ?? -1) || null;
  const leftLoadout = workspace.loadouts.find((entry) => entry.id === compareLeft);
  const rightLoadout = workspace.loadouts.find((entry) => entry.id === compareRight);
  const comparison = leftLoadout && rightLoadout ? compareAtlasLoadouts(leftLoadout, rightLoadout) : null;
  const visibleLoadouts = useMemo(() => {
    const normalized = presetQuery.trim().toLocaleLowerCase();
    return [...workspace.loadouts]
      .filter((entry) => !normalized || `${entry.name} ${entry.folder} ${entry.tags.join(" ")} ${entry.notes}`.toLocaleLowerCase().includes(normalized))
      .sort((left, right) => left.folder.localeCompare(right.folder) || right.updatedAt - left.updatedAt);
  }, [presetQuery, workspace.loadouts]);

  useEffect(() => {
    localStorage.setItem(ATLAS_WORKSPACE_KEY, JSON.stringify(workspace));
  }, [workspace]);

  useEffect(() => {
    window.dispatchEvent(new Event("gloamcore:commands-changed"));
  }, [workspace.loadouts]);

  useEffect(() => {
    if (initialQuery) setQuery(initialQuery);
  }, [initialQuery, navigationNonce]);

  useEffect(() => {
    if (!initialPresetId) return;
    const preset = workspace.loadouts.find((entry) => entry.id === initialPresetId);
    if (!preset) {
      setMessage("That saved Atlas preset is no longer available.");
      return;
    }
    setWorkspace((current) => ({ ...current, basePoints: preset.basePoints, nodeIds: preset.nodeIds }));
    setPresetQuery(preset.name);
    setMessage(`Loaded strategy â€œ${preset.name}â€.`);
  }, [initialPresetId, navigationNonce, workspace.loadouts]);

  const selectAndFocus = (id: number) => {
    setSelectedId(id);
    setQuery("");
    setFocusNodeId((current) => current === id ? null : id);
  };

  const changeNode = (id: number) => {
    setSelectedId(id);
    const result = allocated.has(id)
      ? refundAtlasNode(atlas, workspace.nodeIds, id, workspace.basePoints)
      : allocateAtlasPath(atlas, workspace.nodeIds, id, workspace.basePoints);
    setMessage(result.message);
    if (result.ok) setWorkspace((current) => ({ ...current, nodeIds: result.nodeIds }));
  };

  const saveLoadout = () => {
    const name = loadoutName.trim().slice(0, 80);
    if (!name) {
      setMessage("Enter a strategy name before saving.");
      return;
    }
    const existingId = workspace.loadouts.find((entry) => entry.name.toLocaleLowerCase() === name.toLocaleLowerCase())?.id;
    setWorkspace((current) => {
      const saved: AtlasLoadout = {
        id: existingId || crypto.randomUUID(),
        name,
        gameVersion: atlas.gameVersion,
        basePoints: current.basePoints,
        nodeIds: current.nodeIds,
        updatedAt: Date.now(),
        createdAt: current.loadouts.find((entry) => entry.id === existingId)?.createdAt || Date.now(),
        folder: loadoutFolder.trim().slice(0, 80),
        tags: [...new Map(loadoutTags.split(",").map((tag) => tag.trim().slice(0, 32)).filter(Boolean).map((tag) => [tag.toLocaleLowerCase(), tag])).values()].slice(0, 12),
        notes: loadoutNotes.trim().slice(0, 2_000),
      };
      return { ...current, loadouts: [...current.loadouts.filter((entry) => entry.id !== saved.id), saved].slice(-30) };
    });
    setLoadoutName("");
    setLoadoutFolder("");
    setLoadoutTags("");
    setLoadoutNotes("");
    setMessage(`${existingId ? "Updated" : "Saved"} strategy preset “${name}” for PoE ${atlas.gameVersion}.`);
  };

  const exportPresets = async () => {
    const bundle = createAtlasPresetBundle(atlas, workspace.loadouts);
    const saved = await bridge.saveToolkitText({
      text: JSON.stringify(bundle, null, 2),
      suggestedName: `GloamCore-Atlas-presets-${atlas.gameVersion}.json`,
      kind: "text",
    });
    setMessage(saved ? `Exported ${bundle.loadouts.length} Atlas preset${bundle.loadouts.length === 1 ? "" : "s"} to ${saved.name}.` : "Atlas preset export cancelled.");
  };

  const importPresets = async () => {
    try {
      const opened = await bridge.openToolkitText("text");
      if (!opened) {
        setMessage("Atlas preset import cancelled.");
        return;
      }
      const imported = parseAtlasPresetBundle(atlas, opened.text);
      setWorkspace((current) => {
        const byId = new Map(current.loadouts.map((entry) => [entry.id, entry]));
        for (const loadout of imported.loadouts) byId.set(loadout.id, loadout);
        return { ...current, loadouts: [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, 30) };
      });
      const dropped = imported.reports.reduce((total, report) => total + report.droppedNodeIds.length, 0);
      setMessage(`Imported ${imported.loadouts.length} validated Atlas preset${imported.loadouts.length === 1 ? "" : "s"}${dropped ? `; ${dropped} incompatible node ID${dropped === 1 ? " was" : "s were"} dropped` : ""}.`);
    } catch (error) {
      setMessage(`Preset import rejected. ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className="atlas-command-center">
      <div className="atlas-toolbar">
        <label className="atlas-search">
          <span>Find Atlas mechanics or stats</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Essence, map modifier effect, gateways…" />
          {searchResults.length > 0 && (
            <div className="atlas-search-results">
              {searchResults.map((node) => (
                <button type="button" key={node.id} onClick={() => selectAndFocus(node.id)}>
                  <AtlasNodeArt atlas={atlas} node={node} active={allocated.has(node.id)} />
                  <span><strong>{node.name}</strong><small>{node.keystone ? "Keystone" : node.notable ? "Notable" : node.gateway ? "Gateway" : node.stats[0] || "Atlas passive"}</small></span>
                </button>
              ))}
            </div>
          )}
        </label>
        <label>
          <span>Atlas points earned</span>
          <input
            type="number"
            min={0}
            max={atlas.totalPoints}
            value={workspace.basePoints}
            onChange={(event) => {
              const points = Math.max(0, Math.min(atlas.totalPoints, Number(event.target.value) || 0));
              const validation = validateAtlasAllocation(atlas, workspace.nodeIds, points);
              if (!validation.ok) {
                setMessage("That point budget is below what the current connected tree requires.");
                return;
              }
              setWorkspace((current) => ({ ...current, basePoints: points }));
            }}
          />
        </label>
        <div className="atlas-point-meter">
          <span><strong>{analysis.remaining}</strong> remaining</span>
          <small>{analysis.spent} spent · {workspace.basePoints} earned{analysis.granted ? ` + ${analysis.granted} granted` : ""}</small>
        </div>
        <button type="button" className="atlas-reset" onClick={() => {
          setWorkspace((current) => ({ ...current, nodeIds: [] }));
          setMessage("Cleared the current Atlas allocation.");
        }}>Reset tree</button>
      </div>

      <div className="atlas-main">
        <AtlasCanvas
          atlas={atlas}
          allocated={allocated}
          selectedId={selectedId}
          searchMatches={searchMatches}
          focusNodeId={focusNodeId}
          onNode={changeNode}
          onHover={setHoverId}
        />
        <aside className="atlas-inspector">
          <header>
            {selected ? <AtlasNodeArt atlas={atlas} node={selected} active={allocated.has(selected.id)} /> : <span className="atlas-node-art-fallback" />}
            <div>
              <small>{selected ? selected.gateway ? "GATEWAY" : selected.keystone ? "KEYSTONE" : selected.notable ? "NOTABLE" : "ATLAS PASSIVE" : "SELECTION"}</small>
              <h2>{selected?.name || "Choose a node"}</h2>
            </div>
          </header>
          {selected ? (
            <>
              <ul>{selected.stats.map((stat) => <li key={stat}>{stat}</li>)}</ul>
              {selected.reminderText.map((text) => <p key={text} className="atlas-reminder">{text}</p>)}
              {selected.flavourText.length > 0 && <blockquote>{selected.flavourText.join(" ")}</blockquote>}
              <button type="button" className={allocated.has(selected.id) ? "is-refund" : "is-allocate"} onClick={() => changeNode(selected.id)}>
                {allocated.has(selected.id) ? "Refund node and disconnected dependants" : "Allocate shortest connected path"}
              </button>
            </>
          ) : <p>Search or click the official Atlas tree to inspect exact stats and allocate the shortest connected route.</p>}
          <div className="atlas-status" role="status">{message}</div>
          {migration.loadoutReports.length > 0 && (
            <details className="atlas-migration-report">
              <summary>League migration report · {migration.loadoutReports.length} preset{migration.loadoutReports.length === 1 ? "" : "s"}</summary>
              {migration.loadoutReports.map((report) => (
                <p key={report.id}><strong>{report.name}</strong><span>{report.sourceGameVersion || "unknown source"} → {atlas.gameVersion} · {report.droppedNodeIds.length} dropped node ID{report.droppedNodeIds.length === 1 ? "" : "s"}</span></p>
              ))}
            </details>
          )}
          <section className="atlas-presets">
            <header>
              <span><small>STRATEGY PRESETS</small><strong>Save and switch trees</strong></span>
              <em>{workspace.loadouts.length}/30</em>
            </header>
            <div className="atlas-save-row">
              <input value={loadoutName} onChange={(event) => setLoadoutName(event.target.value)} placeholder="Strategy name" maxLength={80} />
              <input value={loadoutFolder} onChange={(event) => setLoadoutFolder(event.target.value)} placeholder="Folder (optional)" maxLength={80} />
              <input value={loadoutTags} onChange={(event) => setLoadoutTags(event.target.value)} placeholder="Tags, comma separated" maxLength={400} />
              <textarea value={loadoutNotes} onChange={(event) => setLoadoutNotes(event.target.value)} placeholder="Strategy notes and reminders" maxLength={2000} />
              <button type="button" onClick={saveLoadout}>Save current</button>
            </div>
            <div className="atlas-preset-tools">
              <input value={presetQuery} onChange={(event) => setPresetQuery(event.target.value)} placeholder="Filter presets, folders, tags or notes" />
              <button type="button" onClick={() => void importPresets()}>Import</button>
              <button type="button" disabled={!workspace.loadouts.length} onClick={() => void exportPresets()}>Export all</button>
            </div>
            <div className="atlas-loadouts">
              {visibleLoadouts.map((loadout) => (
                <article key={loadout.id}>
                  <span><strong>{loadout.name}</strong><small>{loadout.folder ? `${loadout.folder} · ` : ""}{loadout.nodeIds.length} nodes · {loadout.basePoints} points · PoE {loadout.gameVersion}</small>{loadout.tags.length > 0 && <em>{loadout.tags.join(" · ")}</em>}{loadout.notes && <p>{loadout.notes}</p>}</span>
                  <button type="button" onClick={() => {
                    setWorkspace((current) => ({ ...current, basePoints: loadout.basePoints, nodeIds: loadout.nodeIds }));
                    setMessage(`Loaded strategy “${loadout.name}”.`);
                  }}>Load</button>
                  <button type="button" onClick={() => {
                    setLoadoutName(loadout.name);
                    setLoadoutFolder(loadout.folder);
                    setLoadoutTags(loadout.tags.join(", "));
                    setLoadoutNotes(loadout.notes);
                    setMessage(`Editing metadata for “${loadout.name}”. Save current will also capture the current tree.`);
                  }}>Edit</button>
                  <button type="button" onClick={() => setWorkspace((current) => ({
                    ...current,
                    loadouts: [...current.loadouts, {
                      ...loadout,
                      id: crypto.randomUUID(),
                      name: `${loadout.name} copy`.slice(0, 80),
                      createdAt: Date.now(),
                      updatedAt: Date.now(),
                    }].slice(-30),
                  }))}>Duplicate</button>
                  <button type="button" className="is-delete" aria-label={`Delete ${loadout.name}`} onClick={() => setWorkspace((current) => ({ ...current, loadouts: current.loadouts.filter((entry) => entry.id !== loadout.id) }))}>Delete</button>
                </article>
              ))}
              {!visibleLoadouts.length && <p>{workspace.loadouts.length ? "No preset matches this filter." : "Save named trees for mapping, bosses, league mechanics, or any strategy you choose."}</p>}
            </div>
          </section>
        </aside>
      </div>

      <div className="atlas-utilities">
        <section>
          <small>OFFICIAL URL</small>
          <h3>Import or share</h3>
          <textarea value={importValue} onChange={(event) => setImportValue(event.target.value)} placeholder="Paste an official pathofexile.com Atlas skill-tree URL" />
          <div>
            <button type="button" onClick={() => {
              try {
                const nodeIds = decodeAtlasUrl(atlas, importValue);
                setWorkspace((current) => ({ ...current, basePoints: atlas.totalPoints, nodeIds }));
                setMessage(`Imported ${nodeIds.length} connected Atlas nodes; the planning budget is set to the official ${atlas.totalPoints}-point base.`);
              } catch (error) {
                setMessage(`Import rejected. ${error instanceof Error ? error.message : String(error)}`);
              }
            }}>Import validated URL</button>
            <button type="button" onClick={() => {
              try {
                const url = encodeAtlasUrl(atlas, workspace.nodeIds);
                void navigator.clipboard.writeText(url)
                  .then(() => setMessage("Copied the official version-6 Atlas URL."))
                  .catch((error) => setMessage(`Clipboard write failed. ${error instanceof Error ? error.message : String(error)}`));
              } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
            }}>Copy official URL</button>
            <button type="button" onClick={() => {
              try {
                const url = encodeAtlasUrl(atlas, workspace.nodeIds);
                void import("../lib/bridge").then(({ bridge }) => bridge.openExternal(url));
              } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
            }}>Open official tree</button>
          </div>
        </section>

        <section>
          <small>STRATEGY DIFFERENCE</small>
          <h3>Compare saved presets</h3>
          <div className="atlas-compare-selects">
            <select value={compareLeft} onChange={(event) => setCompareLeft(event.target.value)}><option value="">First preset</option>{workspace.loadouts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
            <select value={compareRight} onChange={(event) => setCompareRight(event.target.value)}><option value="">Second preset</option>{workspace.loadouts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select>
          </div>
          {comparison ? (
            <div className="atlas-comparison">
              <p><strong>{comparison.shared.length}</strong> shared · <strong>{comparison.onlyLeft.length}</strong> only in {leftLoadout?.name} · <strong>{comparison.onlyRight.length}</strong> only in {rightLoadout?.name}</p>
              {comparison.onlyLeft.length > 0 && <span>{leftLoadout?.name}: {nodeSummary(atlas, comparison.onlyLeft).join(", ")}</span>}
              {comparison.onlyRight.length > 0 && <span>{rightLoadout?.name}: {nodeSummary(atlas, comparison.onlyRight).join(", ")}</span>}
            </div>
          ) : <p>Select two saved presets. Comparison reports exact node differences without inventing strategy scores.</p>}
        </section>
      </div>
    </div>
  );
}
