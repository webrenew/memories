"use client";

import { useState, useEffect, useRef } from "react";

const style = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Space+Grotesk:wght@300;400;600&display=swap');

  .oc-root, .oc-root * { box-sizing: border-box; margin: 0; padding: 0; }

  .oc-root {
    --violet: #a855f7;
    --violet-dim: #7c3aed;
    --violet-glow: rgba(168, 85, 247, 0.15);
    --green: #4ade80;
    --green-dim: rgba(74, 222, 128, 0.7);
    --card: #0e0e16;
    --card-border: rgba(255,255,255,0.07);
    --text-muted: rgba(255,255,255,0.35);
    --text-dim: rgba(255,255,255,0.55);

    width: 100%;
    font-family: 'JetBrains Mono', monospace;
    color: #e2e8f0;
    background: transparent;
    position: relative;
  }

  .oc-panel-wrap {
    width: 100%;
    position: relative;
    overflow: hidden;
    border-radius: 16px;
  }

  .oc-noise {
    position: absolute;
    inset: 0;
    opacity: 0.025;
    background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
    background-size: 200px 200px;
    pointer-events: none;
    z-index: 0;
  }

  .oc-dot-grid {
    position: absolute;
    inset: 0;
    background-image: radial-gradient(circle, rgba(255,255,255,0.04) 1px, transparent 1px);
    background-size: 28px 28px;
    pointer-events: none;
    z-index: 0;
  }

  .oc-panel {
    position: relative;
    z-index: 1;
    width: 100%;
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 0 0 1px rgba(168,85,247,0.08), 0 40px 80px rgba(0,0,0,0.6), 0 0 60px rgba(88,28,135,0.1);
    animation: oc-fadeUp 0.6s ease both, oc-glowPulse 4s ease-in-out 1s infinite;
  }

  @keyframes oc-fadeUp {
    from { opacity: 0; transform: translateY(24px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes oc-glowPulse {
    0%, 100% { box-shadow: 0 0 0 1px rgba(168,85,247,0.08), 0 40px 80px rgba(0,0,0,0.6), 0 0 60px rgba(88,28,135,0.1); }
    50% { box-shadow: 0 0 0 1px rgba(168,85,247,0.12), 0 40px 80px rgba(0,0,0,0.6), 0 0 80px rgba(88,28,135,0.18); }
  }

  .oc-topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 14px 20px;
    border-bottom: 1px solid var(--card-border);
    background: rgba(255,255,255,0.02);
  }

  .oc-topbar-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .oc-topbar-icon {
    width: 18px;
    height: 18px;
    color: var(--violet);
    flex-shrink: 0;
  }

  .oc-topbar-title {
    font-size: 10px;
    letter-spacing: 0.2em;
    color: var(--text-dim);
    text-transform: uppercase;
    white-space: nowrap;
  }

  .oc-topbar-pills {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .oc-pill {
    font-size: 9px;
    letter-spacing: 0.05em;
    padding: 4px 10px;
    border-radius: 100px;
    border: 1px solid var(--card-border);
    background: rgba(255,255,255,0.03);
    color: var(--text-dim);
    white-space: nowrap;
  }

  .oc-pill-live {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 9px;
    letter-spacing: 0.12em;
    padding: 4px 12px;
    border-radius: 100px;
    border: 1px solid rgba(74,222,128,0.25);
    background: rgba(74,222,128,0.06);
    color: var(--green);
    text-transform: uppercase;
    white-space: nowrap;
  }

  .oc-blink {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--green);
    animation: oc-blink 1.4s ease-in-out infinite;
    box-shadow: 0 0 6px var(--green);
  }

  @keyframes oc-blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }

  .oc-node-row {
    display: grid;
    grid-template-columns: 1fr auto 1fr auto 1fr;
    gap: 0;
    padding: 20px 20px 0;
    align-items: center;
  }

  .oc-node-card {
    background: rgba(255,255,255,0.03);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 14px 16px;
    animation: oc-fadeUp 0.6s ease both;
  }

  .oc-node-card:nth-child(1) { animation-delay: 0.1s; }
  .oc-node-card:nth-child(3) { animation-delay: 0.2s; }
  .oc-node-card:nth-child(5) { animation-delay: 0.3s; }

  .oc-node-icon {
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: rgba(168,85,247,0.15);
    border: 1px solid rgba(168,85,247,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 10px;
    color: var(--violet);
  }

  .oc-node-label {
    font-size: 8px;
    letter-spacing: 0.15em;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-bottom: 4px;
  }

  .oc-node-desc {
    font-size: 9.5px;
    color: var(--text-dim);
    line-height: 1.5;
  }

  .oc-connector {
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
    height: 2px;
  }

  .oc-connector-line {
    width: 100%;
    height: 1px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(168,85,247,0.18), rgba(168,85,247,0.58) 50%, rgba(168,85,247,0.18));
    position: relative;
    overflow: hidden;
  }

  .oc-connector-beam {
    position: absolute;
    top: 50%;
    left: -30%;
    transform: translateY(-50%);
    width: 30px;
    height: 6px;
    border-radius: 999px;
    background: linear-gradient(90deg, rgba(168,85,247,0), rgba(168,85,247,0.98), rgba(168,85,247,0));
    box-shadow: 0 0 14px rgba(168,85,247,0.85);
    animation: oc-beamSweep 2.2s linear infinite;
    pointer-events: none;
  }

  .oc-connector-beam-soft {
    width: 24px;
    opacity: 0.65;
    filter: blur(0.35px);
    animation-duration: 2.8s;
  }

  @keyframes oc-beamSweep {
    0% { left: -30%; opacity: 0; }
    10% { opacity: 1; }
    90% { opacity: 1; }
    100% { left: 110%; opacity: 0; }
  }

  .oc-main-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    padding: 12px 20px 20px;
  }

  .oc-section-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 16px;
    animation: oc-fadeUp 0.6s ease both;
  }

  .oc-section-card:nth-child(1) { animation-delay: 0.35s; }
  .oc-section-card:nth-child(2) { animation-delay: 0.45s; }

  .oc-section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .oc-section-title {
    font-size: 8px;
    letter-spacing: 0.2em;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .oc-synced-badge {
    font-size: 8px;
    letter-spacing: 0.1em;
    color: rgba(168,85,247,0.7);
    text-transform: uppercase;
  }

  .oc-file-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .oc-file-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 10px;
    border-radius: 6px;
    border: 1px solid transparent;
    transition: all 0.2s ease;
    cursor: default;
  }

  .oc-file-row:hover {
    background: rgba(168,85,247,0.06);
    border-color: rgba(168,85,247,0.15);
  }

  .oc-file-row-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .oc-file-icon {
    width: 14px;
    height: 14px;
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .oc-file-name {
    font-size: 10px;
    color: var(--text-dim);
    letter-spacing: 0.02em;
  }

  .oc-check-icon {
    width: 14px;
    height: 14px;
    color: var(--green-dim);
    flex-shrink: 0;
  }

  .oc-trace-list {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .oc-trace-row {
    animation: oc-fadeUp 0.5s ease both;
  }

  .oc-trace-row:nth-child(1) { animation-delay: 0.5s; }
  .oc-trace-row:nth-child(2) { animation-delay: 0.6s; }
  .oc-trace-row:nth-child(3) { animation-delay: 0.7s; }
  .oc-trace-row:nth-child(4) { animation-delay: 0.8s; }

  .oc-trace-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 5px;
  }

  .oc-trace-key {
    font-size: 9.5px;
    color: var(--text-dim);
    letter-spacing: 0.03em;
  }

  .oc-trace-key span {
    color: rgba(168,85,247,0.6);
  }

  .oc-matched {
    font-size: 8px;
    letter-spacing: 0.12em;
    color: var(--green-dim);
    text-transform: uppercase;
  }

  .oc-bar-track {
    height: 3px;
    background: rgba(255,255,255,0.06);
    border-radius: 100px;
    overflow: hidden;
  }

  .oc-bar-fill {
    height: 100%;
    border-radius: 100px;
    background: linear-gradient(90deg, var(--violet-dim), var(--violet));
    box-shadow: 0 0 8px rgba(168,85,247,0.5);
    animation: oc-barGrow 0.8s ease both;
    transform-origin: left;
  }

  @keyframes oc-barGrow {
    from { width: 0 !important; }
  }

  .oc-stats-row {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 12px;
    padding: 0 20px 20px;
    animation: oc-fadeUp 0.6s 0.55s ease both;
  }

  .oc-stat-card {
    background: rgba(255,255,255,0.02);
    border: 1px solid var(--card-border);
    border-radius: 10px;
    padding: 14px 16px;
    transition: border-color 0.2s;
  }

  .oc-stat-card:hover {
    border-color: rgba(168,85,247,0.2);
  }

  .oc-stat-value {
    font-size: 22px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.02em;
    line-height: 1;
    margin-bottom: 4px;
    font-family: 'Space Grotesk', 'JetBrains Mono', sans-serif;
  }

  .oc-stat-label {
    font-size: 8px;
    letter-spacing: 0.15em;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  @media (max-width: 980px) {
    .oc-topbar {
      flex-direction: column;
      align-items: flex-start;
    }
    .oc-topbar-pills {
      width: 100%;
      justify-content: flex-start;
    }
    .oc-node-row {
      grid-template-columns: 1fr;
      gap: 10px;
    }
    .oc-connector {
      display: none;
    }
    .oc-main-grid {
      grid-template-columns: 1fr;
    }
  }
`;

type NodeType = "workspace" | "store" | "runtime";

const files = [
  { name: "AGENTS.md" },
  { name: "SOUL.md" },
  { name: "TOOLS.md" },
  { name: "memory/*.md" },
  { name: "skills/**/*" },
];

const traces = [
  { key: "rules", ns: "project_scope", pct: 95 },
  { key: "facts", ns: "workspace_state", pct: 78 },
  { key: "skills", ns: "tooling_policy", pct: 62 },
  { key: "decisions", ns: "execution_style", pct: 88 },
];

function FileIcon(): React.JSX.Element {
  return (
    <svg className="oc-file-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M2 1.5h7l2.5 2.5v9H2z" strokeLinejoin="round" />
      <path d="M8.5 1.5v3h3" strokeLinejoin="round" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg className="oc-check-icon" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
      <circle cx="7" cy="7" r="5.5" />
      <path d="M4.5 7l2 2 3-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function NodeIcon({ type }: { type: NodeType }): React.JSX.Element {
  if (type === "workspace") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
        <rect x="1" y="1" width="12" height="12" rx="2" />
        <path d="M1 5h12M5 5v8" />
      </svg>
    );
  }
  if (type === "store") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
        <ellipse cx="7" cy="4" rx="5" ry="2" />
        <path d="M2 4v6c0 1.1 2.24 2 5 2s5-.9 5-2V4" />
        <path d="M2 7c0 1.1 2.24 2 5 2s5-.9 5-2" />
      </svg>
    );
  }
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M7 1l5 2.5v5L7 11 2 8.5v-5z" />
      <path d="M7 11v2M2 3.5l5 3 5-3M7 6.5V9" />
    </svg>
  );
}

function MemoryIcon(): React.JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <circle cx="8" cy="8" r="6.5" />
      <path d="M5 8c0-1.66 1.34-3 3-3s3 1.34 3 3-1.34 3-3 3" />
      <circle cx="8" cy="8" r="1" />
    </svg>
  );
}

export function OpenClawHeroIllustration(): React.JSX.Element {
  const [tick, setTick] = useState(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      <style>{style}</style>
      <div className="oc-root" ref={panelRef}>
        <div className="oc-panel-wrap">
          <div className="oc-noise" />
          <div className="oc-dot-grid" />

          <div className="oc-panel">
            <div className="oc-topbar">
              <div className="oc-topbar-left">
                <span className="oc-topbar-icon"><MemoryIcon /></span>
                <span className="oc-topbar-title">Memory Control Plane</span>
              </div>
              <div className="oc-topbar-pills">
                <span className="oc-pill">memories files apply --force</span>
                <span className="oc-pill">workspace hash: stable</span>
                <span className="oc-pill">skills sync: clean</span>
                <span className="oc-pill-live">
                  <span className="oc-blink" />
                  Live Sync
                </span>
              </div>
            </div>

            <div className="oc-node-row">
              <div className="oc-node-card">
                <div className="oc-node-icon"><NodeIcon type="workspace" /></div>
                <div className="oc-node-label">OpenClaw Workspace</div>
                <div className="oc-node-desc">AGENTS + skills + memory files</div>
              </div>

              <div className="oc-connector" style={{ width: 60, padding: "0 4px" }}>
                <div className="oc-connector-line" style={{ width: "100%" }}>
                  <div className="oc-connector-beam" />
                  <div className="oc-connector-beam oc-connector-beam-soft" style={{ animationDelay: "1.1s" }} />
                </div>
              </div>

              <div className="oc-node-card">
                <div className="oc-node-icon"><NodeIcon type="store" /></div>
                <div className="oc-node-label">Memories.sh Store</div>
                <div className="oc-node-desc">durable rules, facts, decisions</div>
              </div>

              <div className="oc-connector" style={{ width: 60, padding: "0 4px" }}>
                <div className="oc-connector-line" style={{ width: "100%" }}>
                  <div className="oc-connector-beam" style={{ animationDelay: "1.2s" }} />
                  <div className="oc-connector-beam oc-connector-beam-soft" style={{ animationDelay: "2.3s" }} />
                </div>
              </div>

              <div className="oc-node-card">
                <div className="oc-node-icon"><NodeIcon type="runtime" /></div>
                <div className="oc-node-label">Agent Runtime</div>
                <div className="oc-node-desc">stable context at prompt time</div>
              </div>
            </div>

            <div className="oc-main-grid">
              <div className="oc-section-card">
                <div className="oc-section-header">
                  <span className="oc-section-title">Workspace Set</span>
                  <span className="oc-synced-badge">Synced</span>
                </div>
                <div className="oc-file-list">
                  {files.map((f) => (
                    <div className="oc-file-row" key={f.name}>
                      <div className="oc-file-row-left">
                        <FileIcon />
                        <span className="oc-file-name">{f.name}</span>
                      </div>
                      <CheckIcon />
                    </div>
                  ))}
                </div>
              </div>

              <div className="oc-section-card">
                <div className="oc-section-header">
                  <span className="oc-section-title">Retrieval Trace</span>
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="rgba(168,85,247,0.5)" strokeWidth="1.3">
                    <circle cx="7" cy="7" r="5.5" />
                    <path d="M7 4v4M7 9.5v.5" strokeLinecap="round" />
                  </svg>
                </div>
                <div className="oc-trace-list">
                  {traces.map((t, i) => (
                    <div className="oc-trace-row" key={`${tick}-${i}`}>
                      <div className="oc-trace-header">
                        <span className="oc-trace-key">
                          <span>{t.key}</span>::{t.ns}
                        </span>
                        <span className="oc-matched">Matched</span>
                      </div>
                      <div className="oc-bar-track">
                        <div
                          className="oc-bar-fill"
                          style={{
                            width: `${t.pct}%`,
                            animationDelay: `${0.5 + i * 0.1}s`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="oc-stats-row">
              <div className="oc-stat-card">
                <div className="oc-stat-value">10+</div>
                <div className="oc-stat-label">Files Synced</div>
              </div>
              <div className="oc-stat-card">
                <div className="oc-stat-value">1:1</div>
                <div className="oc-stat-label">Skill Parity</div>
              </div>
              <div className="oc-stat-card">
                <div className="oc-stat-value">Real<wbr />time</div>
                <div className="oc-stat-label">Drift Checks</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
