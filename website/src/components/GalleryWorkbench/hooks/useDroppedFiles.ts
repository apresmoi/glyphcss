import { useCallback, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type RefObject, type SetStateAction } from "react";
import type { DroppedModelSource, PresetModel } from "../types";
import { labelFromFile } from "../presets";

const DROPPED_MESH_EXTENSIONS = new Set(["obj", "glb", "vox"]);

const DEFAULT_COLOR = "#8b95a1";

function fileListToArray(fileList: FileList | null): File[] {
  const files: File[] = [];
  if (!fileList) return files;
  for (let i = 0; i < fileList.length; i += 1) {
    const file = fileList.item(i);
    if (file) files.push(file);
  }
  return files;
}

function dataTransferHasFiles(dataTransfer: DataTransfer): boolean {
  for (let i = 0; i < dataTransfer.types.length; i += 1) {
    if (dataTransfer.types[i] === "Files") return true;
  }
  return false;
}

function fileExtension(name: string): string {
  const clean = name.split("?")[0].split("#")[0];
  const dot = clean.lastIndexOf(".");
  return dot >= 0 ? clean.slice(dot + 1).toLowerCase() : "";
}

function droppedKindForFile(file: File): DroppedModelSource["kind"] | null {
  const ext = fileExtension(file.name);
  if (ext === "obj" || ext === "glb" || ext === "vox") return ext;
  return null;
}

function droppedSourceFromFiles(files: File[], id: string): DroppedModelSource | null {
  const primaryFile = files.find((file) => DROPPED_MESH_EXTENSIONS.has(fileExtension(file.name)));
  if (!primaryFile) return null;

  const kind = droppedKindForFile(primaryFile);
  if (!kind) return null;

  const label = labelFromFile(primaryFile.name) || primaryFile.name;
  const preset: PresetModel = {
    id,
    label,
    kind,
    category: "Dropped",
    url: "",
    zoom: kind === "vox" ? 0.4 : 0.35,
    rotX: 65,
    rotY: 45,
    attribution: { creator: "Local file" },
  };

  return {
    id,
    label,
    kind,
    primaryFile,
    files,
    preset,
  };
}

export interface UseDroppedFilesOptions {
  onDroppedSource: (source: DroppedModelSource) => void;
  onDropError: (message: string) => void;
}

export interface UseDroppedFilesResult {
  droppedSource: DroppedModelSource | null;
  setDroppedSource: Dispatch<SetStateAction<DroppedModelSource | null>>;
  dropActive: boolean;
  fileInputRef: RefObject<HTMLInputElement | null>;
  handleDragEnter: (event: DragEvent<HTMLDivElement>) => void;
  handleDragOver: (event: DragEvent<HTMLDivElement>) => void;
  handleDragLeave: (event: DragEvent<HTMLDivElement>) => void;
  handleDrop: (event: DragEvent<HTMLDivElement>) => void;
  handleFileInputChange: (event: ChangeEvent<HTMLInputElement>) => void;
  handleDroppedFiles: (files: File[]) => void;
}

export function useDroppedFiles({ onDroppedSource, onDropError }: UseDroppedFilesOptions): UseDroppedFilesResult {
  const [droppedSource, setDroppedSource] = useState<DroppedModelSource | null>(null);
  const [dropActive, setDropActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dropDepthRef = useRef(0);
  const droppedIdRef = useRef(0);

  const handleDroppedFiles = useCallback((files: File[]) => {
    const source = droppedSourceFromFiles(
      files,
      `dropped-${Date.now().toString(36)}-${(droppedIdRef.current += 1).toString(36)}`,
    );
    if (!source) {
      onDropError("Drop an .obj, .glb, or .vox file.");
      return;
    }
    setDroppedSource(source);
    onDroppedSource(source);
  }, [onDroppedSource, onDropError]);

  const handleFileInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    handleDroppedFiles(fileListToArray(event.currentTarget.files));
    event.currentTarget.value = "";
  }, [handleDroppedFiles]);

  const handleDragEnter = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dropDepthRef.current += 1;
    setDropActive(true);
  }, []);

  const handleDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setDropActive(true);
  }, []);

  const handleDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dropDepthRef.current = Math.max(0, dropDepthRef.current - 1);
    if (dropDepthRef.current === 0) setDropActive(false);
  }, []);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    if (!dataTransferHasFiles(event.dataTransfer)) return;
    event.preventDefault();
    dropDepthRef.current = 0;
    setDropActive(false);
    handleDroppedFiles(fileListToArray(event.dataTransfer.files));
  }, [handleDroppedFiles]);

  return {
    droppedSource,
    setDroppedSource,
    dropActive,
    fileInputRef,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInputChange,
    handleDroppedFiles,
  };
}
