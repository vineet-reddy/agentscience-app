import { type ProjectEntry, type ProviderKind } from "@agentscience/contracts";
import { memo, useLayoutEffect, useMemo, useRef } from "react";
import { type ComposerSlashCommand, type ComposerTriggerKind } from "../../composer-logic";
import { BotIcon, DatabaseIcon, LibraryIcon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Command, CommandItem, CommandList } from "../ui/command";
import { VscodeEntryIcon } from "./VscodeEntryIcon";

export type ComposerCommandItem =
  | {
      id: string;
      type: "path";
      path: string;
      pathKind: ProjectEntry["kind"];
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "slash-command";
      command: ComposerSlashCommand;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "model";
      provider: ProviderKind;
      model: string;
      label: string;
      description: string;
    }
  | {
      id: string;
      type: "dataset";
      datasetId: string;
      slug: string;
      name: string;
      shortName: string | null;
      url: string;
      domain: string;
      description: string;
      providerName: string | null;
    }
  | {
      id: string;
      type: "provider";
      providerId: string;
      slug: string;
      name: string;
      domain: string;
      description: string;
      datasetCount: number;
    };

type ComposerCommandItemKind = ComposerCommandItem["type"];

interface ComposerCommandGroup {
  key: ComposerCommandItemKind;
  label: string | null;
  items: ComposerCommandItem[];
}

function groupComposerCommandItems(items: ComposerCommandItem[]): ComposerCommandGroup[] {
  const providers = items.filter(
    (item): item is Extract<ComposerCommandItem, { type: "provider" }> =>
      item.type === "provider",
  );
  const datasets = items.filter(
    (item): item is Extract<ComposerCommandItem, { type: "dataset" }> => item.type === "dataset",
  );
  const files = items.filter(
    (item): item is Extract<ComposerCommandItem, { type: "path" }> => item.type === "path",
  );
  const others = items.filter(
    (item) => item.type !== "provider" && item.type !== "dataset" && item.type !== "path",
  );

  const groups: ComposerCommandGroup[] = [];
  const hasRegistrySections = providers.length > 0 || datasets.length > 0;
  if (providers.length > 0) {
    groups.push({ key: "provider", label: "PROVIDERS", items: providers });
  }
  if (datasets.length > 0) {
    groups.push({ key: "dataset", label: "DATASETS", items: datasets });
  }
  if (files.length > 0) {
    groups.push({
      key: "path",
      label: hasRegistrySections ? "FILES" : null,
      items: files,
    });
  }
  if (others.length > 0) {
    groups.push({ key: others[0]!.type, label: null, items: others });
  }
  return groups;
}

