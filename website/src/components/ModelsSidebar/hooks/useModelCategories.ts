import { useEffect, useState } from "react";

export function useModelCategories(presetId: string, activeCategoryId: string, search: string) {
  const query = search.trim().toLowerCase();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ [activeCategoryId]: true });
  const [searchExpansion, setSearchExpansion] = useState<{ query: string; expanded: Record<string, boolean> }>({
    query: "",
    expanded: {},
  });

  useEffect(() => {
    setSearchExpansion((current) => (current.query === query ? current : { query, expanded: {} }));
  }, [query]);

  // Random picks and imported models reveal their category without closing others.
  useEffect(() => {
    setExpanded((current) => (current[activeCategoryId] ? current : { ...current, [activeCategoryId]: true }));
  }, [presetId, activeCategoryId]);

  return {
    isOpen: (id: string) =>
      query
        ? searchExpansion.query === query
          ? (searchExpansion.expanded[id] ?? true)
          : true
        : (expanded[id] ?? false),
    setOpen: (id: string, open: boolean) => {
      if (query) {
        // A new query reveals its matches; clearing it restores the browsing state.
        setSearchExpansion((current) => ({
          query,
          expanded: { ...(current.query === query ? current.expanded : {}), [id]: open },
        }));
      } else {
        setExpanded((current) => ({ ...current, [id]: open }));
      }
    },
  };
}
