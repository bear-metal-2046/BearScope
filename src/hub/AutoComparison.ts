// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import Log from "../shared/log/Log";
import { removeMergePrefix } from "../shared/log/LogKeyUtils";
import { AUTONOMOUS_KEYS, ENABLED_KEYS, getRobotStateRanges } from "../shared/log/RobotState";
import { readPoses } from "./PathPlannerReplay";
import {
  diagnosticSource,
  readDiagnosticCommands,
  type DiagnosticRow,
  type DiagnosticsPreset
} from "./RobotDiagnostics";

const modes = new Set([...ENABLED_KEYS, ...AUTONOMOUS_KEYS].flatMap((key) => [key, "/" + key]));
const poseName = /(?:^|\/)(?:PathPlanner\/currentPose|Chassis\/OdometryPose)$/;
type Run = {
  label: string;
  start: number;
  duration: number;
  poses: ReturnType<typeof readPoses>;
  events: DiagnosticRow[];
};

export function compareRuns(log: Log, preset: DiagnosticsPreset): Run[] {
  const groups = Map.groupBy(log.getFieldKeys(), diagnosticSource);
  const runs: Run[] = [];
  for (const [source, keys] of groups) {
    const state = new Log();
    for (const key of keys) {
      const logical = removeMergePrefix(key);
      const field = log.getField(key);
      if (modes.has(logical) && field) state.setField(logical, field);
    }
    const poseKeys = keys.filter((key) => poseName.test(removeMergePrefix(key)));
    poseKeys.sort((a, b) => Number(b.endsWith("/currentPose")) - Number(a.endsWith("/currentPose")));
    const ranges = getRobotStateRanges(state).filter(({ mode }) => mode === "auto");
    if (!ranges.length) continue;
    const traces = poseKeys.map((key) => readPoses(log, key)).filter((samples) => samples.length > 1);
    if (!traces.length) continue;
    const commands = readDiagnosticCommands(log, keys, preset.commandPrefix);
    ranges.forEach(({ start, end }, index) => {
      const finish = end ?? Math.max(...traces.map((samples) => samples.at(-1)!.time));
      if (finish <= start) return;
      const samples = traces
        .map((poses) => poses.filter(({ time }) => time >= start && time <= finish))
        .find((poses) => poses.length > 1);
      if (!samples) return;
      runs.push({
        label: `${source || "Primary log"} · auto ${index + 1} (${start.toFixed(2)} s)`,
        start,
        duration: finish - start,
        poses: samples,
        events: commands.filter(({ time }) => time !== undefined && time >= start && time <= finish)
      });
    });
  }
  return runs;
}

export default class AutoComparison {
  private readonly a: HTMLSelectElement;
  private readonly b: HTMLSelectElement;
  private readonly time: HTMLInputElement;
  private runs: Run[] = [];
  private enabled = false;
  private log?: Log;
  private preset?: DiagnosticsPreset;

  constructor(private readonly root: HTMLElement) {
    this.a = root.querySelector(".diagnostics-auto-a")!;
    this.b = root.querySelector(".diagnostics-auto-b")!;
    this.time = root.querySelector(".diagnostics-auto-time")!;
    this.a.onchange = this.b.onchange = () => {
      this.time.value = "0";
      this.paint();
    };
    this.time.oninput = () => this.paint();
    root.querySelector<HTMLButtonElement>(".diagnostics-compare-autos")!.onclick = () => {
      this.enabled = true;
      this.refresh();
    };
  }

  getActiveFields(log: Log) {
    return this.enabled
      ? log.getFieldKeys().filter((key) => modes.has(removeMergePrefix(key)) || poseName.test(removeMergePrefix(key)))
      : [];
  }

  update(log: Log, preset: DiagnosticsPreset, refresh: boolean) {
    if (this.enabled && (refresh || this.log !== log || this.preset !== preset)) {
      this.log = log;
      this.preset = preset;
      this.refresh();
    } else {
      this.log = log;
      this.preset = preset;
    }
  }

