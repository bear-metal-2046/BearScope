// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import { convertFromCoordinateSystem, type Pose2d, type Translation2d } from "../shared/geometry";
import type Log from "../shared/log/Log";
import { removeMergePrefix } from "../shared/log/LogKeyUtils";
import { getRobotStateRanges } from "../shared/log/RobotState";
import type { Field2dRendererCommand_TrajectoryObj } from "../shared/renderers/Field2dRenderer";
import type { PathPlannerPath } from "./PathPlanner";

const poseField = /(?:^|\/)(?:PathPlanner\/(?:currentPose|targetPose)|Chassis\/OdometryPose)$/;
const eventField = /(?:^|\/)(?:CommandsUnique|CommandsAll|PathPlanner\/Events)\/(.+)$/;

type TimedPose = { time: number; pose: Pose2d };
type TrackingError = { time: number; meters: number; degrees: number };
type CommandEvent = { time: number; name: string; active: boolean };

export function readPoses(log: Log, key: string): TimedPose[] {
  const x = log.getNumber(key + "/translation/x", -Infinity, Infinity);
  const y = log.getNumber(key + "/translation/y", -Infinity, Infinity);
  const rotation = log.getNumber(key + "/rotation/value", -Infinity, Infinity);
  if (!x || !y || !rotation) return [];
  let yi = -1;
  let ri = -1;
  return x.timestamps.flatMap((time, xi) => {
    while (y.timestamps[yi + 1] <= time) yi++;
    while (rotation.timestamps[ri + 1] <= time) ri++;
    const values = [x.values[xi], y.values[yi], rotation.values[ri]];
    if (!values.every(Number.isFinite)) return [];
    return [{ time, pose: { translation: [values[0], values[1]], rotation: values[2] } }];
  });
}

function latest<T extends { time: number }>(samples: T[], time: number): T | undefined {
  let low = 0;
  let high = samples.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (samples[mid].time <= time) low = mid + 1;
    else high = mid;
  }
  return samples[low - 1];
}

export function analyzePathPlannerReplay(log: Log) {
  const keys = log.getFieldKeys();
  const runs: TimedPose[][] = [];
  const traces: TimedPose[][] = [];
  const errors: TrackingError[][] = [];
  const events: CommandEvent[] = [];
  const autoRanges = getRobotStateRanges(log).filter((range) => range.mode === "auto");
  for (const key of keys) {
    if (
      key.endsWith("/Chassis/OdometryPose") &&
      keys.includes(key.replace(/Chassis\/OdometryPose$/, "PathPlanner/currentPose"))
    )
      continue;
    if (poseField.test(removeMergePrefix(key)) && !key.endsWith("/targetPose")) {
      const actual = readPoses(log, key);
      if (actual.length === 0) continue;
      traces.push(actual);
      const target = key.endsWith("/currentPose") ? readPoses(log, key.replace(/currentPose$/, "targetPose")) : [];
      errors.push(
        actual.flatMap(({ time, pose }) => {
          const setpoint = latest(target, time);
          if (!setpoint || time > target[target.length - 1].time) return [];
          const heading = pose.rotation - setpoint.pose.rotation;
          return [
            {
              time,
              meters: Math.hypot(
                pose.translation[0] - setpoint.pose.translation[0],
                pose.translation[1] - setpoint.pose.translation[1]
              ),
              degrees: (Math.abs(Math.atan2(Math.sin(heading), Math.cos(heading))) * 180) / Math.PI
            }
          ];
        })
      );
      const windows = autoRanges
        .map(({ start, end }) => actual.filter(({ time }) => time >= start && time < (end ?? Infinity)))
        .filter((run) => run.length > 0);
      runs.push(...(autoRanges.length === 0 ? [actual] : windows));
    }

    const match = removeMergePrefix(key).match(eventField);
    if (!match) continue;
    const values = log.getBoolean(key, -Infinity, Infinity);
    if (!values) continue;
    values.timestamps.forEach((time, index) => {
      const active = values.values[index];
      if ((index === 0 && !active) || (index > 0 && active === values.values[index - 1])) return;
      if (autoRanges.length > 0 && !autoRanges.some(({ start, end }) => time >= start && time <= (end ?? Infinity)))
        return;
      events.push({ time, name: match[1], active });
    });
  }
  traces.sort((a, b) => a[0].time - b[0].time);
  runs.sort((a, b) => a[0].time - b[0].time);
  events.sort((a, b) => a.time - b.time);
  return { traces, runs, errors, events };
}

