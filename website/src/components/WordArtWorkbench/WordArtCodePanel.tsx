import { useMemo } from "react";
import { generateWordArtSnippets, type WordArtSnippetInput } from "../../features/wordart/export/wordartSnippets";
import { CodePanel } from "../CodePanel";

interface WordArtCodePanelProps {
  id?: string;
  className?: string;
  input: WordArtSnippetInput;
  onCodepen: () => void;
  exporting: boolean;
  onClose: () => void;
}

export function WordArtCodePanel({ id, className, input, onCodepen, exporting, onClose }: WordArtCodePanelProps) {
  const snippets = useMemo(() => generateWordArtSnippets(input), [input]);
  return (
    <CodePanel
      id={id}
      className={className}
      snippets={snippets}
      onClose={onClose}
      codepen={{ onClick: onCodepen, busy: exporting }}
    />
  );
}
