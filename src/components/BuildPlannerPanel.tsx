import clsx from "clsx";
import {
  ArrowLeft,
  ArrowRight,
  Clipboard,
  Copy,
  FolderOpen,
  History,
  LoaderCircle,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Upload,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import { bridge } from "../lib/bridge";
import {
  emptyPobBuild,
  parsePobXml,
  pobStatCategory,
  pobStatLabel,
  pobStatPercent,
  itemsWithPassiveSpecLoadout,
  serializePobXml,
  specsWithActiveJewelLoadout,
  type ImportedPassiveSpec,
  type ImportedPobBuild,
  type ImportedPobItem,
} from "../lib/planner/pob-build";
import {
  comparePlannerBuilds,
  createPlannerSnapshot,
  parseSavedPlannerBuilds,
  recoverSavedPlannerLibrary,
  SAVED_PLANNER_BUILDS_KEY,
  sanitizePlannerSnapshot,
  serializeSavedPlannerBuilds,
  upsertSavedPlannerBuild,
  type PlannerWorkspaceSnapshot,
} from "../lib/planner/planner-workspace";
import { materializeImportedPassiveSpec, materializeImportedPassiveTree } from "../lib/planner/cluster-jewel-graph";
import { PlannerAsyncRevisionGuard, type PlannerAsyncRequestToken } from "../lib/planner/planner-async-guard";
import {
  allocatePassivePath,
  buildPassiveAllocationContext,
  classStartNode,
  countAllocatedPassivePoints,
  dependentAllocatedNodes,
  extendPassiveTracePath,
  isAllocatedClassConnected,
  retainConnectedAllocatedPassives,
  refundNodeAndDependents,
  searchPassiveNodes,
  shortestAllocationPath,
} from "../lib/planner/passive-graph";
import {
  defaultPassiveTreeViewport,
  orderedMasteryEffects,
  passiveTreeConnections,
  resizedPassiveTreeViewport,
  visiblePassiveNodes,
} from "../lib/planner/passive-render";
import type {
  PassiveTreeData,
  PassiveTreeNodeData,
  PassiveTreeSpriteRect,
  PobEngineDiagnostic,
  PoeCharacterImportRequest,
  PoeCharacterSummary,
} from "../types";
import {
  PlannerBuildsPanel,
  PlannerCalcsPanel,
  PlannerConfigPanel,
  PlannerGalaxyPanel,
  PlannerItemsPanel,
  PlannerSkillsPanel,
  presentPlannerItem,
} from "./PlannerPanels";
import "../planner.css";

type PlannerTab = "tree" | "items" | "skills" | "config" | "calcs" | "galaxy" | "builds" | "notes" | "history";
type Viewport = { x: number; y: number; scale: number };
type TreeSelection = { classId: number; ascendancyId: number; secondaryAscendancyId: number };
type TreeHistory = TreeSelection & { allocated: Set<number>; masteryEffects: Record<number, number>; label: string; at: number };
type TreeHover = { node: PassiveTreeNodeData; x: number; y: number; width: number; height: number };
type MasteryPicker = { nodeId: number; path: number[] };

function passiveNodeKind(node: PassiveTreeNodeData) {
  if (node.classStartIds.length) return "Class start";
  if (node.isAscendancyStart) return "Ascendancy start";
  if (node.mastery) return "Mastery";
  if (node.keystone) return "Keystone";
  if (node.notable) return "Notable";
  if (node.jewelSocket) return "Jewel socket";
  return node.ascendancyName ? "Ascendancy passive" : "Passive";
}

function passiveRecipeLabel(value: string) {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim();
}

export function PassiveNodeTooltip({
  hover,
  allocated,
  previewPath,
  dependents,
  socketedItem,
  usedMasteryEffects,
  radiusSummary,
  selectedAscendancyName,
  selectedSecondaryName,
}: {
  hover: TreeHover;
  allocated: boolean;
  previewPath: readonly number[];
  dependents: ReadonlySet<number>;
  socketedItem: ImportedPobItem | null;
  usedMasteryEffects: ReadonlySet<number>;
  radiusSummary: string | null;
  selectedAscendancyName: string;
  selectedSecondaryName: string;
}) {
  const { node } = hover;
  const gap = 14;
  const margin = 8;
  const leftRoom = Math.max(0, hover.x - gap - margin);
  const rightRoom = Math.max(0, hover.width - hover.x - gap - margin);
  const aboveRoom = Math.max(0, hover.y - gap - margin);
  const belowRoom = Math.max(0, hover.height - hover.y - gap - margin);
  const placeLeft = leftRoom >= rightRoom;
  const placeAbove = aboveRoom >= belowRoom;
  const orderedMasteryOptions = orderedMasteryEffects(node);
  const masteryOptions = orderedMasteryOptions.length;
  const availableMasteryOptions = orderedMasteryOptions.filter(({ id }) => (
    id === node.selectedMasteryEffect || !usedMasteryEffects.has(id)
  ));
  const socketView = socketedItem ? presentPlannerItem(socketedItem) : null;
  const switchesAscendancy = Boolean(node.ascendancyName) && (node.bloodline
    ? node.ascendancyName !== selectedSecondaryName
    : node.ascendancyName !== selectedAscendancyName);
  return (
    <div
      className="passive-tooltip"
      style={{
        ...(placeLeft ? { right: hover.width - hover.x + gap } : { left: hover.x + gap }),
        ...(placeAbove ? { bottom: hover.height - hover.y + gap } : { top: hover.y + gap }),
        maxWidth: Math.max(96, Math.min(310, placeLeft ? leftRoom : rightRoom)),
        maxHeight: Math.max(80, placeAbove ? aboveRoom : belowRoom),
      }}
      role="tooltip"
    >
      <header>
        <small>{passiveNodeKind(node).toLocaleUpperCase()}</small>
        <em className={allocated ? "is-allocated" : previewPath.length ? "is-preview" : ""}>
          {allocated ? "Allocated" : previewPath.length ? `${previewPath.length} point${previewPath.length === 1 ? "" : "s"}` : "Unallocated"}
        </em>
      </header>
      <strong>{node.name}</strong>
      <div className="passive-tooltip-mods">
        {node.stats.length
          ? node.stats.map((stat, index) => <span key={`${index}-${stat}`}>{stat}</span>)
          : <span className="is-muted">No direct modifiers</span>}
        {Boolean(node.grantedPassivePoints) && <span>Grants {node.grantedPassivePoints} Passive Skill Point{node.grantedPassivePoints === 1 ? "" : "s"}</span>}
      </div>
      {node.reminderText?.length ? <div className="passive-tooltip-reminder">{node.reminderText.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div> : null}
      {node.flavourText?.length ? <div className="passive-tooltip-flavour">{node.flavourText.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div> : null}
      {node.recipe?.length ? <section className="passive-tooltip-recipe"><small>Anoint recipe</small><b>{node.recipe.map(passiveRecipeLabel).join(" + ")}</b></section> : null}
      {node.mastery && !node.selectedMasteryEffect && availableMasteryOptions.length > 0 && <section className="passive-tooltip-mastery-options"><small>Available mastery options</small>{availableMasteryOptions.map(({ id, effect }) => <div key={id}><b>{effect.stats.join(" · ") || "Mastery effect"}</b>{effect.reminderText.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}</div>)}</section>}
      {socketedItem && socketView && (
        <section className="passive-tooltip-item">
          <small>{socketView.rarityLabel} socketed jewel</small>
          <b>{socketedItem.name}</b>
          {socketedItem.baseType !== socketedItem.name && <i>{socketedItem.baseType}</i>}
          {socketView.statuses.length > 0 && <div className="passive-tooltip-item-statuses">{socketView.statuses.map((status) => <em key={status}>{status}</em>)}</div>}
          {socketView.properties.length > 0 && <dl>{socketView.properties.map((property) => <div key={property.label}><dt>{property.label}</dt><dd>{property.value}</dd></div>)}</dl>}
          {socketView.modifiers.length > 0 && <div className="passive-tooltip-item-modifiers">{socketView.modifiers.map((modifier, index) => <span key={`${modifier.text}-${index}`}>{modifier.badges.length > 0 && <small>{modifier.badges.join(" · ")}</small>}{modifier.text}</span>)}</div>}
        </section>
      )}
      {radiusSummary && <section className="passive-tooltip-radius"><small>Jewel radius</small><span>{radiusSummary}</span></section>}
      <footer>
        {switchesAscendancy
          ? `Left-click switches to this ${node.bloodline ? "bloodline" : "ascendancy"}${node.bloodline ? "." : "; cross-class switches preserve the tree only when its class start is connected."}`
          : allocated && node.mastery
            ? "Left-click refunds this mastery. Right-click changes its selected effect."
          : allocated && !node.classStartIds.length
          ? `Left-click refunds ${dependents.size} allocated node${dependents.size === 1 ? "" : "s"}.`
          : previewPath.length
            ? `Left-click allocates this node and ${Math.max(0, previewPath.length - 1)} leading node${previewPath.length - 1 === 1 ? "" : "s"}.`
            : node.mastery
              ? "A mastery must be reached from an allocated adjacent passive."
              : "No legal path from the selected class tree."}
        {masteryOptions > 0 && <span>{node.selectedMasteryEffect ? "Selected mastery effect" : "Choose a mastery effect when allocating"} · {masteryOptions} option{masteryOptions === 1 ? "" : "s"}</span>}
        {node.multipleChoiceOption && <span>Allocating this choice refunds the other choice in its group.</span>}
        {node.isBlighted && <span>This is a Blight-only passive-tree variant.</span>}
      </footer>
    </div>
  );
}

const MAX_HISTORY = 120;

function normalizedTreeVersion(value: string | undefined) {
  const normalized = String(value || "").trim().replace(/\./g, "_").toLocaleLowerCase();
  const base = normalized.replace(/_(?:ruthless|alternate)(?:_(?:ruthless|alternate))*$/, "");
  return `${base}${/(?:^|_)ruthless(?:_|$)/.test(normalized) ? "_ruthless" : ""}${/(?:^|_)alternate(?:_|$)/.test(normalized) ? "_alternate" : ""}`;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function officialTreeUrl(
  tree: PassiveTreeData,
  allocated: ReadonlySet<number>,
  classId: number,
  ascendancyId: number,
  secondaryAscendancyId: number,
) {
  const classStarts = new Set(tree.nodes.filter((node) => node.classStartIds.length > 0 || node.isAscendancyStart).map((node) => node.id));
  const ids = [...allocated].filter((id) => id > 0 && id < 65536 && !classStarts.has(id)).slice(0, 255);
  const bytes = new Uint8Array(7 + ids.length * 2 + 2);
  bytes.set([0, 0, 0, 6, classId, ((secondaryAscendancyId & 3) << 2) | (ascendancyId & 3), ids.length]);
  ids.forEach((id, index) => {
    bytes[7 + index * 2] = Math.floor(id / 256);
    bytes[8 + index * 2] = id % 256;
  });
  return `https://www.pathofexile.com/passive-skill-tree/${base64Url(bytes)}`;
}

function resolveRemoteBuildUrl(raw: string) {
  const url = new URL(raw);
  if (url.hostname === "pobb.in" && !url.pathname.endsWith("/raw")) url.pathname += "/raw";
  if ((url.hostname === "pastebin.com" || url.hostname === "www.pastebin.com") && !url.pathname.startsWith("/raw/")) {
    url.pathname = `/raw${url.pathname}`;
  }
  return url.toString();
}

function withSelectedPassiveStarts(
  tree: PassiveTreeData,
  source: Iterable<number>,
  classId: number,
  ascendancyId = 0,
  secondaryAscendancyId = 0,
) {
  const next = new Set(source);
  const start = classStartNode(tree, classId);
  if (start) next.add(start.id);
  const ascendancyName = tree.classes.find((entry) => entry.id === classId)
    ?.ascendancies.find((entry) => entry.id === ascendancyId)?.internalId;
  const secondaryName = tree.alternateAscendancies?.find((entry) => entry.id === secondaryAscendancyId)?.internalId;
  for (const name of [ascendancyName, secondaryName]) {
    if (!name) continue;
    const ascendancyStart = tree.nodes.find((node) => node.isAscendancyStart && node.ascendancyName === name);
    if (ascendancyStart) next.add(ascendancyStart.id);
  }
  return next;
}

function normalizedSpecAllocation(
  tree: PassiveTreeData,
  spec: ImportedPassiveSpec | null | undefined,
  items: readonly ImportedPobItem[],
  source: Iterable<number>,
  classId: number,
  ascendancyId = 0,
  secondaryAscendancyId = 0,
) {
  const materialized = materializeImportedPassiveTree(tree, spec, items);
  const next = withSelectedPassiveStarts(
    materialized.tree,
    source,
    classId,
    ascendancyId,
    secondaryAscendancyId,
  );
  for (const nodeId of materialized.mappedExtendedAllocations) next.add(nodeId);
  const selectedClass = tree.classes.find((entry) => entry.id === classId);
  const ascendancyName = selectedClass?.ascendancies.find((entry) => entry.id === ascendancyId)?.internalId;
  const secondaryName = tree.alternateAscendancies?.find((entry) => entry.id === secondaryAscendancyId)?.internalId;
  return retainConnectedAllocatedPassives(
    materialized.tree,
    next,
    classId,
    ascendancyName,
    secondaryName,
    buildPassiveAllocationContext(materialized.tree, spec, items),
  );
}

function PassiveTreeCanvas({
  tree,
  allocated,
  previewed,
  refundPreview,
  highlighted,
  hoveredId,
  classId,
  ascendancyName,
  secondaryAscendancyName,
  onAllocate,
  onRefund,
  onMastery,
  onHover,
}: {
  tree: PassiveTreeData;
  allocated: ReadonlySet<number>;
  previewed: ReadonlySet<number>;
  refundPreview: ReadonlySet<number>;
  highlighted: ReadonlySet<number>;
  hoveredId: number | null;
  classId: number;
  ascendancyName: string;
  secondaryAscendancyName: string;
  onAllocate: (node: PassiveTreeNodeData) => void;
  onRefund: (node: PassiveTreeNodeData) => void;
  onMastery: (node: PassiveTreeNodeData) => void;
  onHover: (node: PassiveTreeNodeData | null, point?: { x: number; y: number; width: number; height: number }) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport>({ x: 0, y: 0, scale: 0.03 });
  const [revision, setRevision] = useState(0);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const drag = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);

  const visibleNodes = useMemo(
    () => visiblePassiveNodes(tree, ascendancyName, secondaryAscendancyName),
    [ascendancyName, secondaryAscendancyName, tree],
  );
  const connections = useMemo(() => passiveTreeConnections(visibleNodes), [visibleNodes]);
  const visibleGroupIds = useMemo(() => new Set(visibleNodes.map((node) => node.groupId)), [visibleNodes]);
  const visibleGroups = useMemo(
    () => (tree.groups || []).filter((group) => visibleGroupIds.has(group.id)),
    [tree.groups, visibleGroupIds],
  );
  const groupMap = useMemo(() => new Map(visibleGroups.map((group) => [group.id, group])), [visibleGroups]);

  useEffect(() => {
    let active = true;
    const images = new Map<string, HTMLImageElement>();
    imagesRef.current = images;
    for (const [sheet, source] of Object.entries(tree.assets?.sheets || {})) {
      const image = new Image();
      images.set(sheet, image);
      image.onload = image.onerror = () => active && setRevision((value) => value + 1);
      image.src = source.src;
    }
    setRevision((value) => value + 1);
    return () => {
      active = false;
      for (const image of images.values()) image.onload = image.onerror = null;
    };
  }, [tree.assets]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== Math.round(width * ratio) || canvas.height !== Math.round(height * ratio)) {
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    const view = viewportRef.current;
    const screen = (node: PassiveTreeNodeData) => ({ x: node.x * view.scale + view.x, y: node.y * view.scale + view.y });
    const isSelectedTree = (name: string | null | undefined) => (
      !name || name === ascendancyName || name === secondaryAscendancyName
    );
    const images = imagesRef.current;

    const background = tree.assets?.backgrounds.Background2;
    const backgroundImage = background && images.get(background.sheet);
    if (backgroundImage?.complete && backgroundImage.naturalWidth) {
      const pattern = context.createPattern(backgroundImage, "repeat");
      context.fillStyle = pattern || "#071016";
    } else {
      context.fillStyle = "#071016";
    }
    context.fillRect(0, 0, width, height);
    const vignette = context.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) * 0.72);
    vignette.addColorStop(0, "rgba(2,10,15,.04)");
    vignette.addColorStop(0.72, "rgba(2,9,13,.18)");
    vignette.addColorStop(1, "rgba(1,5,8,.66)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);

    const drawSprite = (
      sprite: PassiveTreeSpriteRect | null | undefined,
      x: number,
      y: number,
      options: { half?: boolean; opacity?: number } = {},
    ) => {
      if (!sprite) return false;
      const image = images.get(sprite.sheet);
      if (!image?.complete || !image.naturalWidth || sprite.w <= 0 || sprite.h <= 0) return false;
      const drawWidth = sprite.w * view.scale * 2.66;
      const drawHeight = sprite.h * view.scale * 2.66;
      if (drawWidth < 0.35 || drawHeight < 0.35) return false;
      context.save();
      context.globalAlpha *= options.opacity ?? 1;
      if (options.half) {
        context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, x - drawWidth / 2, y - drawHeight, drawWidth, drawHeight);
        context.translate(0, 2 * y);
        context.scale(1, -1);
        context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, x - drawWidth / 2, y - drawHeight, drawWidth, drawHeight);
      } else {
        context.drawImage(image, sprite.x, sprite.y, sprite.w, sprite.h, x - drawWidth / 2, y - drawHeight / 2, drawWidth, drawHeight);
      }
      context.restore();
      return true;
    };

    for (const group of visibleGroups) {
      const x = group.x * view.scale + view.x;
      const y = group.y * view.scale + view.y;
      if (x < -180 || x > width + 180 || y < -180 || y > height + 180) continue;
      if (group.ascendancyName && group.isAscendancyStart) {
        drawSprite(
          tree.assets?.ascendancies[`Classes${group.ascendancyName}`],
          x,
          y,
          { opacity: isSelectedTree(group.ascendancyName) ? 1 : 0.42 },
        );
      } else if (group.background) {
        drawSprite(
          tree.assets?.groupBackgrounds[group.background.image],
          x,
          y,
          { half: group.background.isHalfImage, opacity: 0.78 },
        );
      }
    }

    for (const connection of connections) {
      const from = screen(connection.from);
      const to = screen(connection.to);
      if ((from.x < -30 && to.x < -30) || (from.x > width + 30 && to.x > width + 30) || (from.y < -30 && to.y < -30) || (from.y > height + 30 && to.y > height + 30)) continue;
      const active = allocated.has(connection.from.id) && allocated.has(connection.to.id);
      const refunding = active
        && (refundPreview.has(connection.from.id) || refundPreview.has(connection.to.id));
      context.save();
      context.globalAlpha = isSelectedTree(connection.from.ascendancyName) ? 1 : 0.42;
      const preview = !active
        && (allocated.has(connection.from.id) || previewed.has(connection.from.id))
        && (allocated.has(connection.to.id) || previewed.has(connection.to.id))
        && (previewed.has(connection.from.id) || previewed.has(connection.to.id));
      context.strokeStyle = refunding
        ? "rgba(255,91,91,.94)"
        : active
          ? "rgba(73,235,199,.88)"
        : preview
          ? "rgba(218,242,255,.92)"
          : "rgba(118,137,139,.24)";
      context.lineWidth = active || preview ? Math.max(1.35, view.scale * 31) : Math.max(0.7, view.scale * 15);
      context.beginPath();
      const group = connection.from.groupId === connection.to.groupId ? groupMap.get(connection.from.groupId || -1) : null;
      if (group && connection.from.orbit === connection.to.orbit && Number(connection.from.orbit) > 0) {
        const centerX = group.x * view.scale + view.x;
        const centerY = group.y * view.scale + view.y;
        const radius = Math.hypot(connection.from.x - group.x, connection.from.y - group.y) * view.scale;
        const start = Math.atan2(connection.from.y - group.y, connection.from.x - group.x);
        let end = Math.atan2(connection.to.y - group.y, connection.to.x - group.x);
        while (end - start > Math.PI) end -= Math.PI * 2;
        while (end - start < -Math.PI) end += Math.PI * 2;
        context.arc(centerX, centerY, radius, start, end, end < start);
      } else {
        context.moveTo(from.x, from.y);
        context.lineTo(to.x, to.y);
      }
      context.stroke();
      context.restore();
    }

    for (const node of visibleNodes) {
      const point = screen(node);
      if (point.x < -20 || point.x > width + 20 || point.y < -20 || point.y > height + 20) continue;
      const active = allocated.has(node.id);
      const preview = previewed.has(node.id);
      const refunding = refundPreview.has(node.id);
      const match = highlighted.has(node.id);
      const hovered = hoveredId === node.id;
      const start = node.classStartIds.includes(classId);
      context.save();
      context.globalAlpha = isSelectedTree(node.ascendancyName) ? 1 : 0.42;
      let rendered = false;
      if (node.classStartIds.length) {
        const className = tree.classes.find((entry) => node.classStartIds.includes(entry.id))?.name.toLowerCase().replace(/\s+/g, "") || "scion";
        rendered = drawSprite(
          active || start ? tree.assets?.startNodes[`center${className}`] : tree.assets?.startNodes.PSStartNodeBackgroundInactive,
          point.x,
          point.y,
        );
      } else if (node.isAscendancyStart) {
        rendered = drawSprite(tree.assets?.ascendancies.AscendancyMiddle, point.x, point.y);
      } else {
        rendered = drawSprite(active ? node.spriteActive : node.spriteInactive, point.x, point.y);
        if (!node.mastery) {
          const prefix = node.ascendancyName ? "Ascendancy" : node.keystone ? "Keystone" : node.notable ? "Notable" : node.jewelSocket ? "Jewel" : "PSSkill";
          const suffix = node.ascendancyName
            ? `${node.notable ? "FrameLarge" : "FrameSmall"}${active ? "Allocated" : preview ? "CanAllocate" : "Normal"}`
            : node.keystone
              ? `Frame${active ? "Allocated" : preview ? "CanAllocate" : "Unallocated"}`
              : node.notable
                ? `Frame${active ? "Allocated" : preview ? "CanAllocate" : "Unallocated"}`
                : node.jewelSocket
                  ? `Frame${active ? "Allocated" : preview ? "CanAllocate" : "Unallocated"}`
                  : `Frame${active ? "Active" : preview ? "Highlighted" : ""}`;
          const frameName = `${prefix}${suffix}`;
          rendered = drawSprite(tree.assets?.frames[frameName] || tree.assets?.ascendancies[frameName], point.x, point.y) || rendered;
        }
      }
      const fallbackRadius = node.keystone ? 6 : node.notable || node.mastery ? 4.4 : node.jewelSocket ? 4 : 2.35;
      if (!rendered) {
        context.beginPath();
        context.arc(point.x, point.y, fallbackRadius, 0, Math.PI * 2);
        context.fillStyle = refunding ? "#ff5b5b" : active ? "#39dcb9" : preview ? "#d9f4ff" : match ? "#ffd76c" : start ? "#ef9f45" : node.ascendancyName ? "#8a6de9" : "#314551";
        context.fill();
      }
      if (active || preview || match || start || hovered) {
        const radius = Math.max(fallbackRadius + 1.5, (node.keystone ? 112 : node.notable || node.mastery || node.jewelSocket ? 78 : 55) * view.scale);
        context.beginPath();
        context.arc(point.x, point.y, radius, 0, Math.PI * 2);
        context.strokeStyle = refunding ? "rgba(255,91,91,.96)" : active ? "rgba(92,255,219,.86)" : preview ? "#e6f7ff" : match ? "#fff2bd" : hovered ? "#ffffff" : "#ffd8a3";
        context.lineWidth = match || hovered ? 2 : 1;
        context.stroke();
      }
      context.restore();
    }
  }, [allocated, ascendancyName, classId, connections, groupMap, highlighted, hoveredId, previewed, refundPreview, secondaryAscendancyName, tree.assets, tree.classes, visibleGroups, visibleNodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    let previousSize = { width: 0, height: 0 };
    const resize = () => {
      const nextSize = { width: canvas.clientWidth, height: canvas.clientHeight };
      if (nextSize.width <= 0 || nextSize.height <= 0) return;
      if (previousSize.width > 0 && previousSize.height > 0) {
        if (nextSize.width === previousSize.width && nextSize.height === previousSize.height) return;
        viewportRef.current = resizedPassiveTreeViewport(viewportRef.current, previousSize, nextSize);
      } else {
        viewportRef.current = defaultPassiveTreeViewport(tree, nextSize.width, nextSize.height);
      }
      previousSize = nextSize;
      setRevision((value) => value + 1);
    };
    const fit = () => {
      previousSize = { width: canvas.clientWidth, height: canvas.clientHeight };
      if (previousSize.width <= 0 || previousSize.height <= 0) return;
      viewportRef.current = defaultPassiveTreeViewport(tree, canvas.clientWidth, canvas.clientHeight);
      setRevision((value) => value + 1);
    };
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    fit();
    return () => observer.disconnect();
  }, [ascendancyName, classId, secondaryAscendancyName, tree.game, tree.sourcePath, tree.version]);

  useEffect(() => redraw(), [redraw, revision]);

  const nearest = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const view = viewportRef.current;
    let best: PassiveTreeNodeData | null = null;
    let distance = Number.POSITIVE_INFINITY;
    for (const node of visibleNodes) {
      const dx = node.x * view.scale + view.x - x;
      const dy = node.y * view.scale + view.y - y;
      const next = dx * dx + dy * dy;
      const spriteRadius = Math.max(
        node.keystone ? 7 : node.notable || node.mastery || node.jewelSocket ? 6 : 4,
        Math.min(34, (node.spriteActive?.w || node.spriteInactive?.w || (node.keystone ? 112 : node.notable || node.mastery || node.jewelSocket ? 78 : 55)) * view.scale * 1.33 + 3),
      );
      if (next <= spriteRadius * spriteRadius && next < distance) {
        best = node;
        distance = next;
      }
    }
    return best;
  };

  const pointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, originX: viewportRef.current.x, originY: viewportRef.current.y, moved: false };
  };

  const pointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = drag.current;
    if (active) {
      const dx = event.clientX - active.x;
      const dy = event.clientY - active.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) active.moved = true;
      viewportRef.current = { ...viewportRef.current, x: active.originX + dx, y: active.originY + dy };
      setRevision((value) => value + 1);
      if (active.moved) {
        onHover(null);
        return;
      }
    }
    const node = nearest(event.clientX, event.clientY);
    const rect = event.currentTarget.getBoundingClientRect();
    onHover(node, { x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width, height: rect.height });
  };

  const pointerUp = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = drag.current;
    drag.current = null;
    if (!active?.moved && event.button === 0) {
      const node = nearest(event.clientX, event.clientY);
      if (node) {
        if (allocated.has(node.id)) onRefund(node);
        else onAllocate(node);
      }
    }
  };

  const wheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    const view = viewportRef.current;
    const worldX = (mouseX - view.x) / view.scale;
    const worldY = (mouseY - view.y) / view.scale;
    const baseScale = Math.min(rect.width, rect.height) / Math.max(1, Number(tree.size) || 24000);
    const scale = Math.min(baseScale * (1.2 ** 12), Math.max(baseScale, view.scale * Math.exp(-event.deltaY * 0.0012)));
    viewportRef.current = { scale, x: mouseX - worldX * scale, y: mouseY - worldY * scale };
    onHover(null);
    setRevision((value) => value + 1);
  };

  return (
    <canvas
      ref={canvasRef}
      className="passive-tree-canvas"
      tabIndex={0}
      aria-label="Interactive Path of Building passive tree. Drag to pan, use the mouse wheel to zoom, and use the search field to locate passives."
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={pointerUp}
      onPointerCancel={() => { drag.current = null; onHover(null); }}
      onPointerLeave={() => onHover(null)}
      onWheel={wheel}
      onDoubleClick={(event) => {
        viewportRef.current = defaultPassiveTreeViewport(tree, event.currentTarget.clientWidth, event.currentTarget.clientHeight);
        onHover(null);
        setRevision((value) => value + 1);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        const node = nearest(event.clientX, event.clientY);
        if (node?.mastery && allocated.has(node.id)) onMastery(node);
      }}
    />
  );
}

