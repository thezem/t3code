import { useState, useCallback, useEffect } from "react";

const STORAGE_KEY = "t3code:file-explorer-expanded";

/**
 * Hook for managing file explorer expansion state with sessionStorage persistence.
 * Persists expansion state across tab switches but clears on browser close.
 */
export function useFileExplorerExpanded(cwd: string | null) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Load from sessionStorage on mount
  useEffect(() => {
    if (!cwd) return;
    try {
      const stored = sessionStorage.getItem(`${STORAGE_KEY}:${cwd}`);
      if (stored) {
        const parsedState = JSON.parse(stored) as Record<string, boolean>;
        setExpanded(parsedState);
      }
    } catch (error) {
      console.error("Failed to load file explorer state:", error);
    }
  }, [cwd]);

  const toggle = useCallback(
    (path: string) => {
      setExpanded((current) => {
        const next = {
          ...current,
          [path]: !(current[path] ?? false),
        };
        // Persist to sessionStorage
        if (cwd) {
          try {
            sessionStorage.setItem(`${STORAGE_KEY}:${cwd}`, JSON.stringify(next));
          } catch (error) {
            console.error("Failed to save file explorer state:", error);
          }
        }
        return next;
      });
    },
    [cwd],
  );

  return { expanded, toggle };
}
