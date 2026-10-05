"use client";

import { ChevronRight } from "lucide-react";
import { memo, useMemo, useState } from "react";

import { SKIP_REASON_LABEL } from "@/lib/ingest/types";
import { defaultOpenPaths, type TreeDirNode, type TreeNode } from "@/lib/tree";
import { cn } from "@/lib/utils";

export type FileStatus = "queued" | "active" | "done" | "failed";

type Props = {
  root: TreeDirNode;
  status?: Record<string, FileStatus>;
  className?: string;
};

export function FileTree({ root, status, className }: Props) {
  const initial = useMemo(() => defaultOpenPaths(root), [root]);
  const [open, setOpen] = useState<Set<string>>(initial);
  const [lastRoot, setLastRoot] = useState(root);
  if (lastRoot !== root) {
    // A new repository: reset which folders are expanded.
    setLastRoot(root);
    setOpen(initial);
  }

  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <ul role="tree" aria-label="Repository files" className={cn("font-sans text-[0.8125rem]", className)}>
      {root.children.map((node) => (
        <TreeRow key={node.path} node={node} depth={0} open={open} toggle={toggle} status={status} />
      ))}
    </ul>
  );
}

type RowProps = {
  node: TreeNode;
  depth: number;
  open: Set<string>;
  toggle: (path: string) => void;
  status?: Record<string, FileStatus>;
};

const TreeRow = memo(function TreeRow({ node, depth, open, toggle, status }: RowProps) {
  const indent = { paddingLeft: `${depth * 0.875 + 0.25}rem` };

  if (node.kind === "dir") {
    const isOpen = open.has(node.path);
    const expandable = !node.skipped && node.children.length > 0;
    return (
      <li role="treeitem" aria-expanded={expandable ? isOpen : undefined} aria-selected={false}>
        <button
          type="button"
          onClick={() => expandable && toggle(node.path)}
          disabled={!expandable}
          className={cn(
            "group flex w-full items-center gap-2 rounded-lg py-[0.3125rem] pr-2 text-left transition-colors duration-200",
            expandable ? "cursor-pointer hover:bg-periwinkle/[0.06]" : "cursor-default",
          )}
          style={indent}
        >
          <ChevronRight
            className={cn(
              "size-3.5 text-faint transition-transform duration-300",
              isOpen && "rotate-90 text-periwinkle",
              !expandable && "opacity-0",
            )}
          />
          <span className={cn("truncate", node.skipped || node.included === 0 ? "text-faint/80" : "text-soft-white/85")}>
            {node.name}/
          </span>
          <span className="ml-auto shrink-0 pl-3 font-mono text-[0.6875rem] text-faint tabular-nums">
            {node.skipped ? <SkipTag reason={SKIP_REASON_LABEL[node.skipped]} /> : node.included || ""}
          </span>
        </button>
        {expandable && isOpen && (
          <ul role="group" className="relative">
            <span
              aria-hidden
              className="absolute top-1 bottom-1 w-px bg-gradient-to-b from-border via-border to-transparent"
              style={{ left: `${depth * 0.875 + 0.69}rem` }}
            />
            {node.children.map((child) => (
              <TreeRow key={child.path} node={child} depth={depth + 1} open={open} toggle={toggle} status={status} />
            ))}
          </ul>
        )}
      </li>
    );
  }

  const s = status?.[node.path];
  return (
    <li role="treeitem" aria-selected={false} className="flex items-center gap-2 rounded-lg py-[0.3125rem] pr-2" style={indent}>
      <StatusDot skipped={!!node.skipped} status={s} />
      <span
        className={cn(
          "truncate transition-colors duration-500",
          node.skipped ? "text-faint/70" : s === "active" ? "text-gold" : s === "done" ? "text-soft-white" : "text-soft-white/75",
        )}
        title={node.path}
      >
        {node.name}
      </span>
      <span className="ml-auto shrink-0 pl-3 font-mono text-[0.6875rem] text-faint tabular-nums">
        {node.skipped ? <SkipTag reason={SKIP_REASON_LABEL[node.skipped]} /> : node.file ? `${node.file.lines} ln` : ""}
      </span>
    </li>
  );
});

function SkipTag({ reason }: { reason: string }) {
  return <span className="text-[0.625rem] tracking-[0.16em] text-faint/80 uppercase">{reason}</span>;
}

function StatusDot({ skipped, status }: { skipped: boolean; status?: FileStatus }) {
  if (skipped) return <span aria-hidden className="ml-[0.1875rem] size-1 shrink-0 rounded-full bg-faint/40" />;
  return (
    <span aria-hidden className="relative ml-0.5 flex size-2 shrink-0 items-center justify-center">
      <span
        className={cn(
          "size-1.5 rounded-full transition-all duration-500",
          status === "active" && "size-2 bg-gold motion-safe:animate-breathe",
          status === "done" && "bg-periwinkle",
          status === "failed" && "bg-destructive",
          status === "queued" && "border border-periwinkle/50",
          !status && "border border-periwinkle/35",
        )}
      />
    </span>
  );
}