export const ComposerCommandMenu = memo(function ComposerCommandMenu(props: {
  items: ComposerCommandItem[];
  resolvedTheme: "light" | "dark";
  isLoading: boolean;
  triggerKind: ComposerTriggerKind | null;
  activeItemId: string | null;
  onHighlightedItemChange: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const groupedItems = useMemo(() => groupComposerCommandItems(props.items), [props.items]);

  useLayoutEffect(() => {
    if (!props.activeItemId || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(
      `[data-composer-item-id="${CSS.escape(props.activeItemId)}"]`,
    );
    el?.scrollIntoView({ block: "nearest" });
  }, [props.activeItemId]);

  return (
    <Command
      autoHighlight={false}
      mode="none"
      onItemHighlighted={(highlightedValue) => {
        props.onHighlightedItemChange(
          typeof highlightedValue === "string" ? highlightedValue : null,
        );
      }}
    >
      <div
        ref={listRef}
        className="relative overflow-hidden rounded-xl border border-border/80 bg-popover/96 shadow-lg/8 backdrop-blur-xs"
      >
        <CommandList className="max-h-72">
          {groupedItems.map((group) => (
            <div key={group.key} className="py-1">
              {group.label ? (
                <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                  {group.label}
                </div>
              ) : null}
              {group.items.map((item) => (
                <ComposerCommandMenuItem
                  key={item.id}
                  item={item}
                  resolvedTheme={props.resolvedTheme}
                  isActive={props.activeItemId === item.id}
                  onHighlight={props.onHighlightedItemChange}
                  onSelect={props.onSelect}
                />
              ))}
            </div>
          ))}
        </CommandList>
        {props.items.length === 0 && (
          <p className="px-3 py-2 text-muted-foreground/70 text-xs">
            {props.isLoading
              ? "Searching workspace files..."
              : props.triggerKind === "path"
                ? "No matching providers, datasets, or files."
                : "No matching command."}
          </p>
        )}
      </div>
    </Command>
  );
});

const ComposerCommandMenuItem = memo(function ComposerCommandMenuItem(props: {
  item: ComposerCommandItem;
  resolvedTheme: "light" | "dark";
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  if (props.item.type === "provider") {
    return <ComposerProviderMenuItem {...props} item={props.item} />;
  }
  if (props.item.type === "dataset") {
    return <ComposerDatasetMenuItem {...props} item={props.item} />;
  }

  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      className={cn(
        "cursor-pointer select-none gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
        props.isActive && "bg-accent! text-accent-foreground!",
      )}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      {props.item.type === "path" ? (
        <VscodeEntryIcon
          pathValue={props.item.path}
          kind={props.item.pathKind}
          theme={props.resolvedTheme}
        />
      ) : null}
      {props.item.type === "slash-command" ? (
        <BotIcon className="size-4 text-muted-foreground/80" />
      ) : null}
      {props.item.type === "model" ? (
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          model
        </Badge>
      ) : null}
      <span className="flex min-w-0 items-center gap-1.5 truncate">
        <span className="truncate">{props.item.label}</span>
      </span>
      <span className="truncate text-muted-foreground/70 text-xs">{props.item.description}</span>
    </CommandItem>
  );
});

const ComposerProviderMenuItem = memo(function ComposerProviderMenuItem(props: {
  item: Extract<ComposerCommandItem, { type: "provider" }>;
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      className={cn(
        "cursor-pointer select-none items-center gap-2.5 px-2 py-1.5 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
        props.isActive && "bg-secondary text-secondary-foreground",
      )}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: "#EEE7FB" }}
      >
        <LibraryIcon className="size-4" style={{ color: "#6239C4" }} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-tight">{props.item.name}</span>
        {props.item.description ? (
          <span className="truncate text-[11px] leading-tight text-muted-foreground">
            {props.item.description}
          </span>
        ) : null}
      </span>
      {props.item.datasetCount > 0 ? (
        <Badge
          variant="secondary"
          className="ml-auto shrink-0 px-1.5 py-0 text-[11px] font-normal"
        >
          {props.item.datasetCount} datasets
        </Badge>
      ) : props.item.domain ? (
        <Badge
          variant="secondary"
          className="ml-auto shrink-0 px-1.5 py-0 text-[11px] font-normal"
        >
          {props.item.domain}
        </Badge>
      ) : null}
    </CommandItem>
  );
});

const ComposerDatasetMenuItem = memo(function ComposerDatasetMenuItem(props: {
  item: Extract<ComposerCommandItem, { type: "dataset" }>;
  isActive: boolean;
  onHighlight: (itemId: string | null) => void;
  onSelect: (item: ComposerCommandItem) => void;
}) {
  return (
    <CommandItem
      value={props.item.id}
      data-composer-item-id={props.item.id}
      className={cn(
        "cursor-pointer select-none items-center gap-2.5 px-2 py-1.5 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit",
        props.isActive && "bg-secondary text-secondary-foreground",
      )}
      onMouseMove={() => {
        if (!props.isActive) props.onHighlight(props.item.id);
      }}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onSelect(props.item);
      }}
    >
      <span
        aria-hidden="true"
        className="flex size-7 shrink-0 items-center justify-center rounded-md"
        style={{ backgroundColor: "#E1F5EE" }}
      >
        <DatabaseIcon className="size-4" style={{ color: "#0F6E56" }} strokeWidth={1.75} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-[13px] font-medium leading-tight">
          {props.item.shortName?.trim() ? props.item.shortName : props.item.name}
        </span>
        {props.item.description ? (
          <span className="truncate text-[11px] leading-tight text-muted-foreground">
            {props.item.description}
          </span>
        ) : null}
      </span>
      {props.item.providerName ? (
        <Badge
          variant="secondary"
          className="ml-auto shrink-0 px-1.5 py-0 text-[11px] font-normal"
        >
          {props.item.providerName}
        </Badge>
      ) : props.item.domain ? (
        <Badge
          variant="secondary"
          className="ml-auto shrink-0 px-1.5 py-0 text-[11px] font-normal"
        >
          {props.item.domain}
        </Badge>
      ) : null}
    </CommandItem>
  );
});
