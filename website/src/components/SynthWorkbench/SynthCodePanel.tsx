import { useMemo } from "react";
import { generateSynthSnippets, type SynthSnippetInput } from "../../features/synth/export/synthSnippets";
import { CodePanel } from "../CodePanel";

interface SynthCodePanelProps {
  id?: string;
  className?: string;
  input: SynthSnippetInput;
  onCodepen: () => void;
  exporting: boolean;
  onClose: () => void;
}

export function SynthCodePanel({ id, className, input, onCodepen, exporting, onClose }: SynthCodePanelProps) {
  const snippets = useMemo(() => generateSynthSnippets(input), [input]);
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
