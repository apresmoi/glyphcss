import { type FontEntry } from "@glyphcss/fonts";
import { useEffect, useMemo, useRef, useState } from "react";

/** Searchable font dropdown — filters the catalog as you type, styled list. */
export function FontPicker({
  catalog,
  value,
  onPick,
}: {
  catalog: FontEntry[];
  value: string;
  onPick: (family: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(value);
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    setQuery(value);
  }, [value]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (q ? catalog.filter((f) => f.family.toLowerCase().includes(q)) : catalog).slice(0, 80);
  }, [query, catalog]);
  useEffect(() => {
    const h = (e: PointerEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", h);
    return () => document.removeEventListener("pointerdown", h);
  }, []);
  return (
    <div className="wa-fontpick" ref={wrapRef}>
      <input
        className="wa-input"
        type="text"
        spellCheck={false}
        placeholder={catalog.length ? `search ${catalog.length} fonts…` : "loading…"}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
      />
      {open && results.length > 0 && (
        <ul className="wa-fontpick__list">
          {results.map((f) => (
            <li
              key={f.id}
              className={`wa-fontpick__item ${f.family === value ? "is-active" : ""}`}
              onPointerDown={() => {
                onPick(f.family);
                setQuery(f.family);
                setOpen(false);
              }}
            >
              {f.family}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
