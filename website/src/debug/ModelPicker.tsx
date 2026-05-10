import { useMemo, useState } from "react";

export interface ModelPickerItem<T extends string> {
  id: T;
  label: string;
  /** Optional grouping. Items without a category land in "Other". */
  category?: string;
}

interface ModelPickerProps<T extends string> {
  items: ModelPickerItem<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Placeholder for the search box. */
  searchPlaceholder?: string;
}

/**
 * Gallery-style picker: search box at top, categorized tree below. Categories
 * are collapsible and show a count. Items without a category fall into
 * "Other". When a search query is active, all categories expand.
 *
 * Designed to slot into a DebugSection — the search input and tree fill
 * whatever width the section gives them.
 */
export function ModelPicker<T extends string>({
  items,
  value,
  onChange,
  searchPlaceholder = "Search…",
}: ModelPickerProps<T>) {
  const [query, setQuery] = useState("");
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({});

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((m) => m.label.toLowerCase().includes(q));
  }, [items, query]);

  // Bucket by category, preserving first-seen order.
  const categories = useMemo(() => {
    const buckets = new Map<string, ModelPickerItem<T>[]>();
    for (const item of filtered) {
      const cat = item.category || "Other";
      let arr = buckets.get(cat);
      if (!arr) { arr = []; buckets.set(cat, arr); }
      arr.push(item);
    }
    return Array.from(buckets.entries()).map(([label, models]) => ({ label, models }));
  }, [filtered]);

  const defaultOpenCategory = categories[0]?.label;
  const selectedCategory = categories.find((cat) =>
    cat.models.some((model) => model.id === value)
  )?.label;
  const isOpen = (cat: string) =>
    query.trim() ? true : cat === selectedCategory || (openMap[cat] ?? cat === defaultOpenCategory);

  const toggle = (cat: string) =>
    setOpenMap((m) => ({ ...m, [cat]: !isOpen(cat) }));

  return (
    <div className="model-picker">
      <input
        className="model-picker__search"
        type="search"
        placeholder={searchPlaceholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />

      {categories.length === 0 ? (
        <div className="model-picker__empty">No matching models</div>
      ) : (
        <div className="model-picker__tree">
          {categories.map((cat) => {
            const open = isOpen(cat.label);
            return (
              <div key={cat.label} className="model-picker__category">
                <button
                  type="button"
                  className="model-picker__heading"
                  onClick={() => toggle(cat.label)}
                  aria-expanded={open}
                >
                  <span className="model-picker__label">
                    <span className={`model-picker__caret${open ? " open" : ""}`}>▸</span>
                    {cat.label}
                  </span>
                  <span className="model-picker__count">{cat.models.length}</span>
                </button>
                {open && (
                  <div className="model-picker__items">
                    {cat.models.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`model-picker__item${m.id === value ? " active" : ""}`}
                        onClick={() => onChange(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
