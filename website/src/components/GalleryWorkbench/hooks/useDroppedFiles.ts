import { useCallback, useRef, useState, type ChangeEvent, type Dispatch, type DragEvent, type RefObject, type SetStateAction } from "react";
import type { DroppedModelSource, PresetModel, ParserOptionsState } from "../types";
import { labelFromFile } from "../presets";

const DROPPED_MESH_EXTENSIONS = new Set(["obj", "glb", "vox"]);

const DEFAULT_COLOR = "#8b95a1";

interface DroppedFileIndex {
  byPath: Map<string, File>;
  byBasename: Map<string, File[]>;
}

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

function droppedFilePath(file: File): string {
  const withRelativePath = file as File & { webkitRelativePath?: string };
  return withRelativePath.webkitRelativePath || file.name;
}

function normalizeDroppedPath(value: string): string {
  let normalized = value.trim().replace(/\\+/g, "/").replace(/^\.\/+/, "");
  try {
    normalized = decodeURIComponent(normalized);
  } catch {
    // Keep the original path when it is not URI encoded.
  }
  return normalized.toLowerCase();
}

function droppedBasename(value: string): string {
  const normalized = normalizeDroppedPath(value);
  return normalized.split("/").pop() ?? normalized;
}

function buildDroppedFileIndex(files: File[]): DroppedFileIndex {
  const byPath = new Map<string, File>();
  const byBasename = new Map<string, File[]>();
  for (const file of files) {
    const path = normalizeDroppedPath(droppedFilePath(file));
    byPath.set(path, file);
    byPath.set(normalizeDroppedPath(file.name), file);

    const base = droppedBasename(file.name);
    const bucket = byBasename.get(base) ?? [];
    bucket.push(file);
    byBasename.set(base, bucket);
  }
  return { byPath, byBasename };
}

function findDroppedFile(index: DroppedFileIndex, path: string): File | null {
  const normalized = normalizeDroppedPath(path);
  return index.byPath.get(normalized) ?? index.byBasename.get(droppedBasename(normalized))?.[0] ?? null;
}

function extractObjMtllibRefs(objText: string): string[] {
  const refs: string[] = [];
  for (const raw of objText.split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("mtllib ")) continue;
    const rest = line.slice(7).trim();
    if (!rest) continue;
    refs.push(rest);
    for (const token of rest.split(/\s+/)) {
      if (token.toLowerCase().endsWith(".mtl")) refs.push(token);
    }
  }
  return Array.from(new Set(refs));
}

export function findDroppedMtlFiles(objText: string, files: File[], index: DroppedFileIndex): File[] {
  const matched = new Map<string, File>();
  for (const ref of extractObjMtllibRefs(objText)) {
    const file = findDroppedFile(index, ref);
    if (file) matched.set(droppedFilePath(file), file);
  }
  if (matched.size > 0) return Array.from(matched.values());

  const mtlFiles = files.filter((file) => fileExtension(file.name) === "mtl");
  return mtlFiles.length === 1 ? mtlFiles : [];
}

export function buildDroppedFileIndexExport(files: File[]): DroppedFileIndex {
  return buildDroppedFileIndex(files);
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
    options: {
      targetSize: 60,
      gridShift: kind === "vox" ? 0 : 1,
      defaultColor: DEFAULT_COLOR,
    },
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
