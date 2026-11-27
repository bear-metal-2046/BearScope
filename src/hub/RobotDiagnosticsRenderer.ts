// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import type { AdvantageScopeAssets } from "../shared/AdvantageScopeAssets";
import type Log from "../shared/log/Log";
import { NoopRenderer } from "../shared/renderers/TabRenderer";
import { defaultDiagnostics, diagnose, parsePreset, type DiagnosticRow } from "./RobotDiagnostics";

export default class RobotDiagnosticsRenderer extends NoopRenderer {
  private preset = defaultDiagnostics;
  private readonly source: HTMLSelectElement;
  private readonly field: HTMLSelectElement;
  private readonly fieldImage = new Image();
  private assets?: AdvantageScopeAssets | null;
  private evaluatedLog?: Log;
  private previous?: ReturnType<typeof diagnose>;
  private time?: number;
  private updated = -Infinity;

  constructor(
    private readonly root: HTMLElement,
    private readonly tabId: () => string
  ) {
    super();
    this.source = root.querySelector(".diagnostics-log")!;
    this.field = root.querySelector(".diagnostics-field")!;
    this.field.onchange = () => this.drawPoses(this.previous?.fieldPoses ?? []);
    this.fieldImage.onload = () => this.drawPoses(this.previous?.fieldPoses ?? []);
    const editor = root.querySelector<HTMLTextAreaElement>(".diagnostics-preset")!;
    const status = root.querySelector<HTMLElement>(".diagnostics-status")!;
    const showPreset = () => {
      editor.value = JSON.stringify(this.preset, null, 2);
    };
    root.querySelector(".diagnostics-apply")!.addEventListener("click", () => {
      try {
        this.preset = parsePreset(editor.value);
        this.previous = undefined;
        status.textContent = "Applied " + this.preset.name;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Invalid preset.";
      }
    });
    root.querySelector(".diagnostics-reset")!.addEventListener("click", () => {
      this.preset = defaultDiagnostics;
      this.previous = undefined;
      status.textContent = "Restored Bear Metal 2026";
      showPreset();
    });
    this.source.addEventListener("change", () => {
      this.previous = undefined;
    });
    showPreset();

    const prompt = root.querySelector<HTMLTextAreaElement>(".diagnostics-prompt")!;
    root.querySelector(".diagnostics-generate")!.addEventListener("click", () => {
      if (!this.previous) return;
      const { readiness, context, incidents, modules, vision, commands } = this.previous;
      const sections = [
        "Review this robot log summary for inconsistent readings and suspicious timing. Cite timestamps and suggest what to check in the original log.",
        "Preset: " + this.preset.name + " · cursor: " + this.time?.toFixed(2) + " s",
        ...Object.entries({ readiness, context, incidents, modules, vision, commands: commands.slice(-40) }).map(
          ([name, rows]) => name + "\n" + rows.map((row) => JSON.stringify(row)).join("\n")
        )
      ];
      prompt.value = sections.join("\n\n").slice(0, 16000);
    });
    root.querySelector(".diagnostics-copy")!.addEventListener("click", async () => {
      if (!prompt.value.trim()) {
        this.showAnalysis("Prepare a summary first.");
        return;
      }
      try {
        await navigator.clipboard.writeText(prompt.value);
        this.showAnalysis("Copied. Paste the summary into your preferred chat.");
      } catch {
        prompt.select();
        this.showAnalysis("Select and copy the summary with Ctrl+C.");
      }
    });
    root.querySelector(".diagnostics-send")!.addEventListener("click", () => {
      if (!prompt.value.trim()) {
        this.showAnalysis("Prepare a summary first.");
        return;
      }
      this.showAnalysis("Waiting for Claude…");
      root.querySelector<HTMLButtonElement>(".diagnostics-send")!.disabled = true;
      window.sendMainMessage("bearscope-analyze-diagnostics", { id: this.tabId(), prompt: prompt.value });
    });
  }

  showAnalysis(result: string) {
    this.root.querySelector<HTMLTextAreaElement>(".diagnostics-answer")!.value = result;
    this.root.querySelector<HTMLButtonElement>(".diagnostics-send")!.disabled = false;
  }

  override saveState() {
    return JSON.stringify(this.preset);
  }

  override restoreState(state?: unknown) {
    if (typeof state !== "string") return;
    try {
      this.preset = parsePreset(state);
      this.root.querySelector<HTMLTextAreaElement>(".diagnostics-preset")!.value = JSON.stringify(this.preset, null, 2);
      this.previous = undefined;
    } catch {
      /* Retain the built-in preset when an old layout has invalid JSON. */
    }
  }

  private rows(selector: string, rows: DiagnosticRow[]) {
    const panel = this.root.querySelector<HTMLElement>(selector)!;
    panel.replaceChildren();
    if (!rows.length) {
      panel.textContent = "No matching telemetry.";
      return;
    }
    for (const row of rows) {
      const item = document.createElement(row.time === undefined ? "div" : "button");
      item.textContent =
        row.label +
        " — " +
        row.value +
        (row.time === undefined
          ? ""
          : ` · ${row.time.toFixed(2)} s${row.end === undefined ? "" : ` → ${row.end.toFixed(2)} s`}`);
      if (item instanceof HTMLButtonElement && row.time !== undefined) {
        const time = row.time;
        item.type = "button";
        item.onclick = () => window.selection.setSelectedTime(time);
      }
      panel.append(item);
    }
  }

