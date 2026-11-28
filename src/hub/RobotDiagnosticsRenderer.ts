// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import type { AdvantageScopeAssets } from "../shared/AdvantageScopeAssets";
import type Log from "../shared/log/Log";
import LoggableType from "../shared/log/LoggableType";
import { NoopRenderer } from "../shared/renderers/TabRenderer";
import AutoComparison from "./AutoComparison";
import DiagnosticChat from "./DiagnosticChat";
import {
  defaultDiagnostics,
  diagnose,
  diagnosticSource,
  formatDiagnosticValue,
  getDiagnosticFields,
  parsePreset,
  type DiagnosticRow
} from "./RobotDiagnostics";

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
  private readonly chat: DiagnosticChat;
  private readonly comparison: AutoComparison;
  private readonly picker: HTMLSelectElement;
  private summaryPending = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly tabId: () => string
  ) {
    super();
    this.chat = new DiagnosticChat(root, (prompt, settings) => {
      window.sendMainMessage("bearscope-analyze-diagnostics", {
        id: this.tabId(),
        prompt,
        provider: "gemini",
        chat: true,
        ...settings
      });
    });
    this.source = root.querySelector(".diagnostics-log")!;
    this.comparison = new AutoComparison(root);
    this.picker = root.querySelector(".diagnostics-picker-field")!;
    root.querySelector(".diagnostics-picker-search")!.addEventListener("input", () => this.updatePicker());
    this.picker.onchange = () => this.updatePickerSample();
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
      this.updatePicker();
    });
    root.querySelector(".diagnostics-picker-add")!.addEventListener("click", () => {
      const field = this.picker.value;
      if (!field) return;
      const section =
        root.querySelector<HTMLSelectElement>(".diagnostics-picker-section")!.value === "readiness"
          ? "readiness"
          : "context";
      if (section === "readiness" && window.log.getType(field) !== LoggableType.Boolean) {
        status.textContent = "Choose a Boolean field for Readiness.";
        return;
      }
      try {
        const preset = parsePreset(editor.value);
        const label =
          root.querySelector<HTMLInputElement>(".diagnostics-picker-label")!.value.trim() || field.split("/").at(-1)!;
        const existing = preset[section].findIndex((row) => row.label === label);
        preset[section].splice(existing < 0 ? preset[section].length : existing, existing < 0 ? 0 : 1, {
          label,
          key: field
        });
        this.preset = preset;
        this.previous = undefined;
        showPreset();
        status.textContent = "Updated " + label;
      } catch (error) {
        status.textContent = error instanceof Error ? error.message : "Invalid preset.";
      }
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
    const sendSummary = (gemini: boolean) => {
      if (this.summaryPending) return;
      if (!prompt.value.trim()) {
        this.showAnalysis("Prepare a summary first.");
        return;
      }
      const settings = gemini ? this.chat.settings() : undefined;
      if (gemini && (!settings?.key || !settings.model)) {
        this.showAnalysis("Enter a Google AI Studio key and model under Gemini log chat.");
        this.chat.open(true);
        return;
      }
      this.showAnalysis(`Waiting for ${gemini ? "Gemini" : "Claude"}…`);
      this.setSummaryPending(true);
      window.sendMainMessage("bearscope-analyze-diagnostics", {
        id: this.tabId(),
        prompt: prompt.value,
        provider: gemini ? "gemini" : "claude",
        ...settings
      });
    };
    root.querySelector(".diagnostics-send")!.addEventListener("click", () => sendSummary(false));
    root.querySelector(".diagnostics-send-gemini")!.addEventListener("click", () => sendSummary(true));
  }

  private setSummaryPending(pending: boolean) {
    this.summaryPending = pending;
    this.root.querySelectorAll<HTMLButtonElement>(".diagnostics-send, .diagnostics-send-gemini").forEach((button) => {
      button.disabled = pending;
    });
  }

  showAnalysis(result: string, chat?: boolean) {
    if (chat) {
      this.chat.receive(result);
      return;
    }
    this.root.querySelector<HTMLTextAreaElement>(".diagnostics-answer")!.value = result;
    this.setSummaryPending(false);
  }

  getActiveFields() {
    return [
      ...getDiagnosticFields(window.log, this.preset),
      ...this.chat.getActiveFields(),
      ...this.comparison.getActiveFields(window.log),
      ...(this.picker.value && this.picker.closest("details")?.open ? [this.picker.value] : [])
    ];
  }

  private updatePicker() {
    const value = this.picker.value;
    const query = this.root.querySelector<HTMLInputElement>(".diagnostics-picker-search")!.value.trim().toLowerCase();
    const options = window.log
      .getFieldKeys()
      .filter((key) => {
        const type = window.log.getType(key);
        return (
          diagnosticSource(key) === this.source.value &&
          type !== null &&
          type !== LoggableType.Raw &&
          type !== LoggableType.Empty &&
          key.toLowerCase().includes(query)
        );
      })
      .slice(0, 250);
    this.picker.replaceChildren(
      new Option(options.length ? "Select a field" : "No matching fields", ""),
      ...options.map((key) => new Option(`${key} (${LoggableType[window.log.getType(key)!]})`, key))
    );
    if (options.includes(value)) this.picker.value = value;
    this.updatePickerSample();
  }

  private updatePickerSample() {
    const value = this.picker.value;
    const preview = this.root.querySelector<HTMLElement>(".diagnostics-picker-sample")!;
    if (!value) {
      preview.textContent = "";
      return;
    }
    const time = window.selection.getRenderTime() ?? window.log.getTimestampRange()[1];
    const data = window.log.getRange(value, time, time);
    const index = data?.timestamps.findLastIndex((timestamp) => timestamp <= time) ?? -1;
    const first = window.log.getField(value)?.getTimestamps()[0];
    preview.textContent =
      index >= 0
        ? "At cursor: " + formatDiagnosticValue(data?.values[index])
        : first === undefined
        ? "Samples unavailable or loading"
        : `First sample at ${first.toFixed(2)} s`;
  }

  refreshLog() {
    this.previous = undefined;
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
    this.chat.updateLog(window.log);
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
      this.updatePicker();
    }
    this.comparison.update(log, this.preset, refresh);
    if (!refresh) this.updatePickerSample();
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
