import { useEffect, useState } from "react";
import type { ComboOption } from "@/components/combobox";

const SEARCH_DEBOUNCE_MS = 200;

export type OptionSearch = (query: string) => Promise<ComboOption[]>;

/** What `search` finds for the typed `query` while a list is `open`; typing is debounced, opening is not. A failed search finds nothing. */
export function useSearchedOptions(search: OptionSearch | undefined, open: boolean, query: string): ComboOption[] {
  const [found, setFound] = useState<ComboOption[]>([]);

  useEffect(() => {
    if (!search || !open) return;
    let current = true;
    const timer = setTimeout(
      () => {
        search(query)
          .then((results) => current && setFound(results))
          .catch(() => current && setFound([]));
      },
      query ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [search, open, query]);

  return found;
}