export default class PathPlannerReplay {
  private readonly toggle: HTMLInputElement;
  private readonly status: HTMLElement;
  private readonly chart: HTMLCanvasElement;
  private readonly events: HTMLElement;
  private readonly waypoint: HTMLSelectElement;
  private readonly passes: HTMLElement;
  private data?: ReturnType<typeof analyzePathPlannerReplay>;
  private log?: Log;
  private refreshed = -Infinity;
  private paths: PathPlannerPath[] = [];
  private waypointCount = 0;
  private passKey = "";
  private chartTime: number | null | undefined;
  private chartEnabled = false;

  constructor(private readonly root: HTMLDetailsElement) {
    this.toggle = root.querySelector<HTMLInputElement>(".pathplanner-compare")!;
    this.status = root.querySelector(".pathplanner-replay-status")!;
    this.chart = root.querySelector(".pathplanner-errors")!;
    this.events = root.querySelector(".pathplanner-events")!;
    this.waypoint = root.querySelector(".pathplanner-pass-waypoint")!;
    this.passes = root.querySelector(".pathplanner-passes")!;
  }

  getActiveFields() {
    if (!this.root.open || !this.root.closest("details.pathplanner")?.hasAttribute("open")) return [];
    return window.log.getFieldKeys().filter((key) => {
      const name = removeMergePrefix(key);
      return poseField.test(name) || eventField.test(name);
    });
  }

  refreshLog() {
    this.log = undefined;
  }

