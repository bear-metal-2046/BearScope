// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import type Log from "../shared/log/Log";
import LoggableType from "../shared/log/LoggableType";

const readableTypes = new Set([
  LoggableType.Boolean,
  LoggableType.Number,
  LoggableType.String,
  LoggableType.BooleanArray,
  LoggableType.NumberArray,
  LoggableType.StringArray
]);

type GeminiSettings = { key: string; model: string };

export default class DiagnosticChat {
  private readonly panel: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly history: HTMLElement;
  private readonly question: HTMLTextAreaElement;
  private readonly review: HTMLElement;
  private readonly preview: HTMLTextAreaElement;
  private readonly status: HTMLElement;
  private readonly send: HTMLButtonElement;
  private log?: Log;
  private turns: { role: string; text: string }[] = [];
  private inFlight?: { log: Log; generation: number; outgoing: { role: string; text: string } };
  private generation = 0;
  private requestedField?: string;

  constructor(
    private readonly root: HTMLElement,
    private readonly request: (prompt: string, settings: GeminiSettings) => void
  ) {
    this.panel = root.querySelector(".diagnostics-chat")!;
    this.toggle = root.querySelector(".diagnostics-open-chat")!;
    this.history = root.querySelector(".diagnostics-chat-history")!;
    this.question = root.querySelector(".diagnostics-chat-input")!;
    this.review = root.querySelector(".diagnostics-chat-review")!;
    this.preview = this.review.querySelector("textarea")!;
    this.status = root.querySelector(".diagnostics-chat-status")!;
    this.send = root.querySelector(".diagnostics-chat-send")!;
    this.toggle.onclick = () => this.open(this.panel.hidden);
    this.panel.querySelector<HTMLButtonElement>(".diagnostics-close-chat")!.onclick = () => this.open(false);
    this.panel.querySelector<HTMLButtonElement>(".diagnostics-chat-reset")!.onclick = () => this.reset();
    this.send.onclick = () => this.submit("question", this.question.value.trim());
    this.panel.querySelector<HTMLButtonElement>(".diagnostics-share-data")!.onclick = () =>
      this.submit("local tool result", this.preview.value);
    this.panel.querySelector<HTMLButtonElement>(".diagnostics-skip-data")!.onclick = () => {
      this.review.hidden = true;
      this.preview.value = "";
      this.turns.push({ role: "local tool result", text: "The user declined to share the requested readings." });
      this.status.textContent = "Readings skipped. You can ask another question.";
    };
  }

  open(visible: boolean) {
    this.root.classList.toggle("diagnostics-chat-visible", visible);
    this.panel.hidden = !visible;
    this.toggle.setAttribute("aria-expanded", String(visible));
    if (visible) this.question.focus();
    else this.toggle.focus();
  }

  settings(): GeminiSettings {
    return {
      key: this.panel.querySelector<HTMLInputElement>(".diagnostics-gemini-key")!.value.trim(),
      model: this.panel.querySelector<HTMLInputElement>(".diagnostics-gemini-model")!.value.trim()
    };
  }

  updateLog(log: Log) {
    if (this.log === log) return;
    this.log = log;
    this.reset();
  }

  getActiveFields(): string[] {
    return this.log === window.log && this.requestedField !== undefined ? [this.requestedField] : [];
  }

  private reset() {
    ++this.generation;
    this.turns = [];
    this.history.replaceChildren();
    this.preview.value = "";
    this.question.value = "";
    this.review.hidden = true;
    this.status.textContent = "";
    this.requestedField = undefined;
  }

  private submit(role: string, text: string) {
    if (this.inFlight) return;
    if (this.log !== window.log) {
      this.updateLog(window.log);
      this.status.textContent = "The loaded log changed. Ask a question about the new log.";
      return;
    }
    if (!text) {
      this.status.textContent = "Enter a question first.";
      return;
    }
    const settings = this.settings();
    if (!settings.key || !settings.model) {
      this.status.textContent = "Enter your Google AI Studio key and Gemini model ID.";
      this.panel.querySelector<HTMLDetailsElement>("details")!.open = true;
      return;
    }

    const outgoing = { role, text };
    const context = [...this.turns.slice(-12), outgoing];
    let prompt = JSON.stringify(context);
    while (prompt.length > 15000 && context.length > 1) {
      context.shift();
      prompt = JSON.stringify(context);
    }
    this.inFlight = { log: window.log, generation: this.generation, outgoing };
    this.status.textContent = "Waiting for Gemini…";
    this.setPending(true);
    this.request(prompt, settings);
  }

  private setPending(pending: boolean) {
    this.send.disabled = pending;
    this.panel.querySelector<HTMLButtonElement>(".diagnostics-share-data")!.disabled = pending;
    this.panel.querySelector<HTMLButtonElement>(".diagnostics-skip-data")!.disabled = pending;
  }

