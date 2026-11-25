// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import { BrowserWindow, dialog } from "electron";
import { FSWatcher, promises as fs, watch } from "fs";
import path from "path";

const groups = [
  { folder: "paths", extension: ".path" },
  { folder: "autos", extension: ".auto" }
];

export type PathPlannerProjectSnapshot = {
  id: string;
  folder: string;
  files: { name: string; text: string }[];
  error?: boolean;
};

async function getProjectFolder(selection: string) {
  for (const folder of [
    path.join(selection, "src", "main", "deploy", "pathplanner"),
    path.join(selection, "deploy", "pathplanner"),
    selection
  ]) {
    for (const group of groups) {
      try {
        if ((await fs.stat(path.join(folder, group.folder))).isDirectory()) return folder;
      } catch {}
    }
  }
  return null;
}

export default class PathPlannerProjectLinks {
  private readonly links = new Map<string, () => void>();

  constructor(private readonly send: (window: BrowserWindow, name: string, data: PathPlannerProjectSnapshot) => void) {}

  close(window: BrowserWindow, id: unknown) {
    if (typeof id !== "string") return;
    this.links.get(`${window.id}:${id}`)?.();
  }

  async choose(window: BrowserWindow, id: unknown) {
    if (typeof id !== "string") return;
    const selection = await dialog.showOpenDialog(window, {
      title: t("hub.pathPlanner.linkProject"),
      properties: ["openDirectory"]
    });
    if (selection.canceled || window.isDestroyed()) return;
    const folder = await getProjectFolder(selection.filePaths[0]);
    if (window.isDestroyed()) return;
    if (folder === null) {
      this.send(window, "pathplanner-project-invalid", { id, folder: "", files: [] });
      return;
    }
    this.link(window, id, folder);
  }

  private link(window: BrowserWindow, id: string, folder: string) {
    const key = `${window.id}:${id}`;
    this.close(window, id);
    let watcher: FSWatcher | undefined;
    let pending: NodeJS.Timeout | undefined;
    let update = 0;
    const stop = () => {
      watcher?.close();
      clearTimeout(pending);
      window.removeListener("closed", stop);
      this.links.delete(key);
    };
    const read = async () => {
      const revision = ++update;
      const files: PathPlannerProjectSnapshot["files"] = [];
      try {
        for (const group of groups) {
          const directory = path.join(folder, group.folder);
          const entries = await fs.readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
            if (error.code === "ENOENT") return [];
            throw error;
          });
          for (const entry of entries) {
            if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== group.extension) continue;
            const file = path.join(directory, entry.name);
            try {
              if ((await fs.stat(file)).size <= 2 * 1024 * 1024)
                files.push({ name: entry.name, text: await fs.readFile(file, "utf8") });
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            }
          }
        }
        if (this.links.get(key) === stop && revision === update && !window.isDestroyed()) {
          this.send(window, "pathplanner-project-snapshot", { id, folder, files });
        }
      } catch {
        if (this.links.get(key) === stop && revision === update && !window.isDestroyed()) {
          this.send(window, "pathplanner-project-snapshot", { id, folder, files: [], error: true });
        }
      }
    };
    this.links.set(key, stop);
    window.once("closed", stop);
    try {
      watcher = watch(folder, { recursive: true }, (_, filename) => {
        if (filename !== null && !/\.(path|auto)$/i.test(filename)) return;
        clearTimeout(pending);
        ++update;
        pending = setTimeout(read, 150);
      });
      watcher.on("error", () => {
        stop();
        if (!window.isDestroyed())
          this.send(window, "pathplanner-project-snapshot", { id, folder, files: [], error: true });
      });
      void read();
    } catch {
      stop();
      this.send(window, "pathplanner-project-snapshot", { id, folder, files: [], error: true });
    }
  }
}
