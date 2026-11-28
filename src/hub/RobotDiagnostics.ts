// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import { grabModuleVelocities, grabPose2d } from "../shared/geometry";
import type Log from "../shared/log/Log";
import { removeMergePrefix } from "../shared/log/LogKeyUtils";
import LoggableType from "../shared/log/LoggableType";

export type DiagnosticRow = { label: string; value: string; time?: number; end?: number };
export const defaultDiagnostics = {
  name: "Bear Metal 2026",
  readiness: [
    { label: "Flywheel ready", key: "Shooter/Is At Target Speed" },
    { label: "Chassis aimed", key: "Chassis/Is At Shooting Angle" }
  ],
  context: [
    { label: "Requested flywheel speed", key: "Shooter/TargetVelocityRPS" },
    { label: "Measured flywheel speed", key: "Shooter/Right Motor/Velocity" },
    { label: "Requested hood angle", key: "Shooter/Requested Hood Angle" },
    { label: "Measured hood angle", key: "Shooter/Hood Motor/Position" },
    { label: "Heading error", key: "Chassis/Aiming Heading Error" },
    { label: "Indexer state", key: "Indexer/State" },
    { label: "Feed requested", key: "BearScope/Actions/FeedRequested" }
  ],
  thresholds: [
    { label: "Battery sag", key: "BatteryVoltage", below: true, limit: 7 },
    { label: "Scheduler spike", key: "ExecTimes/Subsystem/Total", below: false, limit: 20 },
    { label: "CANivore load", key: "CANivore/Bus Utilization", below: false, limit: 0.8 },
    ...["FL", "FR", "BL", "BR"].map((module) => ({
      label: module + " drive current",
      key: "Chassis/Drive SupplyCurrent/" + module,
      below: false,
      limit: 55
    }))
  ],
  visionPrefix: "Vision",
  odometry: "Chassis/OdometryPose",
  moduleTargets: "Chassis/TargetStates",
  moduleMeasured: "Chassis/MeasuredStates",
  moduleError: 0.8,
  steerErrorDegrees: 20,
  commandPrefix: "BearScope/Commands"
};
export type DiagnosticsPreset = typeof defaultDiagnostics;

export function parsePreset(text: string): DiagnosticsPreset {
  const preset = JSON.parse(text) as DiagnosticsPreset;
  const binding = (value: { label: string; key: string }) =>
    typeof value?.label === "string" && typeof value.key === "string" && value.key.length > 0;
  if (
    !preset ||
    typeof preset.name !== "string" ||
    !Array.isArray(preset.readiness) ||
    !preset.readiness.every(binding) ||
    !Array.isArray(preset.context) ||
    !preset.context.every(binding) ||
    !Array.isArray(preset.thresholds) ||
    !preset.thresholds.every(
      (rule) => binding(rule) && typeof rule.below === "boolean" && Number.isFinite(rule.limit)
    ) ||
    ![preset.visionPrefix, preset.odometry, preset.moduleTargets, preset.moduleMeasured, preset.commandPrefix].every(
      (key) => typeof key === "string" && key.length > 0
    ) ||
    !Number.isFinite(preset.moduleError) ||
    preset.moduleError <= 0 ||
    !Number.isFinite(preset.steerErrorDegrees) ||
    preset.steerErrorDegrees <= 0
  ) {
    throw new Error("Check the preset field names, bindings, and numeric thresholds.");
  }
  return preset;
}