export function BuildPlannerPanel() {
  const [tree, setTree] = useState<PassiveTreeData | null>(null);
  const [build, setBuild] = useState<ImportedPobBuild | null>(null);
  const [specs, setSpecs] = useState<ImportedPassiveSpec[]>([]);
  const [activeSpecId, setActiveSpecId] = useState("");
  const [allocated, setAllocated] = useState<Set<number>>(new Set());
  const [classId, setClassId] = useState(0);
  const [ascendancyId, setAscendancyId] = useState(0);
  const [tab, setTab] = useState<PlannerTab>("tree");
  const [query, setQuery] = useState("");
  const [hover, setHover] = useState<TreeHover | null>(null);
  const [traceMode, setTraceMode] = useState(false);
  const [tracePath, setTracePath] = useState<number[]>([]);
  const [masteryPicker, setMasteryPicker] = useState<MasteryPicker | null>(null);
  const [unsavedMasteryEffects, setUnsavedMasteryEffects] = useState<Record<number, number>>({});
  const [unsavedSecondaryAscendancyId, setUnsavedSecondaryAscendancyId] = useState(0);
  const [importText, setImportText] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"pob" | "character">("pob");
  const [characterMode, setCharacterMode] = useState<"public" | "oauth">("public");
  const [accountName, setAccountName] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [realm, setRealm] = useState<PoeCharacterImportRequest["realm"]>("pc");
  const [characters, setCharacters] = useState<PoeCharacterSummary[]>([]);
  const [selectedCharacter, setSelectedCharacter] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(true);
  const [history, setHistory] = useState<TreeHistory[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [savedBuilds, setSavedBuilds] = useState<PlannerWorkspaceSnapshot[]>([]);
  const [savedLibraryError, setSavedLibraryError] = useState("");
  const [recoveringSavedLibrary, setRecoveringSavedLibrary] = useState(false);
  const [activeSavedId, setActiveSavedId] = useState("");
  const [baselineId, setBaselineId] = useState("");
  const [editedSinceImport, setEditedSinceImport] = useState(false);
  const [engineCapability, setEngineCapability] = useState<PobEngineDiagnostic | null>(null);
  const [calculating, setCalculating] = useState(false);
  const asyncGuardRef = useRef(new PlannerAsyncRevisionGuard());
  const plannerIdentityRef = useRef({ build, specs, activeSpecId, tree });
  plannerIdentityRef.current = { build, specs, activeSpecId, tree };

  const markPlannerChanged = () => asyncGuardRef.current.markChanged();
  const beginReplacement = () => asyncGuardRef.current.begin("replacement");
  const replacementCanApply = (token: PlannerAsyncRequestToken, action: string) => {
    const status = asyncGuardRef.current.inspect(token);
    if (status === "current") return true;
    if (status === "changed") setMessage(`The build changed while ${action}; the current workspace was kept.`);
    return false;
  };
  const reportReplacementError = (token: PlannerAsyncRequestToken, action: string, error: unknown) => {
    if (replacementCanApply(token, action)) setMessage(error instanceof Error ? error.message : String(error));
  };

  const initialiseTree = (value: PassiveTreeData, label: string) => {
    markPlannerChanged();
    const initialClassId = value.classes[0]?.id ?? 0;
    const start = classStartNode(value, initialClassId);
    const initial = new Set(start ? [start.id] : []);
    setTree(value);
    setBuild(null);
    setSpecs([]);
    setActiveSpecId("");
    setUnsavedMasteryEffects({});
    setUnsavedSecondaryAscendancyId(0);
    setMasteryPicker(null);
    setTraceMode(false);
    setTracePath([]);
    setClassId(initialClassId);
    setAscendancyId(0);
    setAllocated(initial);
    setHistory([{ allocated: initial, masteryEffects: {}, classId: initialClassId, ascendancyId: 0, secondaryAscendancyId: 0, label, at: Date.now() }]);
    setHistoryIndex(0);
    setEditedSinceImport(false);
    setActiveSavedId("");
    setBaselineId("");
    setRealm(value.game === "poe2" ? "poe2" : "pc");
    setImportMode("pob");
    setCharacters([]);
  };

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_PLANNER_BUILDS_KEY);
      setSavedBuilds(parseSavedPlannerBuilds(raw));
      setSavedLibraryError("");
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setSavedLibraryError(detail);
      setMessage(`The local build library is locked: ${detail} Its original data was not changed. Open Builds to save an exact recovery copy and reset it.`);
    }
  }, []);

  useEffect(() => {
    if (tree?.game === "poe2" && importMode !== "pob") setImportMode("pob");
  }, [importMode, tree?.game]);

  useEffect(() => {
    let active = true;
    bridge.diagnosePobEngine()
      .then((result) => active && setEngineCapability(result))
      .catch((error) => active && setEngineCapability({
        ok: false,
        authoritative: false,
        available: false,
        capability: "unavailable",
        code: "POB_ENGINE_DIAGNOSTIC_FAILED",
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      }));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Shift") setTraceMode(true);
      if (event.key === "Escape") {
        setMasteryPicker(null);
        setImportOpen(false);
      }
    };
    const keyUp = (event: KeyboardEvent) => {
      if (event.key === "Shift") {
        setTraceMode(false);
        setTracePath([]);
      }
    };
    const blur = () => {
      setTraceMode(false);
      setTracePath([]);
    };
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
      window.removeEventListener("blur", blur);
    };
  }, []);

  useEffect(() => {
    let active = true;
    bridge.getPassiveTreeData({ game: "poe1" }).then((value) => {
      if (!active) return;
      initialiseTree(value, "New build");
    }).catch((error) => active && setMessage(error instanceof Error ? error.message : String(error))).finally(() => active && setBusy(false));
    return () => { active = false; };
  }, []);

  const changeGame = async (game: "poe1" | "poe2") => {
    if (game === tree?.game) return;
    const hasWorkspaceToReplace = Boolean(build || specs.length || editedSinceImport || historyIndex > 0);
    if (hasWorkspaceToReplace && !window.confirm(
      `Switch to ${game === "poe2" ? "PoE 2" : "PoE 1"}? The current unsaved workspace will be replaced. Save it first if you want to keep it.`,
    )) return;
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    setMessage("");
    try {
      const value = await bridge.getPassiveTreeData({ game });
      if (!replacementCanApply(request, "the game tree was loading")) return;
      initialiseTree(value, `New ${game === "poe2" ? "PoE 2" : "PoE 1"} build`);
      setMessage(`${game === "poe2" ? "PoE 2" : "PoE 1"} tree ${value.version.replace("_", ".")} loaded.`);
    } catch (error) {
      reportReplacementError(request, "the game tree was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const activePassiveSpec = specs.find((entry) => entry.id === activeSpecId) || null;
  const secondaryAscendancyId = activePassiveSpec?.secondaryAscendClassId ?? unsavedSecondaryAscendancyId;
  const materializationSpec = useMemo(() => activePassiveSpec || (tree ? {
    id: "current",
    title: "Current tree",
    treeVersion: tree.version,
    classId,
    ascendClassId: ascendancyId,
    secondaryAscendClassId: unsavedSecondaryAscendancyId,
    nodes: [...allocated],
    masteryEffects: unsavedMasteryEffects,
  } : null), [activePassiveSpec, allocated, ascendancyId, classId, tree, unsavedMasteryEffects, unsavedSecondaryAscendancyId]);
  const treeMatchesActiveSpec = !materializationSpec?.treeVersion || normalizedTreeVersion(tree?.version) === normalizedTreeVersion(materializationSpec.treeVersion);
  const materializedTree = useMemo(
    () => tree && treeMatchesActiveSpec ? materializeImportedPassiveTree(tree, materializationSpec, build?.items || []).tree : null,
    [build?.items, materializationSpec, tree, treeMatchesActiveSpec],
  );
  const currentClass = tree?.classes.find((entry) => entry.id === classId) || tree?.classes[0];
  const currentAscendancy = currentClass?.ascendancies.find((entry) => entry.id === ascendancyId);
  const secondaryAscendancyName = tree?.alternateAscendancies?.find(
    (entry) => entry.id === secondaryAscendancyId,
  )?.internalId || "";
  const hoverNodeId = hover?.node.id ?? null;
  const allocationContext = useMemo(
    () => materializedTree
      ? buildPassiveAllocationContext(materializedTree, materializationSpec, build?.items || [])
      : { remoteProviders: [] },
    [build?.items, materializationSpec, materializedTree],
  );
  const searchResults = useMemo(() => materializedTree ? searchPassiveNodes(materializedTree, query) : [], [materializedTree, query]);
  const highlighted = useMemo(() => new Set(searchResults.map((node) => node.id)), [searchResults]);
  const previewPath = useMemo(() => (
    materializedTree && hoverNodeId != null && !allocated.has(hoverNodeId)
      ? shortestAllocationPath(
          materializedTree,
          allocated,
          hoverNodeId,
          classId,
          currentAscendancy?.internalId,
          secondaryAscendancyName,
          allocationContext,
        )
      : []
  ), [allocated, allocationContext, classId, currentAscendancy?.internalId, hoverNodeId, materializedTree, secondaryAscendancyName]);
  useEffect(() => {
    if (!traceMode || !materializedTree || hoverNodeId == null || allocated.has(hoverNodeId) || !previewPath.length) return;
    setTracePath((current) => extendPassiveTracePath(materializedTree, current, hoverNodeId, previewPath));
  }, [allocated, hoverNodeId, materializedTree, previewPath, traceMode]);
  const displayedPreviewPath = traceMode && tracePath.length ? tracePath : previewPath;
  const previewed = useMemo(() => new Set(displayedPreviewPath), [displayedPreviewPath]);
  const hoverDependents = useMemo(() => (
    materializedTree && hoverNodeId != null && allocated.has(hoverNodeId)
      ? dependentAllocatedNodes(
          materializedTree,
          allocated,
          hoverNodeId,
          classId,
          currentAscendancy?.internalId,
          secondaryAscendancyName,
          allocationContext,
        )
      : new Set<number>()
  ), [allocated, allocationContext, classId, currentAscendancy?.internalId, hoverNodeId, materializedTree, secondaryAscendancyName]);
  const hoverSocketedItem = useMemo(() => {
    if (!hover || !build || !activePassiveSpec?.sockets) return null;
    const itemId = Number(activePassiveSpec.sockets[hover.node.id]);
    return build.items.find((item) => item.id === itemId) || null;
  }, [activePassiveSpec?.sockets, build, hoverNodeId]);
  const hoverRadiusSummary = useMemo(() => {
    if (hoverNodeId == null || !materializedTree) return null;
    const provider = allocationContext.remoteProviders.find((entry) => entry.providerId === hoverNodeId);
    if (!provider) return null;
    const center = materializedTree.nodes.find((node) => node.id === provider.centerId);
    const behavior = provider.kind === "impossible-escape" ? "Impossible Escape" : provider.keystoneOnly ? "Foulborn Intuitive Leap" : "Intuitive Leap";
    return `${behavior}: ${provider.affected.size} eligible passive${provider.affected.size === 1 ? "" : "s"}${center && center.id !== provider.providerId ? ` around ${center.name}` : " in radius"}.`;
  }, [allocationContext.remoteProviders, hoverNodeId, materializedTree]);
  const materializedNodeMap = useMemo(
    () => new Map(materializedTree?.nodes.map((node) => [node.id, node]) || []),
    [materializedTree],
  );
  const pointCounts = useMemo(
    () => materializedTree
      ? countAllocatedPassivePoints(materializedTree, allocated)
      : { passive: 0, ascendancy: 0, secondaryAscendancy: 0, sockets: 0 },
    [allocated, materializedTree],
  );
  const passiveCount = pointCounts.passive;
  const secondaryAscendancyCount = pointCounts.secondaryAscendancy;
  const ascendancyCount = pointCounts.ascendancy - pointCounts.secondaryAscendancy;
  const historyPointLabel = (entry: TreeHistory) => {
    if (!materializedTree) return `${entry.allocated.size} allocated`;
    const counts = countAllocatedPassivePoints(materializedTree, entry.allocated);
    const parts = [`${counts.passive} passive`];
    if (counts.ascendancy - counts.secondaryAscendancy > 0) parts.push(`${counts.ascendancy - counts.secondaryAscendancy} ascendancy`);
    if (counts.secondaryAscendancy > 0) parts.push(`${counts.secondaryAscendancy} bloodline`);
    return parts.join(" · ");
  };
  const currentMasteryEffects = activePassiveSpec?.masteryEffects || unsavedMasteryEffects;
  const usedMasteryEffectIds = useMemo(
    () => new Set(Object.entries(currentMasteryEffects)
      .filter(([rawNodeId]) => allocated.has(Number(rawNodeId)))
      .map(([, effectId]) => Number(effectId))),
    [allocated, currentMasteryEffects],
  );
  const treeLinkUnsupported = tree?.game === "poe2"
    || secondaryAscendancyId > 0
    || Object.keys(currentMasteryEffects).length > 0
    || [...allocated].some((id) => id >= 0x10000);

  const commitAllocated = (
    next: Set<number>,
    label: string,
    masteryEffects: Record<number, number> = currentMasteryEffects,
    selection: TreeSelection = { classId, ascendancyId, secondaryAscendancyId },
  ) => {
    markPlannerChanged();
    setAllocated(next);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, nodes: [...next] } : spec));
    setHistory((current) => {
      const trimmed = current.slice(0, historyIndex + 1);
      return [...trimmed, { allocated: new Set(next), masteryEffects: { ...masteryEffects }, ...selection, label, at: Date.now() }].slice(-MAX_HISTORY);
    });
    setHistoryIndex((current) => Math.min(current + 1, MAX_HISTORY - 1));
    setEditedSinceImport(true);
  };

  const updateMasteryEffect = (nodeId: number, effectId: number | null) => {
    if (activeSpecId) {
      setSpecs((current) => current.map((spec) => {
        if (spec.id !== activeSpecId) return spec;
        const masteryEffects = { ...spec.masteryEffects };
        if (effectId == null) delete masteryEffects[nodeId];
        else masteryEffects[nodeId] = effectId;
        return { ...spec, masteryEffects };
      }));
    } else {
      setUnsavedMasteryEffects((current) => {
        const next = { ...current };
        if (effectId == null) delete next[nodeId];
        else next[nodeId] = effectId;
        return next;
      });
    }
  };

  const clearMasteryEffects = (nodeIds: ReadonlySet<number>) => {
    if (!nodeIds.size) return;
    if (activeSpecId) {
      setSpecs((current) => current.map((spec) => {
        if (spec.id !== activeSpecId) return spec;
        const masteryEffects = { ...spec.masteryEffects };
        for (const nodeId of nodeIds) delete masteryEffects[nodeId];
        return { ...spec, masteryEffects };
      }));
    } else {
      setUnsavedMasteryEffects((current) => {
        const next = { ...current };
        for (const nodeId of nodeIds) delete next[nodeId];
        return next;
      });
    }
  };

  const replaceMasteryEffects = (masteryEffects: Record<number, number>) => {
    if (activeSpecId) {
      setSpecs((current) => current.map((spec) => (
        spec.id === activeSpecId ? { ...spec, masteryEffects: { ...masteryEffects } } : spec
      )));
    } else {
      setUnsavedMasteryEffects({ ...masteryEffects });
    }
  };

  const openMasteryPicker = (node: PassiveTreeNodeData, knownPath?: number[]) => {
    if (!materializedTree || !node.mastery) return;
    const options = orderedMasteryEffects(node);
    if (!options.length) {
      setMessage("Path of Building did not provide mastery effects for this tree node.");
      return;
    }
    const usedElsewhere = new Set(Object.entries(currentMasteryEffects)
      .filter(([rawNodeId]) => Number(rawNodeId) !== node.id && allocated.has(Number(rawNodeId)))
      .map(([, effectId]) => Number(effectId)));
    if (!options.some(({ id }) => !usedElsewhere.has(id))) {
      setMessage(`Every ${node.name} effect is already allocated on another mastery.`);
      return;
    }
    const path = allocated.has(node.id) ? [] : knownPath || shortestAllocationPath(
      materializedTree,
      allocated,
      node.id,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    if (!allocated.has(node.id) && !path.length) {
      setMessage("That mastery is not connected to the current class/ascendancy tree.");
      return;
    }
    setMasteryPicker({ nodeId: node.id, path });
  };

  const chooseMasteryEffect = (effectId: number) => {
    if (!masteryPicker || !materializedTree) return;
    const node = materializedTree.nodes.find((entry) => entry.id === masteryPicker.nodeId);
    if (!node) return;
    const masteryEffects = { ...currentMasteryEffects, [node.id]: effectId };
    updateMasteryEffect(node.id, effectId);
    const next = allocated.has(node.id)
      ? new Set(allocated)
      : allocatePassivePath(materializedTree, allocated, masteryPicker.path, node.id);
    commitAllocated(next, `${allocated.has(node.id) ? "Changed" : "Allocated"} ${node.name} mastery`, masteryEffects);
    setMasteryPicker(null);
  };

  const activateVisibleAscendancy = (node: PassiveTreeNodeData) => {
    if (!tree || !materializedTree || !node.ascendancyName) return false;
    if (node.bloodline) {
      if (node.ascendancyName === secondaryAscendancyName) return false;
      const target = tree.alternateAscendancies?.find((entry) => entry.internalId === node.ascendancyName);
      if (!target) return true;
      let next = new Set([...allocated].filter((id) => !materializedNodeMap.get(id)?.bloodline));
      const start = materializedTree.nodes.find((entry) => entry.isAscendancyStart && entry.bloodline && entry.ascendancyName === target.internalId);
      if (start) next.add(start.id);
      const path = shortestAllocationPath(materializedTree, next, node.id, classId, currentAscendancy?.internalId, target.internalId, allocationContext);
      if (!next.has(node.id) && path.length) next = allocatePassivePath(materializedTree, next, path, node.id);
      setUnsavedSecondaryAscendancyId(target.id);
      commitAllocated(next, `Selected ${target.name}${path.length ? ` and allocated ${node.name}` : ""}`, currentMasteryEffects, { classId, ascendancyId, secondaryAscendancyId: target.id });
      setSpecs((current) => current.map((spec) => spec.id === activeSpecId
        ? { ...spec, secondaryAscendClassId: target.id, nodes: [...next] }
        : spec));
      return true;
    }

    let targetClass: PassiveTreeData["classes"][number] | undefined;
    let targetAscendancy: PassiveTreeData["classes"][number]["ascendancies"][number] | undefined;
    for (const candidateClass of tree.classes) {
      const candidateAscendancy = candidateClass.ascendancies.find((entry) => entry.internalId === node.ascendancyName);
      if (candidateAscendancy) {
        targetClass = candidateClass;
        targetAscendancy = candidateAscendancy;
        break;
      }
    }
    if (!targetClass || !targetAscendancy) return true;
    if (targetClass.id === classId && targetAscendancy.id === ascendancyId) return false;
    const crossClass = targetClass.id !== classId;
    if (crossClass && passiveCount > 0 && !isAllocatedClassConnected(materializedTree, allocated, classId, targetClass.id)) {
      setMessage(`Connect your allocated tree to the ${targetClass.name} start before switching without a reset. Use the Class selector if you intend to reset the tree.`);
      return true;
    }
    let next = new Set([...allocated].filter((id) => {
      const candidate = materializedNodeMap.get(id);
      if (candidate?.classStartIds.length) return false;
      return !candidate?.ascendancyName || Boolean(candidate.bloodline);
    }));
    next = withSelectedPassiveStarts(
      materializedTree,
      next,
      targetClass.id,
      targetAscendancy.id,
      secondaryAscendancyId,
    );
    const path = shortestAllocationPath(
      materializedTree,
      next,
      node.id,
      targetClass.id,
      targetAscendancy.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    if (!next.has(node.id) && path.length) next = allocatePassivePath(materializedTree, next, path, node.id);
    setClassId(targetClass.id);
    setAscendancyId(targetAscendancy.id);
    commitAllocated(next, `Switched to ${targetAscendancy.name}${path.length ? ` and allocated ${node.name}` : ""}`, currentMasteryEffects, { classId: targetClass.id, ascendancyId: targetAscendancy.id, secondaryAscendancyId });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId
      ? { ...spec, classId: targetClass.id, ascendClassId: targetAscendancy.id, nodes: [...next] }
      : spec));
    return true;
  };

  const allocate = (node: PassiveTreeNodeData, alternatePath?: readonly number[]) => {
    if (!materializedTree || allocated.has(node.id)) return;
    if (activateVisibleAscendancy(node)) return;
    const path = alternatePath?.length ? [...alternatePath] : shortestAllocationPath(
      materializedTree,
      allocated,
      node.id,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    if (!path.length) {
      setMessage("That node is not connected to the current class/ascendancy tree.");
      return;
    }
    if (node.mastery && !node.selectedMasteryEffect) {
      openMasteryPicker(node, path);
      return;
    }
    const next = allocatePassivePath(materializedTree, allocated, path, node.id);
    commitAllocated(next, `Allocated ${node.name}${path.length > 1 ? ` (+${path.length - 1} path)` : ""}`);
  };

  const refund = (node: PassiveTreeNodeData) => {
    if (!materializedTree || !allocated.has(node.id) || node.classStartIds.length > 0) return;
    const next = refundNodeAndDependents(
      materializedTree,
      allocated,
      node.id,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      allocationContext,
    );
    const removedMasteries = new Set([...allocated].filter((id) => (
      !next.has(id) && Boolean(materializedTree.nodes.find((entry) => entry.id === id)?.mastery)
    )));
    clearMasteryEffects(removedMasteries);
    const masteryEffects = { ...currentMasteryEffects };
    for (const id of removedMasteries) delete masteryEffects[id];
    commitAllocated(next, `Refunded ${node.name} and disconnected dependents`, masteryEffects);
  };

  const changeClass = (nextClassId: number) => {
    if (!tree) return;
    setClassId(nextClassId);
    setAscendancyId(0);
    setUnsavedSecondaryAscendancyId(0);
    const start = classStartNode(tree, nextClassId);
    const next = new Set(start ? [start.id] : []);
    setUnsavedMasteryEffects({});
    commitAllocated(next, `Changed class to ${tree.classes.find((entry) => entry.id === nextClassId)?.name}`, {}, { classId: nextClassId, ascendancyId: 0, secondaryAscendancyId: 0 });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: nextClassId, ascendClassId: 0, secondaryAscendClassId: 0, nodes: [...next], masteryEffects: {} } : spec));
  };

  const changeAscendancy = (nextAscendancyId: number) => {
    if (!tree) return;
    const next = new Set([...allocated].filter((id) => {
      const node = materializedNodeMap.get(id);
      return !node?.ascendancyName || Boolean(node.bloodline);
    }));
    const selectedAscendancy = currentClass?.ascendancies.find((entry) => entry.id === nextAscendancyId);
    if (selectedAscendancy) {
      const ascendancyStart = materializedTree?.nodes.find((node) => (
        node.isAscendancyStart && node.ascendancyName === selectedAscendancy.internalId
      ));
      if (ascendancyStart) next.add(ascendancyStart.id);
    }
    setAscendancyId(nextAscendancyId);
    commitAllocated(next, `Changed ascendancy to ${selectedAscendancy?.name || "None"}`, currentMasteryEffects, { classId, ascendancyId: nextAscendancyId, secondaryAscendancyId });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, ascendClassId: nextAscendancyId, nodes: [...next] } : spec));
  };

  const changeSecondaryAscendancy = (nextSecondaryId: number) => {
    if (!tree) return;
    const next = new Set([...allocated].filter((id) => !materializedNodeMap.get(id)?.bloodline));
    const selected = tree.alternateAscendancies?.find((entry) => entry.id === nextSecondaryId);
    if (selected) {
      const start = materializedTree?.nodes.find((node) => (
        node.isAscendancyStart && node.bloodline && node.ascendancyName === selected.internalId
      ));
      if (start) next.add(start.id);
    }
    setUnsavedSecondaryAscendancyId(nextSecondaryId);
    commitAllocated(next, `Changed bloodline to ${selected?.name || "None"}`, currentMasteryEffects, { classId, ascendancyId, secondaryAscendancyId: nextSecondaryId });
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId
      ? { ...spec, secondaryAscendClassId: nextSecondaryId, nodes: [...next] }
      : spec));
  };

  const applyBuild = (nextBuild: ImportedPobBuild, targetTree: PassiveTreeData | null = tree) => {
    if (!targetTree) return;
    markPlannerChanged();
    const nextSpecs = nextBuild.specs.map((spec) => {
      const randomized = { ...spec, id: `${spec.id}-${crypto.randomUUID()}` };
      return materializeImportedPassiveSpec(targetTree, randomized, nextBuild.items).spec;
    });
    const active = nextSpecs[Math.max(0, Math.min(nextSpecs.length - 1, nextBuild.activeSpec - 1))] || nextSpecs[0];
    const nextAllocated = normalizedSpecAllocation(
      targetTree,
      active,
      nextBuild.items,
      active.nodes,
      active.classId,
      active.ascendClassId,
      active.secondaryAscendClassId,
    );
    setTree(targetTree);
    setRealm(targetTree.game === "poe2" ? "poe2" : "pc");
    setBuild(nextBuild);
    setSpecs(nextSpecs);
    setActiveSpecId(active.id);
    setUnsavedMasteryEffects({});
    setUnsavedSecondaryAscendancyId(active.secondaryAscendClassId);
    setMasteryPicker(null);
    setClassId(active.classId);
    setAscendancyId(active.ascendClassId);
    setAllocated(nextAllocated);
    setHistory([{ allocated: new Set(nextAllocated), masteryEffects: { ...active.masteryEffects }, classId: active.classId, ascendancyId: active.ascendClassId, secondaryAscendancyId: active.secondaryAscendClassId, label: "Imported build", at: Date.now() }]);
    setHistoryIndex(0);
    setEditedSinceImport(false);
    setActiveSavedId("");
    setImportOpen(false);
    setMessage(`Imported level ${nextBuild.level} ${nextBuild.ascendancyName || nextBuild.className}: ${nextSpecs.length} tree spec, ${nextBuild.items.length} items, ${nextBuild.skillGroups.length} skill groups.`);
  };

  const importBuild = async (raw = importText, activeRequest?: PlannerAsyncRequestToken) => {
    if (!tree) return;
    if (!activeRequest) markPlannerChanged();
    const request = activeRequest || beginReplacement();
    setBusy(true);
    setMessage("");
    try {
      let value = raw.trim();
      if (/^https?:\/\//i.test(value)) value = await bridge.fetchToolkitText(resolveRemoteBuildUrl(value));
      if (value.startsWith("{")) {
        const workspace = sanitizePlannerSnapshot(JSON.parse(value));
        if (!workspace) {
          throw new Error("This JSON is not a Ninja Lens build workspace.");
        }
        const workspaceTree = tree.game === workspace.game && (!workspace.treeVersion || normalizedTreeVersion(tree.version) === normalizedTreeVersion(workspace.treeVersion))
          ? tree
          : await bridge.getPassiveTreeData({ game: workspace.game, treeVersion: workspace.treeVersion || undefined });
        if (!replacementCanApply(request, "the build workspace was loading")) return;
        const workspaceSpecs = workspace.specs.map((spec) => (
          materializeImportedPassiveSpec(workspaceTree, spec, workspace.build?.items || []).spec
        ));
        const workspaceSpec = workspaceSpecs.find((entry) => entry.id === workspace.activeSpecId) || null;
        const next = normalizedSpecAllocation(
          workspaceTree,
          workspaceSpec,
          workspace.build?.items || [],
          workspace.allocated,
          Number(workspace.classId) || 0,
          Number(workspace.ascendancyId) || 0,
          workspaceSpec?.secondaryAscendClassId || 0,
        );
        markPlannerChanged();
        setTree(workspaceTree);
        setRealm(workspaceTree.game === "poe2" ? "poe2" : "pc");
        setBuild(workspace.build ? { ...workspace.build, items: itemsWithPassiveSpecLoadout(workspace.build.items, workspaceSpec) } : null);
        setSpecs(workspaceSpecs);
        setActiveSpecId(workspace.activeSpecId || "");
        setUnsavedSecondaryAscendancyId(workspaceSpec?.secondaryAscendClassId || 0);
        setClassId(Number(workspace.classId) || 0);
        setAscendancyId(Number(workspace.ascendancyId) || 0);
        setAllocated(next);
        setEditedSinceImport(workspace.editedSinceImport);
        setActiveSavedId(workspace.id);
        setHistory([{ allocated: next, masteryEffects: { ...(workspaceSpec?.masteryEffects || {}) }, classId: Number(workspace.classId) || 0, ascendancyId: Number(workspace.ascendancyId) || 0, secondaryAscendancyId: workspaceSpec?.secondaryAscendClassId || 0, label: "Opened workspace", at: Date.now() }]);
        setHistoryIndex(0);
        setImportOpen(false);
        setMessage("Ninja Lens build workspace opened.");
        return;
      }
      const xml = await bridge.decodePobBuild(value);
      const parsed = parsePobXml(xml);
      const importedSpec = parsed.specs[Math.max(0, Math.min(parsed.specs.length - 1, parsed.activeSpec - 1))] || parsed.specs[0];
      const requestedVersion = importedSpec?.treeVersion.trim();
      const requestedGame = requestedVersion ? (/^0_/.test(requestedVersion) ? "poe2" : "poe1") : tree.game;
      const targetTree = requestedVersion && (normalizedTreeVersion(tree.version) !== normalizedTreeVersion(requestedVersion) || tree.game !== requestedGame)
        ? await bridge.getPassiveTreeData({ game: requestedGame, treeVersion: requestedVersion })
        : tree;
      if (!replacementCanApply(request, "the Path of Building import was loading")) return;
      applyBuild(parsed, targetTree);
      setImportText("");
    } catch (error) {
      reportReplacementError(request, "the build import was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const openBuild = async () => {
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    try {
      const opened = await bridge.openToolkitText("build");
      if (!replacementCanApply(request, "the build file picker was open")) return;
      if (opened) await importBuild(opened.text, request);
    } catch (error) {
      reportReplacementError(request, "the build file picker was open", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const clipboardBuild = async () => {
    setImportText(await bridge.readPlannerClipboard());
    setImportOpen(true);
  };

  const characterRequest = (character?: string): PoeCharacterImportRequest => ({
    mode: characterMode,
    realm,
    accountName: characterMode === "public" ? accountName.trim() : undefined,
    accessToken: characterMode === "oauth" ? accessToken.trim() : undefined,
    character,
  });

  const loadCharacters = async () => {
    if (tree?.game === "poe2") {
      setMessage("Exact PoE 2 account import is disabled until a verified PoB2 importer can preserve skills, all weapon-set specialisations, and quest rewards. Import a PoB2 code or XML instead.");
      return;
    }
    const request = beginReplacement();
    setBusy(true);
    setMessage("");
    try {
      const result = await bridge.listPoeCharacters(characterRequest());
      if (!asyncGuardRef.current.isLatest(request)) return;
      setCharacters(result);
      setSelectedCharacter(result[0]?.name || "");
      setMessage(`${result.length} character${result.length === 1 ? "" : "s"} available to import.`);
    } catch (error) {
      if (asyncGuardRef.current.isLatest(request)) setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const loadCharacter = async () => {
    if (!selectedCharacter || !tree) return;
    if (tree.game === "poe2") {
      setMessage("Exact PoE 2 account import is disabled until a verified PoB2 importer can preserve skills, all weapon-set specialisations, and quest rewards. Import a PoB2 code or XML instead.");
      return;
    }
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    setMessage("");
    try {
      const character = await bridge.getPoeCharacter(characterRequest(selectedCharacter));
      const imported = await bridge.importPobCharacter({ character });
      if (!imported.ok) {
        throw new Error(`${imported.message}${imported.detail ? ` ${imported.detail}` : ""}`);
      }
      const parsed = parsePobXml(imported.xml);
      const importedSpec = parsed.specs[Math.max(0, Math.min(parsed.specs.length - 1, parsed.activeSpec - 1))] || parsed.specs[0];
      if (!importedSpec?.treeVersion) throw new Error("Path of Building returned no passive-tree version for this character.");
      const targetTree = await bridge.getPassiveTreeData({ game: "poe1", treeVersion: importedSpec.treeVersion });
      if (!replacementCanApply(request, "the character import was loading")) return;
      const importedBuild: ImportedPobBuild = {
        ...parsed,
        config: {
          ...parsed.config,
          league: String(character.league || parsed.config.league || ""),
          realm: String(character.realm || parsed.config.realm || realm || "pc"),
        },
        statSource: "pob-engine",
        notes: parsed.notes || `Imported through Path of Building ${imported.engine.version} from the official Path of Exile character API.`,
      };
      applyBuild(importedBuild, targetTree);
      setAccessToken("");
    } catch (error) {
      reportReplacementError(request, "the character import was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const undo = () => {
    if (historyIndex <= 0) return;
    markPlannerChanged();
    const index = historyIndex - 1;
    const next = new Set(history[index].allocated);
    setHistoryIndex(index);
    setAllocated(next);
    setClassId(history[index].classId);
    setAscendancyId(history[index].ascendancyId);
    setUnsavedSecondaryAscendancyId(history[index].secondaryAscendancyId);
    replaceMasteryEffects(history[index].masteryEffects);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: history[index].classId, ascendClassId: history[index].ascendancyId, secondaryAscendClassId: history[index].secondaryAscendancyId, nodes: [...next] } : spec));
    setEditedSinceImport(true);
  };

  const redo = () => {
    if (historyIndex >= history.length - 1) return;
    markPlannerChanged();
    const index = historyIndex + 1;
    const next = new Set(history[index].allocated);
    setHistoryIndex(index);
    setAllocated(next);
    setClassId(history[index].classId);
    setAscendancyId(history[index].ascendancyId);
    setUnsavedSecondaryAscendancyId(history[index].secondaryAscendancyId);
    replaceMasteryEffects(history[index].masteryEffects);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: history[index].classId, ascendClassId: history[index].ascendancyId, secondaryAscendClassId: history[index].secondaryAscendancyId, nodes: [...next] } : spec));
    setEditedSinceImport(true);
  };

  const restoreHistory = (index: number) => {
    const entry = history[index];
    if (!entry) return;
    markPlannerChanged();
    const next = new Set(entry.allocated);
    setAllocated(next);
    setClassId(entry.classId);
    setAscendancyId(entry.ascendancyId);
    setUnsavedSecondaryAscendancyId(entry.secondaryAscendancyId);
    replaceMasteryEffects(entry.masteryEffects);
    setHistoryIndex(index);
    setSpecs((current) => current.map((spec) => spec.id === activeSpecId ? { ...spec, classId: entry.classId, ascendClassId: entry.ascendancyId, secondaryAscendClassId: entry.secondaryAscendancyId, nodes: [...next] } : spec));
    setEditedSinceImport(true);
  };

  const selectSpec = async (id: string) => {
    const spec = specs.find((entry) => entry.id === id);
    if (!spec || !tree) return;
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    try {
      let targetTree = tree;
      const requestedVersion = spec.treeVersion.trim();
      const requestedGame = requestedVersion ? (/^0_/.test(requestedVersion) ? "poe2" : "poe1") : tree.game;
      if (requestedVersion && (normalizedTreeVersion(tree.version) !== normalizedTreeVersion(requestedVersion) || tree.game !== requestedGame)) {
        targetTree = await bridge.getPassiveTreeData({ game: requestedGame, treeVersion: requestedVersion });
      }
      if (!replacementCanApply(request, "the passive-tree spec was loading")) return;
      const next = normalizedSpecAllocation(
        targetTree,
        spec,
        build?.items || [],
        spec.nodes,
        spec.classId,
        spec.ascendClassId,
        spec.secondaryAscendClassId,
      );
      markPlannerChanged();
      if (targetTree !== tree) {
        setTree(targetTree);
        setRealm(targetTree.game === "poe2" ? "poe2" : "pc");
      }
      setActiveSpecId(id);
      setBuild((current) => current ? { ...current, items: itemsWithPassiveSpecLoadout(current.items, spec) } : current);
      setMasteryPicker(null);
      setHover(null);
      setTraceMode(false);
      setTracePath([]);
      setUnsavedSecondaryAscendancyId(spec.secondaryAscendClassId);
      setClassId(spec.classId);
      setAscendancyId(spec.ascendClassId);
      setAllocated(next);
      setSpecs((current) => current.map((entry) => entry.id === id ? { ...entry, nodes: [...next] } : entry));
      setHistory([{ allocated: next, masteryEffects: { ...spec.masteryEffects }, classId: spec.classId, ascendancyId: spec.ascendClassId, secondaryAscendancyId: spec.secondaryAscendClassId, label: `Opened ${spec.title}`, at: Date.now() }]);
      setHistoryIndex(0);
      setEditedSinceImport(true);
    } catch (error) {
      reportReplacementError(request, "the passive-tree spec was loading", error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const addSpec = () => {
    markPlannerChanged();
    const spec: ImportedPassiveSpec = {
      ...(activePassiveSpec || {} as ImportedPassiveSpec),
      id: `spec-${crypto.randomUUID()}`,
      title: `Tree ${specs.length + 1}`,
      treeVersion: tree?.version || "",
      classId,
      ascendClassId: ascendancyId,
      secondaryAscendClassId: secondaryAscendancyId,
      nodes: [...allocated],
      masteryEffects: { ...(activePassiveSpec?.masteryEffects || unsavedMasteryEffects) },
    };
    setSpecs((current) => [...current, spec]);
    setActiveSpecId(spec.id);
    setEditedSinceImport(true);
  };

  const copyTreeUrl = async () => {
    if (!tree || treeLinkUnsupported) {
      setMessage("Use Copy PoB for mastery, cluster-jewel, bloodline, or PoE 2 trees; the official compact tree URL cannot preserve those sections safely.");
      return;
    }
    const url = officialTreeUrl(tree, allocated, classId, ascendancyId, secondaryAscendancyId);
    await navigator.clipboard.writeText(url);
    setMessage("Official Path of Exile passive-tree URL copied.");
  };

  const persistedSpecs = () => specs.length ? specs : [{
    id: "current",
    title: "Current tree",
    treeVersion: tree?.version || "",
    classId,
    ascendClassId: ascendancyId,
    secondaryAscendClassId: secondaryAscendancyId,
    nodes: [...allocated],
    masteryEffects: { ...unsavedMasteryEffects },
  } satisfies ImportedPassiveSpec];

  const buildWithCurrentIdentity = (source: ImportedPobBuild) => ({
    ...source,
    className: currentClass?.name || source.className,
    ascendancyName: currentAscendancy?.name || "",
  });

  const saveWorkspace = async () => {
    if (!tree) return;
    const effectiveSpecs = persistedSpecs();
    const snapshot = createPlannerSnapshot({
      id: activeSavedId || undefined,
      game: tree.game,
      treeVersion: tree.version,
      build: build ? buildWithCurrentIdentity(build) : null,
      specs: effectiveSpecs,
      activeSpecId: activeSpecId || effectiveSpecs[0].id,
      classId,
      ascendancyId,
      allocated,
      editedSinceImport,
    });
    const text = JSON.stringify(snapshot, null, 2);
    const saved = await bridge.saveToolkitText({
      text,
      suggestedName: `${build?.className || currentClass?.name || "character"}-ninja-lens.json`,
      kind: "build",
    });
    if (saved) setMessage(`Saved ${saved.name}.`);
  };

  const editBuild = (nextBuild: ImportedPobBuild) => {
    markPlannerChanged();
    setBuild(nextBuild);
    setEditedSinceImport(true);
    if (!tree || !materializationSpec || !specs.length) return;

    const loadoutSpecs = specsWithActiveJewelLoadout(nextBuild, specs, activeSpecId);
    const loadoutSpec = loadoutSpecs.find((spec) => spec.id === activeSpecId) || loadoutSpecs[0];
    if (!loadoutSpec) {
      setSpecs(loadoutSpecs);
      return;
    }
    const nextTree = materializeImportedPassiveTree(tree, loadoutSpec, nextBuild.items).tree;
    const nextContext = buildPassiveAllocationContext(nextTree, loadoutSpec, nextBuild.items);
    const nextAllocated = retainConnectedAllocatedPassives(
      nextTree,
      allocated,
      classId,
      currentAscendancy?.internalId,
      secondaryAscendancyName,
      nextContext,
    );
    const nextNodeMap = new Map(nextTree.nodes.map((node) => [node.id, node]));
    const nextMasteryEffects = Object.fromEntries(Object.entries(loadoutSpec.masteryEffects)
      .filter(([rawNodeId, rawEffectId]) => {
        const node = nextNodeMap.get(Number(rawNodeId));
        if (!node?.mastery || !nextAllocated.has(Number(rawNodeId))) return false;
        return orderedMasteryEffects(node).some(({ id }) => id === Number(rawEffectId));
      })
      .map(([rawNodeId, rawEffectId]) => [Number(rawNodeId), Number(rawEffectId)]));
    const allocationChanged = nextAllocated.size !== allocated.size
      || [...nextAllocated].some((id) => !allocated.has(id));
    const masteryChanged = Object.keys(nextMasteryEffects).length !== Object.keys(loadoutSpec.masteryEffects).length
      || Object.entries(nextMasteryEffects).some(([nodeId, effectId]) => loadoutSpec.masteryEffects[Number(nodeId)] !== effectId);
    const nextSpecs = loadoutSpecs.map((spec) => spec.id === loadoutSpec.id
      ? { ...spec, nodes: [...nextAllocated], masteryEffects: nextMasteryEffects }
      : spec);
    setSpecs(nextSpecs);
    if (!allocationChanged && !masteryChanged) return;
    setAllocated(nextAllocated);
    setMasteryPicker(null);
    setHover(null);
    setHistory((current) => {
      return current.map((entry) => {
        const entryClass = tree.classes.find((candidate) => candidate.id === entry.classId);
        const entryAscendancyName = entryClass?.ascendancies.find((candidate) => candidate.id === entry.ascendancyId)?.internalId;
        const entrySecondaryName = tree.alternateAscendancies?.find((candidate) => candidate.id === entry.secondaryAscendancyId)?.internalId;
        const entryAllocated = retainConnectedAllocatedPassives(
          nextTree,
          entry.allocated,
          entry.classId,
          entryAscendancyName,
          entrySecondaryName,
          nextContext,
        );
        const masteryEffects = Object.fromEntries(Object.entries(entry.masteryEffects).filter(([rawNodeId, rawEffectId]) => {
          const node = nextNodeMap.get(Number(rawNodeId));
          if (!node?.mastery || !entryAllocated.has(Number(rawNodeId))) return false;
          return orderedMasteryEffects(node).some(({ id }) => id === Number(rawEffectId));
        }));
        return { ...entry, allocated: entryAllocated, masteryEffects };
      });
    });
    if (allocationChanged) {
      const removed = Math.max(0, allocated.size - nextAllocated.size);
      setMessage(`Jewel loadout updated. Refunded ${removed} passive${removed === 1 ? "" : "s"} that no longer had a legal Path of Building dependency.`);
    } else if (masteryChanged) {
      setMessage("Jewel loadout updated. Removed mastery choices that are no longer available on the active tree.");
    }
  };

  const editNotes = (notes: string) => {
    markPlannerChanged();
    setBuild((current) => ({ ...(current || emptyPobBuild(currentClass?.name || "Scion")), notes }));
  };

  const currentSnapshot = (name?: string, tags: string[] = [], id = activeSavedId || undefined) => {
    if (!tree) return null;
    const existing = savedBuilds.find((entry) => entry.id === id);
    const effectiveSpecs = persistedSpecs();
    return createPlannerSnapshot({
      id,
      name: name || existing?.name,
      tags: tags.length ? tags : existing?.tags,
      game: tree.game,
      treeVersion: tree.version,
      build: build ? buildWithCurrentIdentity(build) : null,
      specs: effectiveSpecs,
      activeSpecId: activeSpecId || effectiveSpecs[0].id,
      classId,
      ascendancyId,
      allocated,
      editedSinceImport,
      createdAt: existing?.createdAt,
    });
  };

  const persistSavedBuilds = (next: PlannerWorkspaceSnapshot[]) => {
    if (savedLibraryError) {
      setTab("builds");
      setMessage("The local build library is locked. Save an exact recovery copy and reset it before making library changes.");
      return false;
    }
    try {
      parseSavedPlannerBuilds(localStorage.getItem(SAVED_PLANNER_BUILDS_KEY));
      const serialized = serializeSavedPlannerBuilds(next);
      localStorage.setItem(SAVED_PLANNER_BUILDS_KEY, serialized);
      setSavedBuilds(next);
      return true;
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      try {
        parseSavedPlannerBuilds(localStorage.getItem(SAVED_PLANNER_BUILDS_KEY));
      } catch {
        setSavedLibraryError(detail);
        setTab("builds");
      }
      setMessage(`The local build library was not changed: ${detail}`);
      return false;
    }
  };

  const recoverSavedLibrary = async () => {
    setRecoveringSavedLibrary(true);
    try {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const result = await recoverSavedPlannerLibrary({
        storage: localStorage,
        saveRecoveryCopy: (original) => bridge.saveToolkitText({
          text: original,
          suggestedName: `Ninja-Lens-build-library-recovery-${timestamp}.txt`,
          kind: "text",
        }),
      });
      if (result.status === "cancelled") {
        setMessage("Recovery was cancelled. The original local build library is still locked and unchanged.");
        return;
      }
      setSavedLibraryError("");
      setSavedBuilds([]);
      setActiveSavedId("");
      setBaselineId("");
      setMessage(result.status === "missing"
        ? "The local build library no longer contains damaged data and is ready to use."
        : `Saved the exact recovery copy as ${result.backupName} and reset the local build library.`);
    } catch (error) {
      setMessage(`The local build library was not reset: ${error instanceof Error ? error.message : String(error)} Its original data remains unchanged.`);
    } finally {
      setRecoveringSavedLibrary(false);
    }
  };

  const saveToLibrary = (name: string, tags: string[]) => {
    const snapshot = currentSnapshot(name, tags);
    if (!snapshot) return;
    if (!persistSavedBuilds(upsertSavedPlannerBuild(savedBuilds, snapshot))) return;
    setActiveSavedId(snapshot.id);
    setMessage(`Saved ${snapshot.name} to the local build library.`);
  };

  const loadSnapshot = async (snapshot: PlannerWorkspaceSnapshot) => {
    markPlannerChanged();
    const request = beginReplacement();
    setBusy(true);
    try {
      let targetTree = tree;
      if (!targetTree || targetTree.game !== snapshot.game || (snapshot.treeVersion && normalizedTreeVersion(targetTree.version) !== normalizedTreeVersion(snapshot.treeVersion))) {
        targetTree = await bridge.getPassiveTreeData({ game: snapshot.game, treeVersion: snapshot.treeVersion || undefined });
      }
      if (!replacementCanApply(request, `the ${snapshot.name} workspace was loading`)) return;
      const snapshotSpecs = snapshot.specs.map((spec) => (
        materializeImportedPassiveSpec(targetTree, spec, snapshot.build?.items || []).spec
      ));
      const snapshotSpec = snapshotSpecs.find((entry) => entry.id === snapshot.activeSpecId) || null;
      const next = normalizedSpecAllocation(
        targetTree,
        snapshotSpec,
        snapshot.build?.items || [],
        snapshot.allocated,
        snapshot.classId,
        snapshot.ascendancyId,
        snapshotSpec?.secondaryAscendClassId || 0,
      );
      markPlannerChanged();
      setTree(targetTree);
      setRealm(targetTree.game === "poe2" ? "poe2" : "pc");
      setBuild(snapshot.build ? { ...snapshot.build, items: itemsWithPassiveSpecLoadout(snapshot.build.items, snapshotSpec) } : null);
      setSpecs(snapshotSpecs);
      setActiveSpecId(snapshot.activeSpecId);
      setUnsavedSecondaryAscendancyId(snapshotSpec?.secondaryAscendClassId || 0);
      setClassId(snapshot.classId);
      setAscendancyId(snapshot.ascendancyId);
      setAllocated(next);
      setHistory([{ allocated: next, masteryEffects: { ...(snapshotSpec?.masteryEffects || {}) }, classId: snapshot.classId, ascendancyId: snapshot.ascendancyId, secondaryAscendancyId: snapshotSpec?.secondaryAscendClassId || 0, label: `Opened ${snapshot.name}`, at: Date.now() }]);
      setHistoryIndex(0);
      setEditedSinceImport(snapshot.editedSinceImport);
      setActiveSavedId(snapshot.id);
      setMessage(`Opened ${snapshot.name}.`);
    } catch (error) {
      reportReplacementError(request, `the ${snapshot.name} workspace was loading`, error);
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setBusy(false);
    }
  };

  const duplicateSnapshot = (snapshot: PlannerWorkspaceSnapshot) => {
    const duplicate = createPlannerSnapshot({ ...snapshot, id: undefined, name: `${snapshot.name} copy`, allocated: snapshot.allocated, now: Date.now() });
    if (persistSavedBuilds(upsertSavedPlannerBuild(savedBuilds, duplicate))) {
      setMessage(`Duplicated ${snapshot.name}.`);
    }
  };

  const exportSnapshot = async (snapshot: PlannerWorkspaceSnapshot) => {
    const saved = await bridge.saveToolkitText({ text: JSON.stringify(snapshot, null, 2), suggestedName: `${snapshot.name.replace(/[^a-z0-9_-]+/gi, "-") || "build"}.json`, kind: "build" });
    if (saved) setMessage(`Exported ${saved.name}.`);
  };

  const copyPobCode = async () => {
    if (!tree) return;
    const effectiveBuild = buildWithCurrentIdentity(build || emptyPobBuild(currentClass?.name || "Scion"));
    const sourceSpecs = persistedSpecs();
    // Official character payloads use opaque hashes_ex. Materialize again at
    // the export boundary so Copy PoB is lossless even before any user edit.
    const effectiveSpecs = sourceSpecs.map((spec) => materializeImportedPassiveSpec(tree, spec, effectiveBuild.items).spec);
    const xml = serializePobXml(effectiveBuild, effectiveSpecs, activeSpecId || effectiveSpecs[0].id);
    const code = await bridge.encodePobBuild(xml);
    await navigator.clipboard.writeText(code);
    setMessage("Path of Building import code copied. PoB will recalculate outputs after import.");
  };

  const recalculateWithPob = async () => {
    if (!tree || tree.game !== "poe1") return;
    const request = asyncGuardRef.current.begin("calculation");
    const sourceIdentity = plannerIdentityRef.current;
    let changedMessageShown = false;
    const requestStatus = () => {
      const status = asyncGuardRef.current.inspect(request);
      if (status === "superseded") return status;
      const currentIdentity = plannerIdentityRef.current;
      const identityChanged = currentIdentity.build !== sourceIdentity.build
        || currentIdentity.specs !== sourceIdentity.specs
        || currentIdentity.activeSpecId !== sourceIdentity.activeSpecId
        || currentIdentity.tree !== sourceIdentity.tree;
      if (status === "changed" || identityChanged) {
        if (!changedMessageShown) {
          changedMessageShown = true;
          setMessage("The build changed while Path of Building was calculating; the current edits were kept. Recalculate again for fresh outputs.");
        }
        return "changed" as const;
      }
      return "current" as const;
    };
    const effectiveBuild = buildWithCurrentIdentity(build || emptyPobBuild(currentClass?.name || "Scion"));
    const sourceSpecs = persistedSpecs();
    const effectiveSpecs = sourceSpecs.map((spec) => materializeImportedPassiveSpec(tree, spec, effectiveBuild.items).spec);
    const effectiveActiveSpecId = activeSpecId || effectiveSpecs[0]?.id || "";
    const xml = serializePobXml(effectiveBuild, effectiveSpecs, effectiveActiveSpecId);
    setCalculating(true);
    setMessage("Calculating the current build in an isolated local Path of Building process…");
    try {
      const result = await bridge.calculatePobBuild({
        xml,
        name: `${effectiveBuild.ascendancyName || effectiveBuild.className || "Character"} · Ninja Lens`,
      });
      if (requestStatus() !== "current") return;
      if (!result.ok) {
        const diagnostic = await bridge.diagnosePobEngine();
        if (requestStatus() !== "current") return;
        setMessage(`${result.message}${result.detail ? ` ${result.detail}` : ""}`);
        setEngineCapability(diagnostic);
        return;
      }
      const playerStats = Object.entries(result.calculation.stats)
        .filter((entry): entry is [string, number] => typeof entry[1] === "number" && Number.isFinite(entry[1]))
        .map(([name, value]) => ({
          name,
          label: pobStatLabel(name),
          value,
          category: pobStatCategory(name),
          percent: pobStatPercent(name),
        }));
      markPlannerChanged();
      setBuild({
        ...effectiveBuild,
        xml,
        className: result.calculation.className || effectiveBuild.className,
        ascendancyName: result.calculation.ascendancyName && result.calculation.ascendancyName !== "None"
          ? result.calculation.ascendancyName
          : effectiveBuild.ascendancyName,
        specs: effectiveSpecs,
        playerStats,
        statSource: "pob-engine",
      });
      setSpecs(effectiveSpecs);
      if (!activeSpecId && effectiveActiveSpecId) setActiveSpecId(effectiveActiveSpecId);
      setEditedSinceImport(false);
      const warnings = result.calculation.warnings.length
        ? ` ${result.calculation.warnings.length} PoB warning${result.calculation.warnings.length === 1 ? "" : "s"} reported.`
        : "";
      setMessage(`Calculated ${playerStats.length} numeric outputs with Path of Building ${result.engine.version} in ${(result.durationMilliseconds / 1000).toFixed(2)}s.${warnings}`);
    } catch (error) {
      if (requestStatus() === "current") setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (asyncGuardRef.current.isLatest(request)) setCalculating(false);
    }
  };

  const baseline = savedBuilds.find((entry) => entry.id === baselineId) || null;
  const comparison = baseline ? comparePlannerBuilds({ build, allocated: [...allocated] }, baseline) : null;

  if (busy && !tree) return <div className="planner-loading"><LoaderCircle className="is-spinning" /><strong>Loading authoritative Path of Building tree…</strong></div>;
  if (!tree) return <div className="toolkit-empty"><Network size={34} /><h2>Passive tree unavailable</h2><p>{message}</p></div>;

  return (
    <section className="planner-shell" data-game={tree.game}>
      <header className="planner-header">
        <div className="planner-title"><Network size={20} /><span><small>BUILD LAB · {tree.game === "poe2" ? "POE 2" : "POE 1"} · POB {tree.version.replace("_", ".")}</small><strong>{build ? `${currentAscendancy?.name || currentClass?.name || build.className} · Level ${build.level}` : "New character"}</strong></span></div>
        <div className="planner-actions">
          <button type="button" onClick={undo} disabled={historyIndex <= 0}><ArrowLeft size={14} /> Undo</button>
          <button type="button" onClick={redo} disabled={historyIndex >= history.length - 1}>Redo <ArrowRight size={14} /></button>
          <button type="button" onClick={copyTreeUrl} disabled={treeLinkUnsupported} title={treeLinkUnsupported ? "Use Copy PoB so mastery, cluster-jewel, bloodline, or PoE 2 data is not lost." : "Copy official passive-tree URL"}><Copy size={14} /> Tree link</button>
          <button type="button" onClick={recalculateWithPob} disabled={calculating || tree.game !== "poe1" || engineCapability?.ok !== true} title={tree.game !== "poe1" ? "The verified local calculation bridge currently supports Path of Building Community for PoE 1." : engineCapability?.ok ? `Run a fresh read-only Path of Building ${engineCapability.engine.number} calculation.` : engineCapability?.message || "Checking the local Path of Building engine…"}>{calculating ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCw size={14} />} Recalculate in PoB</button>
          <button type="button" onClick={copyPobCode}><Clipboard size={14} /> Copy PoB</button>
          <button type="button" onClick={saveWorkspace}><Save size={14} /> Save</button>
          <button type="button" onClick={openBuild}><FolderOpen size={14} /> Open</button>
          <button type="button" className="is-primary" onClick={() => { if (tree.game === "poe2") setImportMode("pob"); setImportOpen(true); }}><Upload size={14} /> {tree.game === "poe2" ? "Import PoB2" : "Import character / PoB"}</button>
        </div>
      </header>
      {message && <div className="planner-message"><span>{message}</span><button type="button" aria-label="Dismiss planner message" onClick={() => setMessage("")}><X size={13} /></button></div>}
      <div className="planner-controls">
        <label>Game<select value={tree.game} disabled={busy} onChange={(event) => { void changeGame(event.target.value as "poe1" | "poe2"); }}><option value="poe1">PoE 1</option><option value="poe2">PoE 2</option></select></label>
        <label>Class<select value={classId} onChange={(event) => changeClass(Number(event.target.value))}>{tree.classes.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        <label>Ascendancy<select value={ascendancyId} onChange={(event) => changeAscendancy(Number(event.target.value))}><option value={0}>None</option>{currentClass?.ascendancies.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
        {Boolean(tree.alternateAscendancies?.length) && <label>Bloodline<select value={secondaryAscendancyId} onChange={(event) => changeSecondaryAscendancy(Number(event.target.value))}><option value={0}>None</option>{tree.alternateAscendancies?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
        <label className="planner-spec">Tree spec<select value={activeSpecId} onChange={(event) => { void selectSpec(event.target.value); }}><option value="">Unsaved tree</option>{specs.map((spec) => <option key={spec.id} value={spec.id}>{spec.title}</option>)}</select><button type="button" aria-label="Duplicate as new tree spec" onClick={addSpec} title="Duplicate as new tree spec"><Plus size={13} /></button></label>
        <label className="planner-search"><Search size={14} /><input aria-label="Search passive tree" value={query} onChange={(event) => setQuery(event.target.value)} placeholder='Search stats, "exact phrase", mastery, #node' /><small>{searchResults.length || ""}</small></label>
        <div className="planner-points"><strong>{passiveCount}</strong><span>/ {tree.points.total} passive · {ascendancyCount}/{tree.points.ascendancy} ascend{secondaryAscendancyName ? ` · ${secondaryAscendancyCount}/${tree.points.ascendancy} bloodline` : ""}</span></div>
      </div>
      <nav className="planner-tabs" aria-label="Build planner sections" role="tablist">
        {(["tree", "items", "skills", "config", "calcs", "galaxy", "builds", "notes", "history"] as PlannerTab[]).map((value) => <button type="button" role="tab" aria-selected={tab === value} key={value} className={tab === value ? "is-active" : ""} onClick={() => setTab(value)}>{value}</button>)}
      </nav>

      <div className="planner-body">
        {tab === "tree" && (
          <div className="passive-tree-stage">
            {materializedTree
              ? <PassiveTreeCanvas tree={materializedTree} allocated={allocated} previewed={previewed} refundPreview={hoverDependents} highlighted={highlighted} hoveredId={hoverNodeId} classId={classId} ascendancyName={currentAscendancy?.internalId || ""} secondaryAscendancyName={secondaryAscendancyName} onAllocate={(node) => allocate(node, traceMode && tracePath[tracePath.length - 1] === node.id ? tracePath : undefined)} onRefund={refund} onMastery={openMasteryPicker} onHover={(node, point) => setHover(node && point ? { node, ...point } : null)} />
              : <div className="planner-loading"><LoaderCircle className="is-spinning" /><strong>Loading the matching PoB {activePassiveSpec?.treeVersion} tree…</strong></div>}
            <div className={`tree-help${traceMode ? " is-tracing" : ""}`}>{traceMode ? `Shift trace · ${tracePath.length} node${tracePath.length === 1 ? "" : "s"} · hover adjacent passives, then click the final node` : "Drag to pan · wheel to zoom · double-click resets view · hold Shift to trace a custom path · left-click allocates or refunds · right-click changes an allocated mastery"}</div>
            {hover && <PassiveNodeTooltip hover={hover} allocated={allocated.has(hover.node.id)} previewPath={displayedPreviewPath} dependents={hoverDependents} socketedItem={hoverSocketedItem} usedMasteryEffects={usedMasteryEffectIds} radiusSummary={hoverRadiusSummary} selectedAscendancyName={currentAscendancy?.internalId || ""} selectedSecondaryName={secondaryAscendancyName} />}
            {masteryPicker && materializedTree && (() => {
              const node = materializedTree.nodes.find((entry) => entry.id === masteryPicker.nodeId);
              if (!node) return null;
              const usedElsewhere = new Set(Object.entries(currentMasteryEffects)
                .filter(([rawNodeId]) => Number(rawNodeId) !== node.id && allocated.has(Number(rawNodeId)))
                .map(([, effectId]) => Number(effectId)));
              const options = orderedMasteryEffects(node)
                .filter(({ id }) => !usedElsewhere.has(id));
              return (
                <div className="mastery-picker-scrim" onMouseDown={(event) => event.target === event.currentTarget && setMasteryPicker(null)}>
                  <section className="mastery-picker" role="dialog" aria-modal="true" aria-labelledby="planner-mastery-title">
                    <header><span><Network size={16} /><strong id="planner-mastery-title">{node.name}</strong></span><button type="button" aria-label="Close mastery choices" onClick={() => setMasteryPicker(null)}><X size={15} /></button></header>
                    <p>{allocated.has(node.id) ? "Choose a replacement effect." : `Choose an effect to allocate this mastery${masteryPicker.path.length > 1 ? ` and ${masteryPicker.path.length - 1} leading passives` : ""}.`} {options.length}/{orderedMasteryEffects(node).length} effects available; PoB allows each effect only once.</p>
                    <div>{options.map(({ id: effectId, effect }, optionIndex) => {
                      return <button type="button" autoFocus={optionIndex === 0} key={effectId} className={node.selectedMasteryEffect === effectId ? "is-selected" : ""} onClick={() => chooseMasteryEffect(effectId)}><b>{effect.stats.join(" · ") || "Mastery effect"}</b>{effect.reminderText.map((line, index) => <small key={`${index}-${line}`}>{line}</small>)}</button>;
                    })}</div>
                  </section>
                </div>
              );
            })()}
          </div>
        )}
        {tab === "items" && <PlannerItemsPanel build={build} onChange={editBuild} />}
        {tab === "skills" && <PlannerSkillsPanel build={build} onChange={editBuild} />}
        {tab === "config" && <PlannerConfigPanel build={build} onChange={editBuild} />}
        {tab === "calcs" && <PlannerCalcsPanel build={build} editedSinceImport={editedSinceImport} comparison={comparison} />}
        {tab === "galaxy" && <PlannerGalaxyPanel build={build} />}
        {tab === "builds" && <PlannerBuildsPanel builds={savedBuilds} activeId={activeSavedId} baselineId={baselineId} libraryError={savedLibraryError} recoveringLibrary={recoveringSavedLibrary} onRecoverLibrary={recoverSavedLibrary} onSave={saveToLibrary} onLoad={loadSnapshot} onDelete={(id) => { if (!persistSavedBuilds(savedBuilds.filter((entry) => entry.id !== id))) return; if (activeSavedId === id) setActiveSavedId(""); if (baselineId === id) setBaselineId(""); }} onDuplicate={duplicateSnapshot} onBaseline={setBaselineId} onExport={exportSnapshot} />}
        {tab === "notes" && <div className="planner-notes"><textarea aria-label="Build notes" value={build?.notes || ""} placeholder="Build notes, campaign reminders, gearing steps…" onChange={(event) => editNotes(event.target.value)} /></div>}
        {tab === "history" && <div className="planner-history"><header><History size={16} /><strong>Tree timeline</strong><button type="button" onClick={() => { const initial = history[0]; if (initial) { restoreHistory(0); setHistory([initial]); } }}><RotateCcw size={13} /> Reset to start</button></header>{[...history].reverse().map((entry, reverseIndex) => { const index = history.length - reverseIndex - 1; return <button type="button" key={`${entry.at}-${index}`} className={index === historyIndex ? "is-active" : ""} onClick={() => restoreHistory(index)}><span>{entry.label}</span><small>{historyPointLabel(entry)} · {new Date(entry.at).toLocaleTimeString()}</small></button>; })}</div>}
      </div>

      {importOpen && <div className="planner-import-scrim" onMouseDown={(event) => event.target === event.currentTarget && setImportOpen(false)}><section className="planner-import" role="dialog" aria-modal="true" aria-labelledby="planner-import-title"><header><span><Clipboard size={17} /><strong id="planner-import-title">Import character or build</strong></span><button type="button" aria-label="Close build import" onClick={() => setImportOpen(false)}><X size={16} /></button></header><nav><button type="button" className={importMode === "pob" ? "is-active" : ""} onClick={() => setImportMode("pob")}>PoB / build link</button><button type="button" className={importMode === "character" ? "is-active" : ""} onClick={() => setImportMode("character")}>My character</button></nav>{importMode === "pob" ? <><p>Paste a {tree.game === "poe2" ? "PoB2" : "PoB"} code/XML, pobb.in or Pastebin link. You can also open an XML file. Full build imports retain tree specs, items, gems, config, and notes.</p><textarea aria-label="PoB build code or XML" autoFocus value={importText} onChange={(event) => setImportText(event.target.value)} placeholder={`${tree.game === "poe2" ? "PoB2" : "PoB"} code, XML, or supported build URL…`} /><div><button type="button" onClick={clipboardBuild}><Clipboard size={14} /> Read clipboard</button><button type="button" onClick={openBuild}><FolderOpen size={14} /> Open XML</button><button type="button" className="is-primary" onClick={() => importBuild()} disabled={!importText.trim() || busy}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <Upload size={14} />} Import</button></div></> : <div className="character-import"><p>Public profiles work with an account name. Private profiles use a temporary official OAuth token with the <code>account:characters</code> scope; the token is never saved. Character nodes are matched only against the selected game’s installed PoB tree.</p><div className="character-import-mode"><button type="button" className={characterMode === "public" ? "is-active" : ""} onClick={() => { setCharacterMode("public"); setCharacters([]); }}>Public profile</button><button type="button" className={characterMode === "oauth" ? "is-active" : ""} onClick={() => { setCharacterMode("oauth"); setCharacters([]); }}>Official OAuth</button></div><label>Realm<select value={realm} onChange={(event) => { setRealm(event.target.value as PoeCharacterImportRequest["realm"]); setCharacters([]); }}>{tree.game === "poe2" ? <option value="poe2">PC (PoE 2)</option> : <><option value="pc">PC (PoE 1)</option><option value="xbox">Xbox</option><option value="sony">Sony</option></>}</select></label>{characterMode === "public" ? <label>Account name<input value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="AccountName#1234" /></label> : <label>OAuth access token<input type="password" value={accessToken} onChange={(event) => setAccessToken(event.target.value)} autoComplete="off" placeholder="Temporary account:characters token" /></label>}<button type="button" onClick={loadCharacters} disabled={busy || (characterMode === "public" ? !accountName.trim() : !accessToken.trim())}>{busy ? <LoaderCircle className="is-spinning" size={14} /> : <RefreshCw size={14} />} Load character list</button>{characters.length > 0 && <><label>Character<select value={selectedCharacter} onChange={(event) => setSelectedCharacter(event.target.value)}>{characters.map((character) => <option key={character.id || character.name} value={character.name}>{character.name} · {character.class} {character.level} · {character.league || "No league"}</option>)}</select></label><button type="button" className="is-primary" onClick={loadCharacter} disabled={busy || !selectedCharacter}><Upload size={14} /> Import selected character</button></>}</div>}</section></div>}
    </section>
  );
}
