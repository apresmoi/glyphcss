import { useCallback, useMemo, useState } from "react";
import { PRESETS, stripParenthesizedText } from "../../GalleryWorkbench/presets";
import { BUILDER_KIT_CATEGORIES } from "../defaults";

export interface UseSidebarItemsResult {
  modelSearch: string;
  setModelSearch: (s: string) => void;
  modelCategories: Array<{ id: string; label: string; models: Array<{ id: string; label: string; category: string }> }>;
  modelTreeId: string[];
  isCategoryOpen: (id: string) => boolean;
  handleToggleCategory: (id: string) => void;
}

export function useSidebarItems(): UseSidebarItemsResult {
  const [modelSearch, setModelSearch] = useState("");
  const [openCategory, setOpenCategory] = useState<string | null>(BUILDER_KIT_CATEGORIES[0]);

  const presetItems = useMemo(
    () => PRESETS
      .filter((p) => BUILDER_KIT_CATEGORIES.includes(p.category))
      .map((p) => ({ id: p.id, label: stripParenthesizedText(p.label), category: p.category })),
    [],
  );
  const trimmedSearch = modelSearch.trim().toLowerCase();
  const modelCategories = useMemo(() => {
    const filtered = trimmedSearch
      ? presetItems.filter((p) => p.label.toLowerCase().includes(trimmedSearch))
      : presetItems;
    const byCat = new Map<string, typeof filtered>();
    for (const p of filtered) {
      const arr = byCat.get(p.category) ?? [];
      arr.push(p);
      byCat.set(p.category, arr);
    }
    // Fixed kit order: City Kit → Urban Pack → Medieval Village.
    return BUILDER_KIT_CATEGORIES
      .filter((cat) => byCat.has(cat))
      .map((cat) => ({ id: cat, label: cat, models: byCat.get(cat)! }));
  }, [presetItems, trimmedSearch]);
  const modelTreeId = useMemo(() => modelCategories.map((_, i) => `builder-tree-${i}`), [modelCategories]);
  const isCategoryOpen = useCallback(
    (id: string) => (trimmedSearch ? true : openCategory === id),
    [trimmedSearch, openCategory],
  );
  const handleToggleCategory = useCallback((id: string) => setOpenCategory((prev) => (prev === id ? null : id)), []);

  return { modelSearch, setModelSearch, modelCategories, modelTreeId, isCategoryOpen, handleToggleCategory };
}
