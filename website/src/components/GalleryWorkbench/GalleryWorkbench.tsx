import { useState } from "react";
import { GALLERY_EFFECT_OPTIONS } from "../../features/gallery/model/effects";
import { GalleryCodePanel } from "./GalleryCodePanel";
import { ActionButton } from "../ActionButton";
import { Dock, DockAnimation, DockCamera, DockEffects, DockLighting, DockRendering, DockShadow } from "../Dock";
import { DropOverlay } from "../DropOverlay";
import { GlyphScene } from "../GlyphScene";
import { Inspector } from "../Inspector";
import {
  InstrumentBody,
  InstrumentExportBar,
  InstrumentMain,
  InstrumentMobileTabs,
  InstrumentViewport,
  InstrumentWorkbench,
} from "../InstrumentWorkbench";
import { ModelsSidebar } from "../ModelsSidebar";
import { StatsOverlay } from "../StatsOverlay";
import { CopySceneButton } from "./CopySceneButton";
import styles from "./GalleryWorkbench.module.css";
import { useGalleryWorkbench } from "./hooks/useGalleryWorkbench";

export default function GalleryWorkbench() {
  const [codeOpen, setCodeOpen] = useState(false);
  const view = useGalleryWorkbench();
  if (!view) return null;
  const {
    dropped,
    mobilePanel,
    modelSearch,
    setModelSearch,
    handleRandomPreset,
    modelCategories,
    selectedPresetPickerCategory,
    presetId,
    resetToPreset,
    setMobilePanel,
    selectedPreset,
    inspectorMeshes,
    viewportRef,
    meshUrl,
    renderSceneOptions,
    handleCameraChange,
    setAtlasReason,
    setAnimationClips,
    selectedAnimation,
    sceneOptions,
    runtimeEffect,
    glyphOutput,
    semanticScene,
    setSemanticCell,
    effectState,
    selectedEffectDefinition,
    renderPresentation,
    semanticAvailable,
    atlasReason,
    handleRenderModeChange,
    updateScene,
    semanticCell,
    handleEffectChange,
    updateEffectSettings,
    updateEffectParams,
    animationOptions,
    animationClips,
    setSelectedAnimation,
    perspectiveMode,
    perspectivePx,
  } = view;

  return (
    <InstrumentWorkbench
      kind="gallery"
      className={`${styles.root} dn-root dn-root--gallery${dropped.dropActive ? " dn-root--drop-active" : ""}`}
      onDragEnter={dropped.handleDragEnter}
      onDragOver={dropped.handleDragOver}
      onDragLeave={dropped.handleDragLeave}
      onDrop={dropped.handleDrop}
    >
      <InstrumentBody>
        <ModelsSidebar
          id="gallery-models-panel"
          className={mobilePanel === "models" ? "is-mobile-open" : ""}
          modelSearch={modelSearch}
          onModelSearchChange={setModelSearch}
          onImportClick={() => dropped.fileInputRef.current?.click()}
          fileInputRef={dropped.fileInputRef}
          onFileInputChange={dropped.handleFileInputChange}
          onRandomPreset={handleRandomPreset}
          modelCategories={modelCategories}
          activeCategoryId={selectedPresetPickerCategory}
          presetId={presetId}
          onPresetClick={(id) => {
            resetToPreset(id, { updateRoute: true });
            setMobilePanel(null);
          }}
          attribution={selectedPreset.attribution}
        />

        <InstrumentMain>
          <InstrumentViewport elementRef={viewportRef}>
            <GlyphScene
              meshUrl={meshUrl}
              selectedPreset={selectedPreset}
              options={renderSceneOptions}
              onCameraChange={handleCameraChange}
              onAtlasAvailability={setAtlasReason}
              onAnimationInfoChange={({ clips }) => {
                setAnimationClips(clips);
              }}
              selectedAnimation={selectedAnimation}
              animationPaused={sceneOptions.animationPaused}
              animationTimeScale={sceneOptions.animationTimeScale}
              effect={runtimeEffect}
              semanticOutput={glyphOutput === "semantic" ? semanticScene : null}
              onSemanticCellLineage={setSemanticCell}
            />
          </InstrumentViewport>
          <InstrumentExportBar>
            <CopySceneButton />
            <ActionButton
              data-export-trigger
              type="button"
              className={codeOpen ? "is-active" : ""}
              onClick={() => setCodeOpen((open) => !open)}
              aria-controls="gallery-code-panel"
              aria-expanded={codeOpen}
            >
              Export
            </ActionButton>
          </InstrumentExportBar>
          {(codeOpen || mobilePanel === "code") && (
            <GalleryCodePanel
              onClose={() => {
                setCodeOpen(false);
                setMobilePanel(null);
              }}
              id="gallery-code-panel"
              meshUrl={meshUrl}
              options={renderSceneOptions}
              selectedPreset={selectedPreset}
              className={mobilePanel === "code" ? "is-mobile-open" : ""}
              effectState={effectState}
              effectDefinition={selectedEffectDefinition}
            />
          )}
          <Inspector meshes={inspectorMeshes} onColorChange={() => {}} />
          <StatsOverlay anchor="top-left" container={viewportRef.current} />
          <DropOverlay active={dropped.dropActive} />
        </InstrumentMain>

        <Dock id="gallery-controls-panel" className={mobilePanel === "controls" ? "is-mobile-open" : ""}>
          <DockRendering
            renderMode={renderPresentation}
            semanticAvailable={semanticAvailable}
            featureEdges={sceneOptions.featureEdges}
            glyphPalette={sceneOptions.glyphPalette}
            charMode={sceneOptions.charMode}
            wireframeJunctions={sceneOptions.wireframeJunctions}
            hiddenLines={sceneOptions.hiddenLines}
            solidWeightRamp={sceneOptions.solidWeightRamp}
            colorEncoding={sceneOptions.colorEncoding}
            atlasReason={atlasReason}
            density={sceneOptions.density}
            dragDensity={sceneOptions.dragDensity}
            useColors={sceneOptions.useColors}
            smoothShading={sceneOptions.smoothShading}
            creaseAngle={sceneOptions.creaseAngle}
            onRenderModeChange={handleRenderModeChange}
            onUpdateScene={updateScene}
            semanticDetails={
              glyphOutput === "semantic" && semanticScene ? (
                <section className="gallery-semantic-details" aria-label="Semantic rendering details">
                  <ul className="gallery-semantic-details__legend" aria-label="Semantic dictionary legend">
                    {semanticScene.dictionary.classes.map((entry) => (
                      <li key={entry.id}>
                        <i style={{ backgroundColor: entry.controlColor }} />
                        <code>{entry.semanticGlyph}</code>
                        <span>{entry.name}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="gallery-semantic-details__lineage">
                    {semanticCell ? (
                      <>
                        polygon {semanticCell.polygonIndex} → {semanticCell.surfaceId} → {semanticCell.instanceId} →{" "}
                        {semanticCell.className}
                      </>
                    ) : (
                      "Select a rendered semantic cell to inspect its depth-winning lineage."
                    )}
                  </p>
                </section>
              ) : null
            }
          />
          <DockEffects
            effectState={effectState}
            definition={selectedEffectDefinition}
            effectOptions={GALLERY_EFFECT_OPTIONS}
            onEffectChange={handleEffectChange}
            onUpdateSettings={updateEffectSettings}
            onUpdateParams={updateEffectParams}
          />
          <DockAnimation
            selectedAnimation={selectedAnimation}
            animationOptions={animationOptions}
            animationPaused={sceneOptions.animationPaused}
            animationTimeScale={sceneOptions.animationTimeScale}
            animationClipCount={animationClips.length}
            onAnimationChange={setSelectedAnimation}
            onSelectAnimationClear={() => setSelectedAnimation("")}
            onUpdateScene={updateScene}
          />
          <DockCamera
            autoCenter={sceneOptions.autoCenter}
            autoRotate={sceneOptions.autoRotate}
            interactive={sceneOptions.interactive}
            dragMode={sceneOptions.dragMode}
            fpvLook={sceneOptions.fpvLook}
            fpvMove={sceneOptions.fpvMove}
            fpvJump={sceneOptions.fpvJump}
            fpvCrouch={sceneOptions.fpvCrouch}
            fpvMoveSpeed={sceneOptions.fpvMoveSpeed}
            fpvJumpVelocity={sceneOptions.fpvJumpVelocity}
            fpvGravity={sceneOptions.fpvGravity}
            fpvEyeHeight={sceneOptions.fpvEyeHeight}
            fpvCrouchHeight={sceneOptions.fpvCrouchHeight}
            fpvLookSensitivity={sceneOptions.fpvLookSensitivity}
            fpvInvertY={sceneOptions.fpvInvertY}
            perspectiveMode={perspectiveMode}
            perspectivePx={perspectivePx}
            perspective={sceneOptions.perspective}
            zoom={sceneOptions.zoom}
            rotX={sceneOptions.rotX}
            rotY={sceneOptions.rotY}
            target={sceneOptions.target}
            selectedPreset={selectedPreset}
            onUpdateScene={updateScene}
          />
          <DockLighting
            lightAzimuth={sceneOptions.lightAzimuth}
            lightElevation={sceneOptions.lightElevation}
            lightIntensity={sceneOptions.lightIntensity}
            lightColor={sceneOptions.lightColor}
            ambientIntensity={sceneOptions.ambientIntensity}
            ambientColor={sceneOptions.ambientColor}
            onUpdateScene={updateScene}
          />
          <DockShadow
            shadowEnabled={sceneOptions.shadowEnabled}
            shadowOpacity={sceneOptions.shadowOpacity}
            shadowLift={sceneOptions.shadowLift}
            shadowColor={sceneOptions.shadowColor}
            shadowCast={sceneOptions.shadowCast}
            shadowReceive={sceneOptions.shadowReceive}
            shadowFloor={sceneOptions.shadowFloor}
            onUpdateScene={updateScene}
          />
        </Dock>
      </InstrumentBody>

      <InstrumentMobileTabs
        label="Gallery panels"
        items={[
          {
            id: "models",
            label: "Models",
            controls: "gallery-models-panel",
            expanded: mobilePanel === "models",
            onClick: () => setMobilePanel((panel) => (panel === "models" ? null : "models")),
          },
          {
            id: "random",
            label: "Random",
            controls: "gallery-models-panel",
            expanded: false,
            onClick: () => {
              handleRandomPreset();
              setMobilePanel(null);
            },
          },
          {
            id: "controls",
            label: "Controls",
            controls: "gallery-controls-panel",
            expanded: mobilePanel === "controls",
            onClick: () => setMobilePanel((panel) => (panel === "controls" ? null : "controls")),
          },
          {
            id: "code",
            label: "Export",
            controls: "gallery-code-panel",
            expanded: mobilePanel === "code",
            onClick: () => setMobilePanel((panel) => (panel === "code" ? null : "code")),
          },
        ]}
      />
    </InstrumentWorkbench>
  );
}
