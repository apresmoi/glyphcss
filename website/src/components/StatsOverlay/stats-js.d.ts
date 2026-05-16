declare module "stats-js/src/Stats.js" {
  interface StatsPanel {
    dom: HTMLCanvasElement;
    update(value: number, maxValue: number): void;
  }

  export default class Stats {
    REVISION: number;
    dom: HTMLDivElement;
    domElement: HTMLDivElement;
    addPanel(panel: StatsPanel): StatsPanel;
    showPanel(id: number): void;
    setMode(id: number): void;
    begin(): void;
    end(): number;
    update(): void;
  }
}