  async receive(text: string) {
    const request = this.inFlight;
    this.inFlight = undefined;
    this.setPending(false);
    if (!request || request.log !== window.log || request.generation !== this.generation) return;
    let reply: {
      answer?: unknown;
      time?: unknown;
      tool?: unknown;
      query?: unknown;
      key?: unknown;
      start?: unknown;
      end?: unknown;
    };
    try {
      reply = JSON.parse(text);
      if (!reply || typeof reply !== "object") throw new Error();
    } catch {
      this.status.textContent = text;
      return;
    }

    this.turns.push(request.outgoing, { role: "model", text });
    if (request.outgoing.role === "question") {
      this.addMessage("You", request.outgoing.text);
      if (this.question.value.trim() === request.outgoing.text) this.question.value = "";
    }
    this.review.hidden = true;
    this.preview.value = "";
    this.status.textContent = "";
    if (typeof reply.answer === "string") {
      this.addMessage("Gemini", reply.answer, reply.time);
      return;
    }

    const log = request.log;
    const [first, last] = log.getTimestampRange();
    if (reply.tool === "search" && typeof reply.query === "string") {
      const search = reply.query.toLowerCase().trim();
      const keys = log.getFieldKeys().filter((key) => {
        const type = log.getType(key);
        return type !== null && readableTypes.has(type) && key.toLowerCase().includes(search);
      });
      this.preview.value = JSON.stringify(
        {
          bounds: [first, last],
          cursor: window.selection.getRenderTime(),
          matchingFields: keys.length,
          fields: keys.slice(0, 35).map((key) => key.slice(0, 300))
        },
        null,
        2
      );
    } else if (
      reply.tool === "read" &&
      typeof reply.key === "string" &&
      typeof reply.start === "number" &&
      Number.isFinite(reply.start) &&
      typeof reply.end === "number" &&
      Number.isFinite(reply.end) &&
      reply.start <= reply.end
    ) {
      const { key } = reply;
      const type = log.getType(key);
      const start = Math.max(first, reply.start);
      const end = Math.min(last, reply.end);
      const readable = type !== null && readableTypes.has(type) && start <= end;
      if (readable && !log.getField(key)?.getTimestamps().length) {
        this.requestedField = key;
        this.setPending(true);
        this.status.textContent = "Loading the requested log field…";
        for (let attempt = 0; attempt < 50 && !log.getField(key)?.getTimestamps().length; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, 100));
          if (request.log !== window.log || request.generation !== this.generation) {
            this.setPending(false);
            return;
          }
        }
        this.requestedField = undefined;
        this.setPending(false);
      }
      const series = readable ? log.getRange(key, start, end) : undefined;
      const samples: [number, unknown][] = [];
      let min: [number, number] | undefined;
      let max: [number, number] | undefined;
      if (series) {
        // Include the held value at the start, plus evenly spaced logged changes.
        const count = series.timestamps.length;
        const stride = Math.max(1, Math.ceil(count / 56));
        for (let i = 0; i < count; i++) {
          const time = series.timestamps[i];
          if (time > end) break;
          const value = series.values[i];
          if (time >= start && typeof value === "number" && Number.isFinite(value)) {
            if (!min || value < min[1]) min = [time, value];
            if (!max || value > max[1]) max = [time, value];
          }
          if (i % stride !== 0 && i !== count - 1) continue;
          const compact = (item: unknown) => (typeof item === "string" ? item.slice(0, 120) : item);
          samples.push([time, Array.isArray(value) ? value.slice(0, 8).map(compact) : compact(value)]);
        }
      }
      while (true) {
        this.preview.value = JSON.stringify(
          {
            key,
            start,
            end,
            samples,
            ...(min && max
              ? { numericExtrema: { min: { time: min[0], value: min[1] }, max: { time: max[0], value: max[1] } } }
              : {}),
            sampled: true,
            ...(samples.length ? {} : { status: "No decoded samples available in this range." })
          },
          null,
          2
        );
        if (this.preview.value.length <= 12000 || samples.length === 0) break;
        samples.splice(Math.ceil(samples.length / 2));
      }
    } else {
      this.status.textContent = "Gemini did not return a usable answer or log request.";
      return;
    }
    this.review.hidden = false;
    this.status.textContent = "Review the requested data before sharing it.";
  }

  private addMessage(label: string, value: string, time?: unknown) {
    const message = document.createElement("div");
    const author = document.createElement("strong");
    author.textContent = label;
    const body = document.createElement("p");
    body.textContent = value;
    message.append(author, body);
    const [first, last] = window.log.getTimestampRange();
    if (typeof time === "number" && Number.isFinite(time) && time >= first && time <= last) {
      const jump = document.createElement("button");
      jump.type = "button";
      jump.textContent = "Jump to " + time.toFixed(2) + " s";
      jump.onclick = () => window.selection.setSelectedTime(time);
      message.append(jump);
    }
    this.history.append(message);
    this.history.scrollTop = this.history.scrollHeight;
  }
}
