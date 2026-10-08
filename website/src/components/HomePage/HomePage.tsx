import type { ReactNode } from "react";
import { highlight, installCmds } from "../../features/home/content";
import styles from "./HomePage.module.css";
export function HomePage({
  hero,
  rule,
  diagram,
  frameworks,
  stars,
  version,
}: {
  hero: ReactNode;
  rule: ReactNode;
  diagram: ReactNode;
  frameworks: ReactNode;
  stars: ReactNode;
  version: ReactNode;
}) {
  return (
    <div className={`${styles.root} home`}>
      <section className="hero hero--ascii" id="hero">
        <div className="hero-scene" aria-hidden="true">
          {hero}
        </div>
        <div className="hero-overlay">
          <h1 className="hero-wordmark" aria-label="glyphcss">
            <span className="wm-a">glyph</span>
            <span className="wm-b">css</span>
          </h1>
          <p className="hero-tag">
            <span className="hero-prompt">&gt;</span>
            Turn 3D models into ASCII art, rendered as text in a single
            <code>&lt;pre&gt;</code>. No WebGL. No <code>&lt;canvas&gt;</code> — inspect, hover, and click every cell.
          </p>
          <p className="hero-tag">
            <span className="hero-prompt">&gt;</span>
            Load OBJ, glTF, GLB, STL, and MagicaVoxel VOX — with UV textures and material colors. Works with vanilla JS,
            React, and Vue, or straight in your terminal.
          </p>
          {rule}
          <div className="hero-actions">
            <a
              className="hero-btn"
              href="https://github.com/apresmoi/glyphcss"
              target="_blank"
              rel="noopener noreferrer"
            >
              [ View on GitHub {stars} ]
            </a>
            <a className="hero-btn ghost" href="/gallery">
              [ Browse gallery ]
            </a>
          </div>
          <div className="hero-runtimes">
            <span>runtimes:</span>
            <span className="hero-chip">vanilla&nbsp;js</span>
            <span className="hero-chip">react</span>
            <span className="hero-chip">vue</span>
          </div>
        </div>
      </section>

      <section className="install" id="install">
        <div className="term-section-rule">
          <span className="term-section-label">[ INSTALLATION ]</span>
        </div>
        <div className="install-list">
          <div className="install-row">
            <p className="install-label">
              <span className="term-dim">┌─</span> package managers <span className="term-dim">─┐</span>
            </p>
            <div className="install-content">
              {installCmds.map((cmd) => (
                <div className="term-cmd-frame" key={cmd.code}>
                  <div className="term-cmd-bar">
                    <span className="term-dot r"></span>
                    <span className="term-dot y"></span>
                    <span className="term-dot g"></span>
                    <span className="term-cmd-title">terminal</span>
                  </div>
                  <pre className="dark-scrollbar term-cmd-pre">
                    <span className="term-prompt">$</span>{" "}
                    <code className="language-bash hljs" dangerouslySetInnerHTML={{ __html: cmd.highlighted }} />
                  </pre>
                </div>
              ))}
            </div>
          </div>
          <div className="install-row">
            <p className="install-label">
              <span className="term-dim">┌─</span> cdn <span className="term-dim">─┐</span>
            </p>
            <div className="install-content">
              <div className="term-cmd-frame">
                <div className="term-cmd-bar">
                  <span className="term-dot r"></span>
                  <span className="term-dot y"></span>
                  <span className="term-dot g"></span>
                  <span className="term-cmd-title">index.html</span>
                </div>
                <pre className="dark-scrollbar term-cmd-pre">
                  <code
                    className="language-html hljs"
                    dangerouslySetInnerHTML={{
                      __html: highlight(
                        '<script type="module" src="https://esm.sh/glyphcss/elements"></script>',
                        "html",
                      ),
                    }}
                  />
                </pre>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="stacking" id="how-it-works">
        <div className="term-section-rule">
          <span className="term-section-label">[ HOW IT WORKS ]</span>
        </div>
        <div className="stacking-copy">
          <div className="stacking-diagram" aria-hidden="true">
            {diagram}
          </div>
          <p>
            <span className="term-prompt-inline">&gt;</span>
            glyphcss loads OBJ, glTF, GLB, STL, and VOX mesh files. Each scene renders into a single{" "}
            <code>&lt;pre&gt;</code>: the rasteriser projects every polygon, fills a <code>cols × rows</code> character
            grid, and writes one string to <code>textContent</code> per render. There are no per-polygon DOM nodes and
            no <code>matrix3d</code>.
          </p>
          <p>
            <span className="term-prompt-inline">&gt;</span>
            Interactivity is opt-in and sparse: drop a <code>&lt;GlyphHotspot&gt;</code>
            at any 3D anchor and glyphcss emits one absolutely-positioned
            <code>&lt;div&gt;</code> over the projected cell. Real DOM events, real <code>:hover</code> styles, real{" "}
            <code>role="button"</code>
            accessibility — without one DOM node per polygon.
          </p>
          <p className="stacking-actions">
            <a className="term-link-btn" href="/core-concepts">
              [ → core concepts ]
            </a>
          </p>
        </div>
      </section>

      <section className="getting-started" id="getting-started">
        <div className="term-section-rule">
          <span className="term-section-label">[ HELLO WORLD ]</span>
        </div>
        <div className="getting-lede">
          <p>
            <span className="term-prompt-inline">&gt;</span>
            glyphcss provides custom elements (<code>&lt;glyph-scene&gt;</code>, <code>&lt;glyph-mesh&gt;</code>), an
            imperative <code>createGlyphScene</code> API, and optional React / Vue bindings. Use whichever entry point
            fits your stack.
          </p>
        </div>
        <div className="getting-grid">
          <div className="getting-content">
            {frameworks}
            <p className="getting-actions">
              <a className="term-link-btn" href="/api/headless">
                [ → api reference ]
              </a>
            </p>
          </div>
        </div>
      </section>

      <footer className="term-footer">
        <div className="term-footer-bar">
          <span className="term-footer-seg">{version}</span>
          <span className="term-footer-sep">──</span>
          <span className="term-footer-seg">[ MIT ]</span>
          <span className="term-footer-sep">──</span>
          <a
            className="term-footer-seg term-footer-link"
            href="https://github.com/apresmoi/glyphcss"
            target="_blank"
            rel="noopener noreferrer"
          >
            [ github.com/apresmoi/glyphcss ]
          </a>
          <span className="term-footer-sep">──</span>
          <span className="term-footer-seg">[ uptime: ∞ ]</span>
        </div>
      </footer>
    </div>
  );
}
