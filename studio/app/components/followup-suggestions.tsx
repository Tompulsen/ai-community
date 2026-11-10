"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpLeft, LoaderCircle } from "lucide-react";
import styles from "./followup-suggestions.module.scss";

type FollowupSuggestionsProps = {
  suggestions: readonly string[];
  disabled?: boolean;
  onSelect: (text: string) => Promise<boolean>;
};

export function FollowupSuggestions(props: FollowupSuggestionsProps) {
  const suggestions = Array.from(
    new Set(props.suggestions.map((text) => text.trim()).filter(Boolean)),
  ).slice(0, 3);
  if (!suggestions.length) return null;

  return (
    <SuggestionList
      key={JSON.stringify(suggestions)}
      {...props}
      suggestions={suggestions}
    />
  );
}

function SuggestionList({
  suggestions,
  disabled = false,
  onSelect,
}: FollowupSuggestionsProps) {
  const [pending, setPending] = useState<string>();
  const [failed, setFailed] = useState(false);
  const request = useRef<object>();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      request.current = undefined;
    };
  }, []);

  const select = async (text: string) => {
    if (disabled || request.current) return;
    const currentRequest = {};
    request.current = currentRequest;
    setPending(text);
    setFailed(false);
    try {
      await onSelect(text);
    } catch {
      if (mounted.current && request.current === currentRequest) {
        setFailed(true);
      }
    } finally {
      if (mounted.current && request.current === currentRequest) {
        request.current = undefined;
        setPending(undefined);
      }
    }
  };

  return (
    <section
      className={styles.suggestions}
      aria-label="继续追问"
      aria-busy={!!pending}
      data-testid="followup-suggestions"
    >
      <div className={styles.heading}>继续追问</div>
      <div className={styles.list}>
        {suggestions.map((text) => (
          <button
            key={text}
            type="button"
            className={styles.suggestion}
            disabled={disabled || !!pending}
            onClick={() => void select(text)}
          >
            <span>{text}</span>
            {pending === text ? (
              <LoaderCircle
                size={16}
                className={styles.spinner}
                aria-hidden="true"
              />
            ) : (
              <ArrowUpLeft size={16} aria-hidden="true" />
            )}
          </button>
        ))}
      </div>
      {failed && (
        <div className={styles.error} role="alert">
          建议暂未填入，请重试。
        </div>
      )}
    </section>
  );
}