function logicalKey(key: string) {
  return removeMergePrefix(key)
    .replace(/^(?:\/+|NT:)+/g, "")
    .replace(/^(?:AdvantageKit\/)?RealOutputs\//, "");
}

export function diagnosticSource(key: string) {
  return /^\/?(Log\d+)(?=\/)/.exec(key)?.[1] ?? "";
}

function bindingName(key: string) {
  return logicalKey(key.trim());
}

export function getDiagnosticFields(log: Log, preset: DiagnosticsPreset) {
  const exact = new Set(
    [
      ...[...preset.readiness, ...preset.context, ...preset.thresholds].map(({ key }) => key),
      preset.odometry,
      preset.moduleTargets,
      preset.moduleMeasured
    ].map(bindingName)
  );
  return log.getFieldKeys().filter((key) => {
    const name = logicalKey(key);
    return exact.has(name) || name.startsWith(preset.visionPrefix + "/") || name.startsWith(preset.commandPrefix + "/");
  });
}

function sample<T>(series: { timestamps: number[]; values: T[] } | undefined, time: number): T | undefined {
  const index = series?.timestamps.findLastIndex((timestamp) => timestamp <= time) ?? -1;
  return index === -1 ? undefined : series?.values[index];
}

export function formatDiagnosticValue(value: unknown): string {
  if (typeof value === "number") return value.toFixed(2);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string" && value.length) return value;
  if (Array.isArray(value) && value.length) return value.join(", ");
  return "No sample";
}

const format = formatDiagnosticValue;

type DiagnosticHistory = { incidents: DiagnosticRow[]; commands: DiagnosticRow[] };

export function diagnose(
  log: Log,
  preset: DiagnosticsPreset,
  time: number,
  match: string,
  previous?: DiagnosticHistory
) {
  const keys = log.getFieldKeys().filter((key) => diagnosticSource(key) === match);
  const exactKeys = new Set(keys);
  const byName = new Map(keys.map((key) => [logicalKey(key), key]));
  const lookup = (name: string) => (exactKeys.has(name) ? name : byName.get(bindingName(name)) ?? "");
  const missing = (field: string, expected?: LoggableType) => {
    if (!field) return "Field missing in this log";
    if (expected !== undefined && log.getType(field) !== expected) return "Expected a Boolean field";
    const first = log.getField(field)?.getTimestamps()[0];
    return first === undefined
      ? "Samples unavailable or loading"
      : first > time
      ? `First sample at ${first.toFixed(2)} s`
      : "No sample";
  };
  const read = (name: string) => {
    const data = log.getRange(lookup(name), time, time);
    return sample(data, time);
  };
  const readiness = preset.readiness.map(({ label, key }) => {
    const field = lookup(key);
    const data = log.getBoolean(field, -Infinity, time);
    const value = sample(data, time);
    const index = data?.timestamps.findLastIndex((timestamp) => timestamp <= time) ?? -1;
    return {
      label,
      value: value === undefined ? missing(field, LoggableType.Boolean) : value ? "Ready" : "Waiting",
      time: data?.timestamps[index]
    };
  });
  const context = preset.context.map(({ label, key }) => {
    const value = read(key);
    return { label, value: value === undefined ? missing(lookup(key)) : format(value) };
  });
  const incidents: (DiagnosticRow & { score: number })[] = [];
  for (const rule of previous ? [] : preset.thresholds) {
    const series = log.getNumber(lookup(rule.key), -Infinity, Infinity);
    if (!series) continue;
    let peak: (DiagnosticRow & { score: number }) | undefined;
    series.values.forEach((value, index) => {
      const delta = rule.below ? rule.limit - value : value - rule.limit;
      if (delta <= 0 || !Number.isFinite(delta)) {
        if (peak) incidents.push(peak);
        peak = undefined;
      } else if (!peak || delta / Math.max(Math.abs(rule.limit), 1) > peak.score) {
        peak = {
          label: rule.label,
          value: `${format(value)} (threshold ${rule.limit})`,
          time: series.timestamps[index],
          score: delta / Math.max(Math.abs(rule.limit), 1)
        };
      }
    });
    if (peak) incidents.push(peak);
  }

  const targetKey = lookup(preset.moduleTargets);
  const measuredKey = lookup(preset.moduleMeasured);
  const modules: DiagnosticRow[] = [];
  if (targetKey && measuredKey) {
    const getStates = (key: string, at: number) => grabModuleVelocities(log, key, at);
    const compare = (at: number) => {
      const targets = getStates(targetKey, at);
      return getStates(measuredKey, at).flatMap((actual, index) => {
        if (!targets[index]) return [];
        const target = targets[index];
        const angle = actual.angle - target.angle;
        return [
          {
            index,
            speed: Math.abs(actual.velocity - target.velocity),
            degrees: (Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) * 180) / Math.PI
          }
        ];
      });
    };
    compare(time).forEach(({ index, speed, degrees }) =>
      modules.push({ label: "Module " + (index + 1), value: `${format(speed)} m/s · ${format(degrees)}° error` })
    );
    const timestamps = previous
      ? []
      : log.getTimestamps([
          measuredKey,
          measuredKey + "/length",
          measuredKey + "/0/speed",
          measuredKey + "/0/velocity",
          measuredKey + "/0/angle/value"
        ]);
    const stride = Math.max(1, Math.ceil(timestamps.length / 3000));
    const peaks = new Map<number, DiagnosticRow & { score: number }>();
    const flush = (index: number) => {
      const peak = peaks.get(index);
      if (peak) incidents.push(peak);
      peaks.delete(index);
    };
    for (let i = 0; i < timestamps.length; i += stride) {
      const at = timestamps[i];
      for (const { index, speed, degrees } of compare(at)) {
        const score = Math.max(speed / preset.moduleError, degrees / preset.steerErrorDegrees);
        if (score <= 1) flush(index);
        else if (score > (peaks.get(index)?.score ?? 0)) {
          peaks.set(index, {
            label: "Module " + (index + 1),
            value: `${format(speed)} m/s · ${format(degrees)}° error`,
            time: at,
            score
          });
        }
      }
    }
    for (const index of peaks.keys()) flush(index);
  }

  const cameras = new Set<string>();
  const vision: DiagnosticRow[] = [];
  const fieldPoses: { label: string; x: number; y: number }[] = [];
  const pose = (key: string, label: string) => {
    const field = lookup(key);
    if (read(key + "/translation/x") === undefined || read(key + "/translation/y") === undefined) return;
    const [x, y] = grabPose2d(log, field, time)[0].pose.translation;
    if (Number.isFinite(x) && Number.isFinite(y)) fieldPoses.push({ label, x, y });
  };
  pose(preset.odometry, "Odometry");
  for (const name of byName.keys()) {
    if (!name.startsWith(preset.visionPrefix + "/")) continue;
    const camera = name.slice(preset.visionPrefix.length + 1).split("/")[0];
    cameras.add(camera);
  }
  for (const camera of cameras) {
    const prefix = preset.visionPrefix + "/" + camera;
    for (const metric of ["IDs Seen", "Avg Tag Ambiguity", "Failed Updates", "Heading Trust", "Rejection Reason"]) {
      const key = prefix + "/" + metric;
      if (byName.has(key)) vision.push({ label: camera + " · " + metric, value: format(read(key)) });
    }
    for (const estimate of ["MegaTag1/Position", "MegaTag2/Position", "AcceptedPose"])
      pose(prefix + "/" + estimate, camera + " " + estimate);
    const ambiguity = log.getNumber(lookup(prefix + "/Avg Tag Ambiguity"), -Infinity, Infinity);
    if (ambiguity && ambiguity.values.length) {
      const peak = ambiguity.values.reduce((best, value, i) => (value > ambiguity.values[best] ? i : best), 0);
      vision.push({
        label: camera + " · Peak ambiguity",
        value: format(ambiguity.values[peak]),
        time: ambiguity.timestamps[peak]
      });
    }
  }

  incidents.sort((a, b) => b.score - a.score);
  return {
    readiness,
    context,
    incidents: previous?.incidents ?? incidents.slice(0, 30),
    modules,
    vision,
    fieldPoses,
    commands: previous?.commands ?? readDiagnosticCommands(log, keys, preset.commandPrefix)
  };
}

export function readDiagnosticCommands(log: Log, keys: string[], prefix: string) {
  const commands: DiagnosticRow[] = [];
  for (const key of keys) {
    if (!logicalKey(key).startsWith(prefix + "/")) continue;
    const events = log.getString(key, -Infinity, Infinity);
    let open: DiagnosticRow | undefined;
    events?.values.forEach((value, index) => {
      try {
        const data = JSON.parse(value);
        if (typeof data.name !== "string") return;
        const at = events.timestamps[index];
        if (data.state === "start") {
          open = { label: data.name, value: "Started", time: at };
          commands.push(open);
        } else if (data.state === "finish" || data.state === "interrupt") {
          const value =
            data.state === "finish"
              ? "Finished"
              : typeof data.by === "string" && data.by.trim()
              ? "Interrupted by " + data.by
              : "Interrupted";
          if (open) Object.assign(open, { value, end: at });
          else commands.push({ label: data.name, value, time: at });
          open = undefined;
        }
      } catch {
        /* A malformed event is isolated to this sample. */
      }
    });
  }
  return commands.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
}
