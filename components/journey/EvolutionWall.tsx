"use client";

/**
 * EvolutionWall — scrollable gallery of evolution family trees on the Journey tab.
 *
 * Shows every evolution family as a compact tree, with edges (arrows) lighting
 * up as the corresponding evolution/reverse-evolution cards are mastered.
 * Branching families (Eevee, Wurmple) fan out to show all branches.
 *
 * Filtering: "All" / "In progress" / "Completed"
 * Headline: "Families completed: N / M"
 */

import { useState, useMemo, useId } from "react";
import Image from "next/image";
import { useTranslations, useFormatter } from "next-intl";
import type {
  EvolutionFamily,
  FamilyEdge,
  FamilyNode,
} from "@/lib/evolution/chains";
import { computeEvolutionWallStats } from "@/lib/evolution/chains";
import { mutedTextXs } from "@/lib/utils/class-names";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterMode = "all" | "in-progress" | "completed";

// ---------------------------------------------------------------------------
// Edge status helpers
// ---------------------------------------------------------------------------

function edgeStatusClass(edge: FamilyEdge): string {
  if (edge.fullyMastered)
    return "text-emerald-500 dark:text-emerald-400";
  if (edge.forwardMastered || edge.reverseMastered)
    return "text-amber-500 dark:text-amber-400";
  return "text-zinc-300 dark:text-zinc-600";
}

function edgeAriaLabel(edge: FamilyEdge, fromName: string, toName: string): string {
  if (edge.fullyMastered)
    return `${fromName} to ${toName}: both directions mastered`;
  if (edge.forwardMastered && !edge.reverseMastered)
    return `${fromName} to ${toName}: forward mastered, reverse not yet`;
  if (!edge.forwardMastered && edge.reverseMastered)
    return `${fromName} to ${toName}: reverse mastered, forward not yet`;
  return `${fromName} to ${toName}: not yet mastered`;
}

// ---------------------------------------------------------------------------
// Filter helpers
// ---------------------------------------------------------------------------

function matchesFilter(family: EvolutionFamily, mode: FilterMode): boolean {
  if (mode === "all") return true;
  if (mode === "completed") return family.completed;
  // in-progress: at least one edge partially or fully mastered, but not all completed.
  const anyMastered = family.edges.some(
    (e) => e.forwardMastered || e.reverseMastered,
  );
  return anyMastered && !family.completed;
}

// ---------------------------------------------------------------------------
// CompactEdgeArrow
// ---------------------------------------------------------------------------

/** A small SVG arrow indicating mastery state between two species. */
function CompactEdgeArrow({ edge, fromName, toName }: {
  edge: FamilyEdge;
  fromName: string;
  toName: string;
}) {
  const cls = edgeStatusClass(edge);
  const ariaLabel = edgeAriaLabel(edge, fromName, toName);
  return (
    <span
      className={`flex shrink-0 items-center ${cls}`}
      aria-label={ariaLabel}
      role="img"
    >
      {/* Forward arrow */}
      <svg
        width="20"
        height="14"
        viewBox="0 0 20 14"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        <line
          x1="1"
          y1="7"
          x2="16"
          y2="7"
          strokeWidth="2"
          strokeLinecap="round"
          stroke="currentColor"
        />
        <polyline
          points="11,2 16,7 11,12"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          fill="none"
          stroke="currentColor"
        />
      </svg>
    </span>
  );
}

// ---------------------------------------------------------------------------
// SpeciesNode
// ---------------------------------------------------------------------------

