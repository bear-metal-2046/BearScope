// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import type { Translation2d } from "../shared/geometry";

export type PathPlannerPoint = { x: number; y: number };
export type PathPlannerPointKey = "anchor" | "prevControl" | "nextControl";

export type PathPlannerWaypoint = {
  anchor: PathPlannerPoint;
  prevControl: PathPlannerPoint | null;
  nextControl: PathPlannerPoint | null;
  isLocked?: boolean;
};

export type PathPlannerPath = {
  name: string;
  fileName: string;
  document: { waypoints: PathPlannerWaypoint[]; version: "2025.0"; eventMarkers?: unknown };
};

export type PathPlannerAuto = { name: string; paths: PathPlannerPath[] };

/** Flip in blue-origin field axes, then rotate about field center and convert to renderer coordinates. */
export function transformPathPlannerSegment(
  [x, y]: Translation2d,
  [width, height]: Translation2d,
  { flipX, flipY, rotation }: { flipX: boolean; flipY: boolean; rotation: number }
): Translation2d {
  const dx = (x - width / 2) * (flipX ? -1 : 1);
  const dy = (y - height / 2) * (flipY ? -1 : 1);
  const radians = ((rotation % 360) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return [dy * sin - dx * cos, -dx * sin - dy * cos];
}

type FileError =
  | "readError"
  | "invalidJson"
  | "versionError"
  | "pathError"
  | "autoError"
  | "choreoError"
  | "duplicateError";
export type PathPlannerImportIssue = { file: string } & ({ key: FileError } | { key: "missingPath"; path: string });

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPoint(value: unknown): value is PathPlannerPoint {
  return isObject(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isWaypoint(value: unknown): value is PathPlannerWaypoint {
  return (
    isObject(value) &&
    isPoint(value.anchor) &&
    (value.prevControl === null || isPoint(value.prevControl)) &&
    (value.nextControl === null || isPoint(value.nextControl))
  );
}

function getAutoPathNames(command: unknown, names: string[], depth = 0): boolean {
  if (depth > 64 || !isObject(command) || !isObject(command.data)) return false;
  switch (command.type) {
    case "path":
      if (typeof command.data.pathName !== "string" || command.data.pathName.length === 0) return false;
      names.push(command.data.pathName);
      return true;
    case "sequential":
    case "parallel":
    case "race":
    case "deadline":
      return (
        Array.isArray(command.data.commands) &&
        command.data.commands.every((child) => getAutoPathNames(child, names, depth + 1))
      );
    case "wait":
    case "named":
      return true;
    default:
      return false;
  }
}

export async function importPathPlannerFiles(files: File[]): Promise<{
  paths: PathPlannerPath[];
  autos: PathPlannerAuto[];
  issues: PathPlannerImportIssue[];
}> {
  const paths = new Map<string, PathPlannerPath>();
  const autos = new Map<string, PathPlannerAuto>();
  const issues: PathPlannerImportIssue[] = [];
  // Resolve autos after all paths have been read, regardless of the file picker order.
  for (const extension of [".path", ".auto"] as const) {
    for (const file of files) {
      if (!file.name.toLowerCase().endsWith(extension)) continue;
      const name = file.name.slice(0, -extension.length);
      const entries = extension === ".path" ? paths : autos;
      if (entries.has(name)) {
        issues.push({ file: file.name, key: "duplicateError" });
        continue;
      }
      let content: string;
      try {
        if (file.size > 2 * 1024 * 1024) throw new Error();
        content = await file.text();
      } catch {
        issues.push({ file: file.name, key: "readError" });
        continue;
      }
      let document: unknown;
      try {
        document = JSON.parse(content);
      } catch {
        issues.push({ file: file.name, key: "invalidJson" });
        continue;
      }
      if (!isObject(document) || document.version !== "2025.0") {
        issues.push({ file: file.name, key: "versionError" });
        continue;
      }
      if (extension === ".path") {
        const waypoints = document.waypoints;
        if (
          !Array.isArray(waypoints) ||
          waypoints.length < 2 ||
          !waypoints.every(isWaypoint) ||
          waypoints.slice(0, -1).some((waypoint) => waypoint.nextControl === null) ||
          waypoints.slice(1).some((waypoint) => waypoint.prevControl === null)
        ) {
          issues.push({ file: file.name, key: "pathError" });
          continue;
        }
        paths.set(name, { name, fileName: file.name, document: { ...document, version: document.version, waypoints } });
      } else {
        if (document.choreoAuto === true) {
          issues.push({ file: file.name, key: "choreoError" });
          continue;
        }
        const names: string[] = [];
        if (!getAutoPathNames(document.command, names) || names.length === 0) {
          issues.push({ file: file.name, key: "autoError" });
          continue;
        }
        const missing = names.find((pathName) => !paths.has(pathName));
        if (missing !== undefined) {
          issues.push({ file: file.name, key: "missingPath", path: missing });
          continue;
        }
        autos.set(name, { name, paths: names.map((pathName) => paths.get(pathName)!) });
      }
    }
  }
  return { paths: [...paths.values()], autos: [...autos.values()], issues };
}

/** Samples the cubic Bézier segments in PathPlanner's blue-origin field coordinates. */
export function samplePathPlannerPath(path: PathPlannerPath): Translation2d[] {
  const waypoints = path.document.waypoints;
  const first = waypoints[0].anchor;
  const samples: Translation2d[] = [[first.x, first.y]];
  const samplesPerSegment = 24;
  for (let i = 1; i < waypoints.length; i++) {
    const start = waypoints[i - 1];
    const end = waypoints[i];
    const a = start.anchor;
    const b = start.nextControl!;
    const c = end.prevControl!;
    const d = end.anchor;
    for (let j = 1; j <= samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      const u = 1 - t;
      samples.push([
        u ** 3 * a.x + 3 * u ** 2 * t * b.x + 3 * u * t ** 2 * c.x + t ** 3 * d.x,
        u ** 3 * a.y + 3 * u ** 2 * t * b.y + 3 * u * t ** 2 * c.y + t ** 3 * d.y
      ]);
    }
  }
  return samples;
}

/** Updates geometry while preserving waypoint metadata and the tangent at interior anchors. */
export function movePathPlannerPoint(waypoint: PathPlannerWaypoint, key: PathPlannerPointKey, point: PathPlannerPoint) {
  const current = waypoint[key];
  if (waypoint.isLocked || current === null || !isPoint(point)) return;
  const { anchor, prevControl, nextControl } = waypoint;
  if (key === "anchor") {
    for (const handle of [prevControl, nextControl]) {
      if (handle === null) continue;
      handle.x += point.x - anchor.x;
      handle.y += point.y - anchor.y;
    }
    Object.assign(anchor, point);
    return;
  }

  const dx = point.x - anchor.x;
  const dy = point.y - anchor.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return;
  const length = Math.max(0.25, distance);
  current.x = anchor.x + (dx / distance) * length;
  current.y = anchor.y + (dy / distance) * length;
  const opposite = key === "prevControl" ? nextControl : prevControl;
  if (opposite !== null) {
    const oppositeLength = Math.hypot(opposite.x - anchor.x, opposite.y - anchor.y);
    opposite.x = anchor.x - (dx / distance) * oppositeLength;
    opposite.y = anchor.y - (dy / distance) * oppositeLength;
  }
}