  private refresh() {
    if (!this.log || !this.preset) return;
    this.runs = compareRuns(this.log, this.preset);
    for (const [select, fallback] of [
      [this.a, 0],
      [this.b, 1]
    ] as const) {
      const value = select.value;
      select.replaceChildren(...this.runs.map(({ label }) => new Option(label, label)));
      select.value = value;
      if (select.selectedIndex < 0) select.selectedIndex = Math.min(this.runs.length - 1, fallback);
    }
    this.paint();
  }

  private paint() {
    const first = this.runs[this.a.selectedIndex];
    const second = this.runs[this.b.selectedIndex];
    const trails = this.root.querySelector(".diagnostics-auto-trails")!;
    const events = this.root.querySelector(".diagnostics-auto-events")!;
    trails.replaceChildren();
    events.replaceChildren();
    const status = this.root.querySelector(".diagnostics-auto-status")!;
    const clock = this.root.querySelector(".diagnostics-auto-clock")!;
    if (!first || !second || first === second) {
      status.textContent =
        "Choose two distinct runs. Merge a second log if needed. Each run needs autonomous mode and recorded pose data.";
      this.time.disabled = true;
      clock.textContent = "";
      return;
    }
    status.textContent = "Trails use the same scale and blue-origin coordinates.";
    this.time.disabled = false;
    this.time.max = String(Math.max(first.duration, second.duration));
    const elapsed = this.time.valueAsNumber;
    clock.textContent = elapsed.toFixed(2) + " s after auto start";
    const bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    for (const { poses } of [first, second]) {
      for (const {
        pose: {
          translation: [x, y]
        }
      } of poses) {
        bounds.minX = Math.min(bounds.minX, x);
        bounds.minY = Math.min(bounds.minY, y);
        bounds.maxX = Math.max(bounds.maxX, x);
        bounds.maxY = Math.max(bounds.maxY, y);
      }
    }
    const scale = Math.min(216 / Math.max(1, bounds.maxX - bounds.minX), 136 / Math.max(1, bounds.maxY - bounds.minY));
    const coords = ([x, y]: number[]) => [12 + (x - bounds.minX) * scale, 148 - (y - bounds.minY) * scale] as const;
    for (const [run, color] of [
      [first, "#ffe300"],
      [second, "#56dfff"]
    ] as const) {
      const card = document.createElement("div");
      const title = document.createElement("strong");
      title.textContent = run.label;
      const canvas = document.createElement("canvas");
      canvas.width = 240;
      canvas.height = 160;
      canvas.setAttribute("aria-label", run.label + " recorded trail");
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#181818";
      ctx.fillRect(0, 0, 240, 160);
      ctx.strokeStyle = color;
      ctx.beginPath();
      run.poses.forEach(({ pose }, index) => {
        const [x, y] = coords(pose.translation);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      const cursor = run.poses.findLast(({ time }) => time <= run.start + elapsed);
      if (cursor) {
        ctx.fillStyle = "#fff";
        ctx.beginPath();
        ctx.arc(...coords(cursor.pose.translation), 4, 0, Math.PI * 2);
        ctx.fill();
      }
      const jump = document.createElement("button");
      jump.type = "button";
      jump.textContent = "Jump to this run";
      jump.onclick = () => window.selection.setSelectedTime(run.start + Math.min(elapsed, run.duration));
      card.append(title, canvas, jump);
      trails.append(card);
      const list = document.createElement("div");
      list.textContent = run.events.length ? "" : "No structured command events in this run.";
      for (const event of run.events.slice(0, 40)) {
        const button = document.createElement("button");
        const relative = event.time! - run.start;
        button.type = "button";
        button.textContent = `${relative.toFixed(2)} s · ${event.label} · ${event.value}`;
        button.onclick = () => {
          this.time.value = String(relative);
          window.selection.setSelectedTime(event.time!);
          this.paint();
        };
        list.append(button);
      }
      events.append(list);
    }
  }
}