function SpeciesNode({ node }: { node: FamilyNode }) {
  return (
    <div className="flex flex-col items-center gap-0.5" style={{ minWidth: 48 }}>
      <div className="relative h-10 w-10 shrink-0">
        {node.spriteUrl ? (
          <Image
            src={node.spriteUrl}
            alt={node.name}
            width={40}
            height={40}
            className="object-contain"
            loading="lazy"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-zinc-200 dark:bg-zinc-700" aria-hidden="true" />
        )}
      </div>
      <span className="max-w-[52px] truncate text-center text-[10px] leading-tight text-zinc-500 dark:text-zinc-400">
        {node.name}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FamilyTree
// ---------------------------------------------------------------------------

/**
 * Renders a single evolution family as a compact horizontal tree.
 *
 * Simple linear chains: A → B → C rendered left-to-right in one row.
 * Branching (e.g. Eevee → 8 forms): the pre-evo is on the left, branches fan
 * out vertically on the right.
 *
 * We detect branching by checking if any species has multiple outgoing edges.
 */
function FamilyTree({ family }: { family: EvolutionFamily }) {
  const nodeById = useMemo(() => {
    const map = new Map<number, FamilyNode>();
    for (const n of family.nodes) map.set(n.speciesId, n);
    return map;
  }, [family.nodes]);

  // Build a map: speciesId → outgoing edges.
  const outEdges = useMemo(() => {
    const map = new Map<number, FamilyEdge[]>();
    for (const edge of family.edges) {
      const list = map.get(edge.fromId) ?? [];
      list.push(edge);
      map.set(edge.fromId, list);
    }
    return map;
  }, [family.edges]);

  // Determine if any node has more than one outgoing edge (branching).
  const isBranching = useMemo(
    () => [...outEdges.values()].some((edges) => edges.length > 1),
    [outEdges],
  );

  const rootNode = nodeById.get(family.rootId);
  if (!rootNode) return null;

  if (!isBranching) {
    return <LinearChain family={family} nodeById={nodeById} outEdges={outEdges} />;
  }
  return <BranchingTree family={family} nodeById={nodeById} outEdges={outEdges} />;
}

/** Linear chain: A → B → C in a single row. */
function LinearChain({
  family,
  nodeById,
  outEdges,
}: {
  family: EvolutionFamily;
  nodeById: Map<number, FamilyNode>;
  outEdges: Map<number, FamilyEdge[]>;
}) {
  // Walk the chain from the root.
  const ordered: Array<{ node: FamilyNode; edge: FamilyEdge | null }> = [];
  let currentId: number | null = family.rootId;
  while (currentId !== null) {
    const node = nodeById.get(currentId);
    if (!node) break;
    const edges: FamilyEdge[] = outEdges.get(currentId) ?? [];
    ordered.push({ node, edge: edges[0] ?? null });
    currentId = edges[0]?.toId ?? null;
  }

  return (
    <div className="flex items-center gap-1 flex-wrap justify-center">
      {ordered.map(({ node, edge }) => (
        <span key={node.speciesId} className="flex items-center gap-1">
          <SpeciesNode node={node} />
          {edge !== null && (
            <CompactEdgeArrow
              edge={edge}
              fromName={node.name}
              toName={nodeById.get(edge.toId)?.name ?? "?"}
            />
          )}
        </span>
      ))}
    </div>
  );
}

/**
 * Branching tree: one root on the left, branches fanning out on the right.
 * Handles two-level branches (pre-evo → multiple evolutions) and
 * deeper cases like Wurmple (two mid-stage options, each with one final form).
 */
function BranchingTree({
  family,
  nodeById,
  outEdges,
}: {
  family: EvolutionFamily;
  nodeById: Map<number, FamilyNode>;
  outEdges: Map<number, FamilyEdge[]>;
}) {
  const rootNode = nodeById.get(family.rootId);
  if (!rootNode) return null;

  /** Recursively render a subtree from a given node. */
  function renderSubtree(nodeId: number): React.ReactNode {
    const node = nodeById.get(nodeId);
    if (!node) return null;
    const children = outEdges.get(nodeId) ?? [];

    if (children.length === 0) {
      return <SpeciesNode node={node} />;
    }

    return (
      <div className="flex items-center gap-1">
        <SpeciesNode node={node} />
        <div className="flex flex-col gap-1">
          {children.map((edge) => {
            const childNode = nodeById.get(edge.toId);
            return (
              <div key={edge.toId} className="flex items-center gap-1">
                <CompactEdgeArrow
                  edge={edge}
                  fromName={node.name}
                  toName={childNode?.name ?? "?"}
                />
                {renderSubtree(edge.toId)}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-center overflow-x-auto">
      {renderSubtree(family.rootId)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// FamilyCard
// ---------------------------------------------------------------------------

function FamilyCard({ family }: { family: EvolutionFamily }) {
  const tWidget = useTranslations("journey.evolutionWallWidget");
  return (
    <div
      className={[
        "relative overflow-hidden rounded-xl border bg-background p-3 transition-shadow",
        family.completed
          ? "border-emerald-400 shadow-[0_0_0_1px_rgba(52,211,153,0.3)] dark:border-emerald-600"
          : "border-zinc-200 dark:border-zinc-800",
      ].join(" ")}
    >
      {family.completed && (
        <span
          className="absolute right-2 top-2 text-[10px] font-semibold uppercase tracking-widest text-emerald-500 dark:text-emerald-400"
          aria-hidden="true"
        >
          {tWidget("familyDone")}
        </span>
      )}
      {family.completed && (
        <span className="sr-only">{tWidget("familyCompletedSrOnly")}</span>
      )}
      <FamilyTree family={family} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// FilterTabs
// ---------------------------------------------------------------------------

const FILTER_MODES: FilterMode[] = ["all", "in-progress", "completed"];

function FilterTabs({
  active,
  onChange,
}: {
  active: FilterMode;
  onChange: (mode: FilterMode) => void;
}) {
  const tWidget = useTranslations("journey.evolutionWallWidget");
  return (
    <div
      className="flex gap-1 rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/60"
      role="tablist"
      aria-label={tWidget("filterAriaLabel")}
    >
      {FILTER_MODES.map((mode) => {
        const label =
          mode === "all" ? tWidget("filterAll")
          : mode === "in-progress" ? tWidget("filterInProgress")
          : tWidget("filterCompleted");
        return (
          <button
            key={mode}
            role="tab"
            aria-selected={active === mode}
            onClick={() => onChange(mode)}
            className={[
              "flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] focus-visible:ring-offset-1",
              active === mode
                ? "bg-background text-foreground shadow-sm"
                : "text-zinc-500 hover:text-foreground dark:text-zinc-400",
            ].join(" ")}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EvolutionWall
// ---------------------------------------------------------------------------

export function EvolutionWall({
  families,
}: {
  families: readonly EvolutionFamily[];
}) {
  const tWidget = useTranslations("journey.evolutionWallWidget");
  const format = useFormatter();
  const [filter, setFilter] = useState<FilterMode>("all");
  const [isOpen, setIsOpen] = useState(false);
  const headingId = useId();
  const panelId = useId();

  const stats = useMemo(
    () => computeEvolutionWallStats(families),
    [families],
  );

  const filtered = useMemo(
    () => families.filter((f) => matchesFilter(f, filter)),
    [families, filter],
  );

  return (
    <section aria-labelledby={headingId}>
      {/* Section heading + disclosure toggle on the same row */}
      <div className="flex items-center justify-between gap-3">
        <h2
          id={headingId}
          className="text-base font-semibold text-foreground"
        >
          {tWidget("heading")}
        </h2>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((prev) => !prev)}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-zinc-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--theme-accent)] dark:border-zinc-700 dark:bg-zinc-900 dark:hover:bg-zinc-800"
        >
          <span>{isOpen ? tWidget("collapse") : tWidget("expand")}</span>
          <svg
            viewBox="0 0 16 16"
            fill="none"
            className={[
              "h-4 w-4 text-zinc-400 transition-transform",
              isOpen ? "rotate-180" : "",
            ].join(" ")}
            aria-hidden="true"
          >
            <path
              d="M4 6L8 10L12 6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Summary line — always visible, gives a progress snapshot at a glance */}
      <p className="mb-3 mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        {tWidget("familiesCompleted")}{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {format.number(stats.completedFamilies)}
        </span>
        {" / "}
        <span className="tabular-nums">
          {format.number(stats.totalFamilies)}
        </span>
      </p>

      {/*
        Panel is always in the DOM so aria-controls always references a real
        element — use the `hidden` attribute rather than conditional render (#856).
      */}
      <div id={panelId} hidden={!isOpen}>
        {/* Filter tabs */}
        <div className="mb-4">
          <FilterTabs active={filter} onChange={setFilter} />
        </div>

        {/* Gallery */}
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-zinc-400 dark:text-zinc-600">
            {filter === "in-progress"
              ? tWidget("noFamiliesInProgress")
              : filter === "completed"
                ? tWidget("noFamiliesCompleted")
                : tWidget("noFamiliesFound")}
          </p>
        ) : (
          <div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            role="list"
            aria-label={tWidget("galleriesAriaLabel")}
            aria-live="polite"
            aria-atomic="false"
          >
            {filtered.map((family) => (
              <div key={family.rootId} role="listitem">
                <FamilyCard family={family} />
              </div>
            ))}
          </div>
        )}

        {/* Legend */}
        <div className={`mt-4 flex flex-wrap items-center gap-4 ${mutedTextXs}`}>
          <span className="flex items-center gap-1.5">
            <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
              <line x1="1" y1="5" x2="10" y2="5" strokeWidth="2" strokeLinecap="round" className="stroke-emerald-500 dark:stroke-emerald-400" stroke="currentColor" />
              <polyline points="6,1 10,5 6,9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" className="stroke-emerald-500 dark:stroke-emerald-400" stroke="currentColor" />
            </svg>
            <span className="text-emerald-600 dark:text-emerald-400">{tWidget("legendBothMastered")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
              <line x1="1" y1="5" x2="10" y2="5" strokeWidth="2" strokeLinecap="round" className="stroke-amber-500" stroke="currentColor" />
              <polyline points="6,1 10,5 6,9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" className="stroke-amber-500" stroke="currentColor" />
            </svg>
            <span className="text-amber-600 dark:text-amber-400">{tWidget("legendOneDirection")}</span>
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="14" height="10" viewBox="0 0 14 10" aria-hidden="true">
              <line x1="1" y1="5" x2="10" y2="5" strokeWidth="2" strokeLinecap="round" className="stroke-zinc-300 dark:stroke-zinc-600" stroke="currentColor" />
              <polyline points="6,1 10,5 6,9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" className="stroke-zinc-300 dark:stroke-zinc-600" stroke="currentColor" />
            </svg>
            <span>{tWidget("legendNotYet")}</span>
          </span>
        </div>
      </div>
    </section>
  );
}
