import { type ReactNode, type Ref, useEffect, useMemo, useRef, useState } from "react";
import { ActionButton } from "../ActionButton";
import { BracketSelect } from "../BracketSelect";
import { CodePanelFrame } from "./CodePanelFrame";
import { highlightSnippet } from "./highlightSnippet";

export interface ExportFormat {
  readonly id: string;
  readonly label: string;
  readonly unavailableReason?: string;
}
const FRAMEWORK_FORMATS: readonly ExportFormat[] = [
  { id: "html", label: "HTML" },
  { id: "vanilla", label: "JS" },
  { id: "react", label: "React" },
  { id: "vue", label: "Vue" },
];
export interface CodePanelProps {
  id?: string;
  className?: string;
  inline?: boolean;
  ref?: Ref<HTMLElement>;
  title?: string;
  snippets: Readonly<Record<string, string>>;
  formats?: readonly ExportFormat[];
  defaultFormat?: string;
  format?: string;
  onFormatChange?: (format: string) => void;
  onClose: () => void;
  settings?: ReactNode;
  codepen?: { onClick: () => void; busy?: boolean };
  unavailableReason?: string;
}
export function CodePanel({
  id,
  className = "",
  inline,
  ref,
  title = "Export",
  snippets,
  formats = FRAMEWORK_FORMATS,
  defaultFormat = "react",
  format: controlledFormat,
  onFormatChange,
  onClose,
  settings,
  codepen,
  unavailableReason,
}: CodePanelProps) {
  const [selectedFormat, setSelectedFormat] = useState(defaultFormat);
  const [copyState, setCopyState] = useState("Copy code");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const copyRequest = useRef(0);
  const enabled = formats.filter(
    (item) => !item.unavailableReason && snippets[item.id] !== undefined && !unavailableReason,
  );
  const requestedFormat = controlledFormat ?? selectedFormat;
  const activeFormat = enabled.find((item) => item.id === requestedFormat)?.id ?? enabled[0]?.id;
  const snippet = activeFormat ? snippets[activeFormat] : undefined;
  const highlighted = useMemo(
    () => (snippet !== undefined && activeFormat ? highlightSnippet(snippet, activeFormat) : undefined),
    [snippet, activeFormat],
  );
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  useEffect(() => {
    setCopyState("Copy code");
    return () => {
      clearTimeout(timer.current);
      copyRequest.current++;
    };
  }, [activeFormat, snippet]);
  const choose = (next: string) => {
    setSelectedFormat(next);
    onFormatChange?.(next);
  };
  const copy = async () => {
    if (snippet === undefined) return;
    const request = ++copyRequest.current;
    try {
      await navigator.clipboard.writeText(snippet);
      if (request !== copyRequest.current) return;
      setCopyState("Copied");
    } catch {
      if (request !== copyRequest.current) return;
      setCopyState("Copy failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopyState("Copy code"), 1200);
  };
  return (
    <CodePanelFrame id={id} ref={ref} inline={inline} className={`gw-code-panel ${className}`} aria-label="Export">
      <header className="gw-code-panel__head">
        <span className="gw-code-panel__legend">[ {title.toUpperCase()} ]</span>
        <BracketSelect
          aria-label="Export format"
          value={activeFormat ?? ""}
          disabled={enabled.length === 0}
          onChange={(event) => choose(event.target.value)}
        >
          {!activeFormat && <option value="">Unavailable</option>}
          {formats.map((item) => {
            const reason =
              unavailableReason ??
              item.unavailableReason ??
              (snippets[item.id] === undefined ? `${item.label} export is not available for this page.` : undefined);
            return (
              <option
                key={item.id}
                value={item.id}
                disabled={!!reason}
                title={reason}
                aria-label={reason ? `${item.label} — ${reason}` : item.label}
              >
                {item.label}
              </option>
            );
          })}
        </BracketSelect>
        <div className="gw-code-panel__actions">
          <ActionButton onClick={copy} title="Copy current snippet" disabled={snippet === undefined}>
            {copyState}
          </ActionButton>
          {codepen && (
            <ActionButton onClick={codepen.onClick} disabled={codepen.busy} title="Open in CodePen">
              {codepen.busy ? "Exporting…" : "CodePen"}
            </ActionButton>
          )}
          <ActionButton onClick={onClose} title="Close export panel" aria-label="Close export panel">
            Close
          </ActionButton>
        </div>
        {settings}
      </header>
      <div className="gw-code-panel__body">
        <pre className="gw-code-panel__code" aria-label="Export code" tabIndex={0}>
          {highlighted !== undefined ? (
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
          ) : (
            <code>{snippet ?? unavailableReason ?? "No code is available for this selection."}</code>
          )}
        </pre>
      </div>
    </CodePanelFrame>
  );
}
