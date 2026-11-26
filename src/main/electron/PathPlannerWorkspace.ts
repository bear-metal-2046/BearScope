// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import { spawn } from "child_process";
import { app, BrowserWindow } from "electron";
import fs from "fs";
import path from "path";
import { createInterface } from "readline";

const bundle = path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, "..", "vendor"), "pathplanner");
const runner = path.join(bundle, "pathPlannerHost.exe");
const planner = path.join(bundle, "pathplanner.exe");

function isViewport(value: unknown): value is [number, number, number, number] {
  return Array.isArray(value) && value.length === 4 && value.every((part) => Number.isFinite(part) && part >= 0);
}

export default class PathPlannerWorkspace {
  private session: { window: BrowserWindow; projectFile: string; end: () => void; setViewport: (command: string) => void } | undefined;

  constructor(private readonly sendMessage: (window: BrowserWindow, name: string, data: string) => void) {}

  static isAvailable() {
    return process.platform === "win32" && fs.existsSync(runner) && fs.existsSync(planner);
  }

  close(window: BrowserWindow) {
    if (this.session?.window === window) this.session.end();
  }

  update(window: BrowserWindow, viewport: unknown) {
    if (viewport === null) {
      if (this.session?.window === window) this.session.setViewport("hide");
      return;
    }
    if (!isViewport(viewport)) return;
    if (!PathPlannerWorkspace.isAvailable()) {
      this.sendMessage(window, "pathplanner-workspace-state", "unavailable");
      return;
    }
    if (this.session !== undefined && this.session.window !== window) {
      this.sendMessage(window, "pathplanner-workspace-state", "busy");
      return;
    }
    const [x, y, width, height] = viewport;
    const content = window.getContentBounds();
    const zoom = window.webContents.getZoomFactor();
    const right = Math.min((x + width) * zoom, content.width);
    const bottom = Math.min((y + height) * zoom, content.height);
    const left = x * zoom;
    const top = y * zoom;
    if (right - left < 1 || bottom - top < 1) return;

    if (this.session === undefined) this.start(window);
    this.session?.setViewport(`show ${left} ${top} ${right - left} ${bottom - top}`);
  }

  activeProject(window: BrowserWindow): string | undefined {
    if (this.session?.window !== window) return;
    try {
      const folder = JSON.parse(fs.readFileSync(this.session.projectFile, "utf8"));
      if (typeof folder === "string" && path.isAbsolute(folder)) return folder;
    } catch {}
  }

  private start(window: BrowserWindow) {
    const handle = window.getNativeWindowHandle().readBigUInt64LE().toString();
    const sessionDir = fs.mkdtempSync(path.join(app.getPath("temp"), "bearscope-planner-"));
    const projectFile = path.join(sessionDir, "project.json");
    const env = { ...global.process.env, BEARSCOPE_PROJECT_FILE: projectFile };
    const process = spawn(runner, [handle, planner], { windowsHide: true, stdio: "pipe", env });
    let ready = false;
    let closed = false;
    let lastCommand: string | undefined;
    let launchError = "";
    const lines = createInterface({ input: process.stdout });
    const setViewport = (command: string) => {
      lastCommand = command;
      if (ready && !closed) process.stdin.write(command + "\n");
    };
    const end = () => {
      if (closed) return;
      closed = true;
      process.stdin.end("close\n");
      if (this.session === session) this.session = undefined;
      window.removeListener("closed", end);
      // The helper closes Flutter gracefully. Guard against a stalled helper during shutdown.
      const timeout = setTimeout(() => process.kill(), 18000);
      timeout.unref();
      process.once("close", () => clearTimeout(timeout));
    };
    const session = { window, projectFile, end, setViewport };
    this.session = session;
    window.once("closed", end);
    this.sendMessage(window, "pathplanner-workspace-state", "loading");

    lines.on("line", (line) => {
      if (line !== "ready" || closed) return;
      ready = true;
      if (lastCommand !== undefined) setViewport(lastCommand);
      this.sendMessage(window, "pathplanner-workspace-state", "ready");
    });
    process.stderr.setEncoding("utf8").on("data", (message: string) => (launchError += message));
    process.stdin.on("error", () => {});
    process.on("error", (error) => (launchError += error.message));
    process.once("close", (code) => {
      fs.rm(sessionDir, { recursive: true, force: true }, () => {});
      lines.close();
      window.removeListener("closed", end);
      if (this.session === session) this.session = undefined;
      if (!closed && !window.isDestroyed()) {
        if (launchError) console.error(launchError.trim());
        this.sendMessage(window, "pathplanner-workspace-state", code === 0 ? "closed" : "failed");
      }
    });
  }
}
