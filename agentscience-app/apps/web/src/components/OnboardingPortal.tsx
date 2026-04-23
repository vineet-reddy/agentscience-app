/**
 * Post-connection onboarding screen.
 *
 * Two questions, both optional, "Skip for now" in the corner. The point is
 * that it feels like two taps, not a form. Question 2 auto-advances ~400ms
 * after the user picks a chip (or immediately on Enter); there is no
 * Continue button.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BrandMark } from "./BrandMark";
import { isElectron } from "../env";
import { useDesktopFullScreen } from "../hooks/useDesktopFullScreen";
import { isMacPlatform, cn } from "../lib/utils";
import {
  DATA_INTERESTS_BY_FIELD,
  FIELD_DEFINITIONS,
  GENERIC_DATA_INTERESTS,
  MANUAL_ONLY_DATASET_IDS,
  OPEN_AUTO_CONNECT_DATASET_IDS,
  type DataInterestChip,
  type FieldTag,
  resolveDataInterestChips,
} from "../onboardingCatalog";
import { useOnboardingStore } from "../onboardingStore";

const AUTO_ADVANCE_MS = 400;

interface OnboardingPortalProps {
  readonly onComplete: () => void;
}

export function OnboardingPortal({ onComplete }: OnboardingPortalProps) {
  const isMacElectron = isElectron && isMacPlatform(navigator.platform);
  const isFullScreen = useDesktopFullScreen();
  const showTitlebarInset = isMacElectron && !isFullScreen;

  const setFieldInStore = useOnboardingStore((s) => s.setField);
  const setFieldOtherInStore = useOnboardingStore((s) => s.setFieldOther);
  const setDataInterestsInStore = useOnboardingStore((s) => s.setDataInterests);
  const setAutoConnected = useOnboardingStore((s) => s.setAutoConnectedDatasets);
  const completeOnboarding = useOnboardingStore((s) => s.complete);

  const [selectedFields, setSelectedFields] = useState<FieldTag[]>([]);
  const [otherFieldText, setOtherFieldText] = useState("");
  const [selectedInterests, setSelectedInterests] = useState<string[]>([]);
  const [advancing, setAdvancing] = useState(false);

  const otherInputRef = useRef<HTMLInputElement>(null);
  const advanceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
    };
  }, []);

  const dataInterestChips = useMemo<ReadonlyArray<DataInterestChip>>(() => {
    if (selectedFields.length === 0) return GENERIC_DATA_INTERESTS;
    return resolveDataInterestChips(selectedFields);
  }, [selectedFields]);

  useEffect(() => {
    setSelectedInterests((current) => {
      const allowed = new Set(dataInterestChips.map((c) => c.id));
      return current.filter((id) => allowed.has(id));
    });
  }, [dataInterestChips]);

  const toggleField = useCallback((tag: FieldTag) => {
    setSelectedFields((current) => {
      if (current.includes(tag)) {
        return current.filter((entry) => entry !== tag);
      }
      if (current.length >= 2) {
        // Rotate: drop the oldest so the newest pick always wins.
        return [current[1]!, tag];
      }
      return [...current, tag];
    });
  }, []);

  useEffect(() => {
    if (selectedFields.includes("other")) {
      window.requestAnimationFrame(() => {
        otherInputRef.current?.focus();
      });
    }
  }, [selectedFields]);

  const finish = useCallback(
    (payload: {
      fields: ReadonlyArray<FieldTag>;
      fieldOther: string | null;
      interests: ReadonlyArray<string>;
      chips: ReadonlyArray<DataInterestChip>;
      skipped: boolean;
    }) => {
      const autoConnected: Array<{ kind: "dataset" | "provider"; slug: string }> = [];
      for (const id of payload.interests) {
        if (MANUAL_ONLY_DATASET_IDS.has(id)) continue;
        if (!OPEN_AUTO_CONNECT_DATASET_IDS.has(id)) continue;
        const chip = payload.chips.find((c) => c.id === id);
        if (!chip) continue;
        if (chip.datasetSlug) {
          autoConnected.push({ kind: "dataset", slug: chip.datasetSlug });
        } else if (chip.providerSlug) {
          autoConnected.push({ kind: "provider", slug: chip.providerSlug });
        }
      }

      setFieldInStore(payload.fields);
      setFieldOtherInStore(payload.fieldOther);
      setDataInterestsInStore(payload.interests);
      setAutoConnected(autoConnected);
      completeOnboarding({ skipped: payload.skipped });
      onComplete();
    },
    [
      completeOnboarding,
      onComplete,
      setAutoConnected,
      setDataInterestsInStore,
      setFieldInStore,
      setFieldOtherInStore,
    ],
  );

  const scheduleAdvance = useCallback(
    (interests: ReadonlyArray<string>) => {
      if (advanceTimerRef.current !== null) {
        window.clearTimeout(advanceTimerRef.current);
      }
      setAdvancing(true);
      advanceTimerRef.current = window.setTimeout(() => {
        advanceTimerRef.current = null;
        finish({
          fields: selectedFields,
          fieldOther: selectedFields.includes("other") ? otherFieldText.trim() || null : null,
          interests,
          chips: dataInterestChips,
          skipped: false,
        });
      }, AUTO_ADVANCE_MS);
    },
    [dataInterestChips, finish, otherFieldText, selectedFields],
  );

  const toggleInterest = useCallback(
    (id: string) => {
      setSelectedInterests((current) => {
        if (current.includes(id)) {
          if (advanceTimerRef.current !== null) {
            window.clearTimeout(advanceTimerRef.current);
            advanceTimerRef.current = null;
            setAdvancing(false);
          }
          return current.filter((entry) => entry !== id);
        }
        const next = current.length >= 2 ? [current[1]!, id] : [...current, id];
        scheduleAdvance(next);
        return next;
      });
    },
    [scheduleAdvance],
  );

  const handleEnterAdvance = useCallback(() => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    finish({
      fields: selectedFields,
      fieldOther: selectedFields.includes("other") ? otherFieldText.trim() || null : null,
      interests: selectedInterests,
      chips: dataInterestChips,
      skipped: false,
    });
  }, [dataInterestChips, finish, otherFieldText, selectedFields, selectedInterests]);

  const handleSkip = useCallback(() => {
    if (advanceTimerRef.current !== null) {
      window.clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    finish({
      fields: [],
      fieldOther: null,
      interests: [],
      chips: dataInterestChips,
      skipped: true,
    });
  }, [dataInterestChips, finish]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter") return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      handleEnterAdvance();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [handleEnterAdvance]);

  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      {showTitlebarInset ? <div className="drag-region h-9 shrink-0" /> : null}
      <div
        className={cn(
          "relative flex h-[52px] shrink-0 items-center justify-between border-b border-rule px-6",
          isElectron ? "drag-region" : "",
        )}
      >
        <BrandMark size={28} className="text-ink" wordmarkClassName="text-lg text-ink" />
        <button
          type="button"
          onClick={handleSkip}
          className="text-[0.8125rem] text-ink-light transition-colors duration-150 ease-linear hover:text-ink"
        >
          Skip for now
        </button>
      </div>

      <main className="flex flex-1 items-start justify-center px-6 pb-24 pt-16 sm:pt-24">
        <div className="w-full max-w-[680px]">
          <h1 className="font-display text-[2.5rem] leading-[1.08] text-ink sm:text-[3rem]">
            Tell us what you work on.
          </h1>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-light">
            Two quick questions, both optional. This helps AgentScience suggest
            questions and data sources that fit your work.
          </p>

          <section className="mt-10">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[0.9375rem] font-medium text-ink">Your field</h2>
              <span className="font-mono text-[0.75rem] text-ink-faint">Pick one or two</span>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {FIELD_DEFINITIONS.map((field) => {
                const active = selectedFields.includes(field.tag);
                return (
                  <ChipButton
                    key={field.tag}
                    label={field.label}
                    active={active}
                    onClick={() => toggleField(field.tag)}
                  />
                );
              })}
            </div>
            {selectedFields.includes("other") ? (
              <div className="mt-4 max-w-[420px]">
                <input
                  ref={otherInputRef}
                  type="text"
                  value={otherFieldText}
                  onChange={(event) => setOtherFieldText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      handleEnterAdvance();
                    }
                  }}
                  placeholder="What field are you in?"
                  className="block h-10 w-full rounded-[4px] border border-rule bg-snow-white px-3 text-[0.875rem] text-ink placeholder:text-ink-faint focus:border-ink focus:outline-none"
                />
              </div>
            ) : null}
          </section>

          <section className="mt-12">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[0.9375rem] font-medium text-ink">Typical data</h2>
              <span className="font-mono text-[0.75rem] text-ink-faint">Pick one or two</span>
            </div>
            <p className="mt-1 text-[0.8125rem] text-ink-light">
              We'll pre-connect any open datasets you pick.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {dataInterestChips.map((chip) => {
                const active = selectedInterests.includes(chip.id);
                return (
                  <ChipButton
                    key={chip.id}
                    label={chip.label}
                    active={active}
                    onClick={() => toggleInterest(chip.id)}
                  />
                );
              })}
            </div>
            {advancing ? (
              <p
                className="mt-4 text-[0.75rem] text-ink-faint"
                aria-live="polite"
              >
                Taking you to your workspace…
              </p>
            ) : null}
          </section>
        </div>
      </main>
    </div>
  );
}

function ChipButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "inline-flex select-none items-center rounded-[4px] border px-3 py-1.5 text-[0.8125rem] leading-tight transition-colors duration-150 ease-linear",
        active
          ? "border-ink bg-ink text-snow-white"
          : "border-rule bg-snow-white text-ink hover:border-ink",
      )}
    >
      {label}
    </button>
  );
}

// Exported for tests that want to exercise the post-field state without
// rebuilding the whole mapping locally.
export const ONBOARDING_DATA_INTERESTS_BY_FIELD = DATA_INTERESTS_BY_FIELD;