  private jump(label: string, time: number) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => window.selection.setSelectedTime(time));
    return button;
  }

  private renderEvents() {
    const heading = document.createElement("strong");
    heading.textContent = window.t("hub.pathPlanner.replayEvents");
    this.events.replaceChildren(heading);
    const names = new Set<string>();
    for (const path of this.paths) {
      const markers = path.document.eventMarkers;
      if (!Array.isArray(markers)) continue;
      for (const marker of markers) {
        if (marker && typeof marker.name === "string" && marker.name) names.add(marker.name);
      }
    }
    for (const name of names) {
      const label = window.t("hub.pathPlanner.eventPlanned", { name });
      const match = this.data!.events.find((event) => event.active && event.name === name);
      const row = match ? this.jump(label, match.time) : document.createElement("div");
      if (!match) row.textContent = label;
      this.events.append(row);
    }
    for (const event of this.data!.events.slice(0, 200)) {
      this.events.append(
        this.jump(
          window.t(event.active ? "hub.pathPlanner.eventStart" : "hub.pathPlanner.eventFinish", {
            name: event.name,
            time: event.time.toFixed(2)
          }),
          event.time
        )
      );
    }
  }

  private drawErrors(time: number | null) {
    const errors = this.data!.errors;
    const points = errors.flat();
    this.chart.hidden = !this.toggle.checked || points.length === 0;
    const current =
      time === null
        ? undefined
        : errors
            .map((series) => latest(series, time))
            .filter((sample): sample is TrackingError => !!sample && time - sample.time <= 0.25)
            .sort((a, b) => b.time - a.time)[0];
    const status =
      this.data!.traces.length === 0
        ? window.t("hub.pathPlanner.replayMissing")
        : !this.toggle.checked
        ? ""
        : points.length === 0
        ? window.t("hub.pathPlanner.targetMissing")
        : current
        ? window.t("hub.pathPlanner.replayError", {
            meters: current.meters.toFixed(2),
            degrees: current.degrees.toFixed(1)
          })
        : "";
    if (this.status.textContent !== status) this.status.textContent = status;
    if (this.chart.hidden) return;

    const ctx = this.chart.getContext("2d")!;
    const { width, height } = this.chart;
    const [start, end] = window.log.getTimestampRange();
    const x = (t: number) => 5 + ((t - start) / Math.max(end - start, 0.001)) * (width - 10);
    ctx.fillStyle = "#191919";
    ctx.fillRect(0, 0, width, height);
    for (const [metric, color, unit, top] of [
      ["meters", "#ffe300", "m", 0],
      ["degrees", "#56dfff", "°", height / 2]
    ] as const) {
      const max = points.reduce((peak, sample) => Math.max(peak, sample[metric]), 0.01);
      const bottom = top + height / 2 - 4;
      const y = (value: number) => bottom - (value / max) * (height / 2 - 21);
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.fillText(max.toFixed(1) + " " + unit, 5, top + 12);
      for (const series of errors) {
        ctx.beginPath();
        series.forEach((sample, index) => {
          if (index === 0 || sample.time - series[index - 1].time > 0.25) ctx.moveTo(x(sample.time), y(sample[metric]));
          else ctx.lineTo(x(sample.time), y(sample[metric]));
        });
        ctx.stroke();
      }
    }
    if (time !== null) {
      ctx.strokeStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(x(time), 0);
      ctx.lineTo(x(time), height);
      ctx.stroke();
    }
  }

  update(
    paths: PathPlannerPath[],
    width: number,
    height: number,
    transform: (point: Translation2d, index: number) => Translation2d
  ) {
    if (!this.root.open || !this.root.closest("details.pathplanner")?.hasAttribute("open")) return [];
    const now = performance.now();
    const live = window.selection.getCurrentLiveTime() !== null;
    const refresh = this.log !== window.log || (live && now - this.refreshed >= 1000);
    const newPaths = paths.length !== this.paths.length || paths.some((path, index) => path !== this.paths[index]);
    if (refresh || !this.data) {
      this.log = window.log;
      this.refreshed = now;
      this.data = analyzePathPlannerReplay(window.log);
    }
    const waypoints = paths.flatMap((path, segment) =>
      path.document.waypoints.map(({ anchor }, index) => ({
        anchor,
        segment,
        label: (paths.length > 1 ? segment + 1 + " · " : "") + path.name + " · " + (index + 1)
      }))
    );
    if (newPaths || this.waypointCount !== waypoints.length) {
      this.paths = paths;
      this.waypointCount = waypoints.length;
      this.waypoint.replaceChildren(...waypoints.map(({ label }) => new Option(label)));
      this.waypoint.disabled = waypoints.length === 0;
    }
    if (refresh || newPaths) this.renderEvents();
    const time = window.selection.getRenderTime();
    if (refresh || time !== this.chartTime || this.chartEnabled !== this.toggle.checked) {
      this.chartTime = time;
      this.chartEnabled = this.toggle.checked;
      this.drawErrors(time);
    }

    const waypoint = waypoints[this.waypoint.selectedIndex];
    const target = waypoint ? transform([waypoint.anchor.x, waypoint.anchor.y], waypoint.segment) : undefined;
    const passKey = JSON.stringify([target, width, height, this.waypoint.selectedIndex]);
    if (refresh || newPaths || passKey !== this.passKey) {
      this.passKey = passKey;
      this.passes.replaceChildren();
      if (target)
        this.data.runs.forEach((run, index) => {
          let closest: { time: number; distance: number } | undefined;
          for (const { time, pose } of run) {
            const [x, y] = convertFromCoordinateSystem(pose, "wall-blue", "blue", width, height).translation;
            const distance = Math.hypot(x - target[0], y - target[1]);
            if (!closest || distance < closest.distance) closest = { time, distance };
          }
          if (closest)
            this.passes.append(
              this.jump(
                window.t("hub.pathPlanner.waypointPass", {
                  run: index + 1,
                  distance: closest.distance.toFixed(2),
                  time: closest.time.toFixed(2)
                }),
                closest.time
              )
            );
        });
    }
    if (!this.toggle.checked) return [];
    return this.getTrails(width, height);
  }

  private trailCache?: {
    data: ReturnType<typeof analyzePathPlannerReplay> | undefined;
    width: number;
    height: number;
    objects: Field2dRendererCommand_TrajectoryObj[];
  };

  private getTrails(width: number, height: number): Field2dRendererCommand_TrajectoryObj[] {
    if (this.trailCache?.data === this.data && this.trailCache?.width === width && this.trailCache.height === height)
      return this.trailCache.objects;
    const objects: Field2dRendererCommand_TrajectoryObj[] = this.data!.runs.map((run) => ({
      type: "trajectory",
      color: "#56dfff",
      size: "normal",
      poses: run
        .filter((_, index) => index % Math.max(1, Math.ceil(run.length / 2000)) === 0 || index === run.length - 1)
        .map(({ pose }) => ({
          pose: convertFromCoordinateSystem(pose, "wall-blue", "blue", width, height),
          annotation: { is2DSource: true }
        }))
    }));
    this.trailCache = { data: this.data, width, height, objects };
    return objects;
  }
}
