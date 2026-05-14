import {
  PROVIDER_DISPLAY_NAMES,
  type ProviderKind,
  type ServerProvider,
} from "@agentscience/contracts";
import { resolveSelectableModel } from "@agentscience/shared/model";
import { memo, useState } from "react";
import type { VariantProps } from "class-variance-authority";
import { ChevronDownIcon } from "lucide-react";
import { Button, buttonVariants } from "../ui/button";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "../ui/menu";
import { Gemini, OpenAI, type Icon } from "../Icons";
import { cn } from "~/lib/utils";

const PROVIDER_ICONS: Record<ProviderKind, Icon> = {
  codex: OpenAI,
  gemini: Gemini,
};

function isProviderEnabled(
  providers: ReadonlyArray<ServerProvider> | undefined,
  provider: ProviderKind,
): boolean {
  return providers?.find((candidate) => candidate.provider === provider)?.enabled ?? true;
}

function makeProviderModelValue(provider: ProviderKind, model: string): string {
  return `${provider}:${model}`;
}

function parseProviderModelValue(value: string): { provider: ProviderKind; model: string } | null {
  const separatorIndex = value.indexOf(":");
  if (separatorIndex <= 0) return null;
  const provider = value.slice(0, separatorIndex);
  if (provider !== "codex" && provider !== "gemini") return null;
  const model = value.slice(separatorIndex + 1);
  if (!model) return null;
  return { provider, model };
}

export const ProviderModelPicker = memo(function ProviderModelPicker(props: {
  provider: ProviderKind;
  model: string;
  lockedProvider: ProviderKind | null;
  providers?: ReadonlyArray<ServerProvider>;
  modelOptionsByProvider: Record<ProviderKind, ReadonlyArray<{ slug: string; name: string }>>;
  activeProviderIconClassName?: string;
  compact?: boolean;
  disabled?: boolean;
  triggerVariant?: VariantProps<typeof buttonVariants>["variant"];
  triggerClassName?: string;
  onProviderModelChange: (provider: ProviderKind, model: string) => void;
}) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const activeProvider = props.lockedProvider ?? props.provider;
  const ActiveProviderIcon = PROVIDER_ICONS[activeProvider];
  const selectableProviders = (props.lockedProvider
    ? [props.lockedProvider]
    : (Object.keys(props.modelOptionsByProvider) as ProviderKind[])).filter(
    (provider) =>
      isProviderEnabled(props.providers, provider) &&
      props.modelOptionsByProvider[provider].length > 0,
  );
  const selectedProviderOptions = props.modelOptionsByProvider[activeProvider] ?? [];
  const selectedModelLabel =
    selectedProviderOptions.find((option) => option.slug === props.model)?.name ?? props.model;
  const handleModelChange = (provider: ProviderKind, value: string) => {
    if (props.disabled) return;
    if (!value) return;
    const resolvedModel = resolveSelectableModel(
      provider,
      value,
      props.modelOptionsByProvider[provider],
    );
    if (!resolvedModel) return;
    props.onProviderModelChange(provider, resolvedModel);
    setIsMenuOpen(false);
  };
  const handleProviderModelValueChange = (value: string) => {
    const parsed = parseProviderModelValue(value);
    if (!parsed) return;
    handleModelChange(parsed.provider, parsed.model);
  };

  return (
    <Menu
      open={isMenuOpen}
      onOpenChange={(open) => {
        if (props.disabled) {
          setIsMenuOpen(false);
          return;
        }
        setIsMenuOpen(open);
      }}
    >
      <MenuTrigger
        render={
          <Button
            size="sm"
            variant={props.triggerVariant ?? "ghost"}
            data-chat-provider-model-picker="true"
            className={cn(
              "min-w-0 justify-start overflow-hidden whitespace-nowrap px-2 text-muted-foreground/70 hover:text-foreground/80 [&_svg]:mx-0",
              props.compact ? "max-w-42 shrink-0" : "max-w-48 shrink sm:max-w-56 sm:px-3",
              props.triggerClassName,
            )}
            disabled={props.disabled}
          />
        }
      >
        <span
          className={cn(
            "flex min-w-0 w-full box-border items-center gap-2 overflow-hidden",
            props.compact ? "max-w-36 sm:pl-1" : undefined,
          )}
        >
          <ActiveProviderIcon
            aria-hidden="true"
            className={cn(
              "size-4 shrink-0 text-muted-foreground/70",
              props.activeProviderIconClassName,
            )}
          />
          <span className="min-w-0 flex-1 truncate">{selectedModelLabel}</span>
          <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 opacity-60" />
        </span>
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <MenuRadioGroup
            value={makeProviderModelValue(activeProvider, props.model)}
            onValueChange={handleProviderModelValueChange}
          >
            {selectableProviders.flatMap((provider, providerIndex) => {
              const models = props.modelOptionsByProvider[provider] ?? [];
              const providerLabel = PROVIDER_DISPLAY_NAMES[provider] ?? provider;
              const showProviderLabel = selectableProviders.length > 1;
              return [
                ...(showProviderLabel
                  ? [
                      <MenuGroupLabel key={`${provider}:label`} inset={false}>
                        {providerLabel}
                      </MenuGroupLabel>,
                    ]
                  : []),
                ...models.map((modelOption) => (
                  <MenuRadioItem
                    key={`${provider}:${modelOption.slug}`}
                    value={makeProviderModelValue(provider, modelOption.slug)}
                    onClick={() => setIsMenuOpen(false)}
                  >
                    {modelOption.name}
                  </MenuRadioItem>
                )),
                ...(showProviderLabel && providerIndex < selectableProviders.length - 1
                  ? [
                      <div
                        aria-hidden="true"
                        className="mx-2 my-1 h-px bg-border"
                        key={`${provider}:separator`}
                      />,
                    ]
                  : []),
              ];
            })}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
});