  private drawPoses(poses: ReturnType<typeof diagnose>["fieldPoses"]) {
    const canvas = this.root.querySelector<HTMLCanvasElement>(".diagnostics-poses")!;
    canvas.hidden = poses.length === 0;
    if (!poses.length) return;
    const ctx = canvas.getContext("2d")!;
    const { width, height } = canvas;
    const minX = Math.min(...poses.map((pose) => pose.x)) - 0.5;
    const minY = Math.min(...poses.map((pose) => pose.y)) - 0.5;
    const spanX = Math.max(...poses.map((pose) => pose.x)) - minX + 0.5;
    const spanY = Math.max(...poses.map((pose) => pose.y)) - minY + 0.5;
    const scale = Math.min((width - 40) / spanX, (height - 40) / spanY);
    ctx.fillStyle = "#191919";
    ctx.fillRect(0, 0, width, height);
    const field = this.assets?.field2ds.find(({ id }) => id === this.field.value);
    if (field && this.fieldImage.getAttribute("src") !== field.path) this.fieldImage.src = field.path;
    const fieldWidth = (field?.widthInches ?? 0) * 0.0254;
    const fieldHeight = (field?.heightInches ?? 0) * 0.0254;
    const fieldScale = fieldWidth > 0 && fieldHeight > 0 ? Math.min(width / fieldWidth, height / fieldHeight) : 0;
    const offsetX = (width - fieldWidth * fieldScale) / 2;
    const offsetY = (height - fieldHeight * fieldScale) / 2;
    if (field && fieldScale && this.fieldImage.complete && this.fieldImage.naturalWidth) {
      const [left, top] = field.topLeft;
      const [right, bottom] = field.bottomRight;
      ctx.drawImage(
        this.fieldImage,
        left,
        top,
        right - left,
        bottom - top,
        offsetX,
        offsetY,
        fieldWidth * fieldScale,
        fieldHeight * fieldScale
      );
    }
    poses.forEach(({ x, y }, index) => {
      const px = fieldScale ? offsetX + x * fieldScale : 12 + (x - minX) * scale;
      const py = fieldScale ? offsetY + (fieldHeight - y) * fieldScale : height - 16 - (y - minY) * scale;
      ctx.fillStyle = index === 0 ? "#ffe300" : "#56dfff";
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(String(index + 1), px + 6, py - 4);
    });
    canvas.title = "Blue-origin pose positions. See numbered estimates below.";
  }

  private commandTimeline(commands: DiagnosticRow[]) {
    const panel = this.root.querySelector<HTMLElement>(".diagnostics-commands")!;
    this.rows(".diagnostics-commands", commands.slice(-200));
    if (!commands.length) return;
    const [start, end] = window.log.getTimestampRange();
    const span = Math.max(end - start, 0.001);
    commands.slice(-200).forEach((row, index) => {
      if (row.time === undefined) return;
      const bar = document.createElement("span");
      bar.className = row.value.startsWith("Interrupted") ? "diagnostics-span interrupted" : "diagnostics-span";
      bar.style.marginInlineStart = Math.max(0, ((row.time - start) / span) * 98) + "%";
      bar.style.width = Math.max(1, (((row.end ?? row.time) - row.time) / span) * 98) + "%";
      panel.children[index].append(bar);
    });
  }

  override render() {
    if (this.assets !== window.assets) {
      this.assets = window.assets;
      const value = this.field.value;
      const fields = this.assets?.field2ds.filter((field) => !field.isFTC) ?? [];
      this.field.replaceChildren(new Option("Auto-zoom", ""), ...fields.map(({ id, name }) => new Option(name, id)));
      if (fields.some(({ id }) => id === value)) this.field.value = value;
      this.drawPoses(this.previous?.fieldPoses ?? []);
    }
    const log = window.log;
    const time = window.selection.getRenderTime() ?? log.getTimestampRange()[1];
    const now = performance.now();
    const refresh =
      this.evaluatedLog !== log ||
      !this.previous ||
      (window.selection.getCurrentLiveTime() !== null && now - this.updated >= 1500);
    if (!refresh && this.time === time) return;
    if (refresh) {
      const value = this.source.value;
      const matches = new Set(log.getFieldKeys().map((key) => /^\/?(Log\d+)(?=\/)/.exec(key)?.[1] ?? ""));
      if (!matches.size) matches.add("");
      this.source.replaceChildren(...[...matches].sort().map((match) => new Option(match || "Primary log", match)));
      if (matches.has(value)) this.source.value = value;
    }
    this.evaluatedLog = log;
    this.time = time;
    const data = diagnose(log, this.preset, time, this.source.value, refresh ? undefined : this.previous);
    this.rows(".diagnostics-readiness", [...data.readiness, ...data.context]);
    this.rows(".diagnostics-vision", [
      ...data.fieldPoses.map(({ label, x, y }, index) => ({
        label: `${index + 1}. ${label}`,
        value: `${x.toFixed(2)}, ${y.toFixed(2)} m`
      })),
      ...data.vision
    ]);
    this.drawPoses(data.fieldPoses);
    if (refresh) this.commandTimeline(data.commands);
    this.rows(".diagnostics-incidents", [...data.modules, ...data.incidents]);
    this.previous = data;
    if (refresh) this.updated = now;
  }
}
