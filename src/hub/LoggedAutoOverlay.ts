// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import { annotatedPose3dTo2d, convertFromCoordinateSystem, grabPose2dArray } from "../shared/geometry";
import type Log from "../shared/log/Log";
import { removeMergePrefix } from "../shared/log/LogKeyUtils";
import type { Field2dRendererCommand_TrajectoryObj } from "../shared/renderers/Field2dRenderer";

export default class LoggedAutoOverlay {
  private readonly enabled: HTMLInputElement;
  private readonly status: HTMLElement;
  private log?: Log;
  private keys: string[] = [];
  private checkedAt = -Infinity;
  private cached?: {
    key: string;
    timestamp: number;
    width: number;
    height: number;
    object: Field2dRendererCommand_TrajectoryObj;
  };

  constructor(root: HTMLElement) {
    this.enabled = root.querySelector(".pathplanner-logged-auto")!;
    this.status = root.querySelector(".pathplanner-logged-auto-status")!;
  }

  getActiveFields() {
    return this.enabled.checked
      ? [
          ...new Set(
            window.log
              .getFieldKeys()
              .filter((key) => /(?:^|\/)Auto\/SelectedPath(?:\/length)?$/.test(removeMergePrefix(key)))
              .map((key) => key.replace(/\/length$/, ""))
          )
        ]
      : [];
  }

  refreshLog() {
    this.log = undefined;
    this.cached = undefined;
  }

  getOverlay(width: number, height: number): Field2dRendererCommand_TrajectoryObj[] {
    if (!this.enabled.checked) {
      this.status.textContent = "";
      return [];
    }
    const log = window.log;
    const now = performance.now();
    if (this.log !== log || (this.keys.length === 0 && now - this.checkedAt > 1000)) {
      this.log = log;
      this.keys = this.getActiveFields();
      this.cached = undefined;
      this.checkedAt = now;
    }
    const time = window.selection.getRenderTime() ?? log.getTimestampRange()[1];
    let latest: { key: string; timestamp: number } | undefined;
    for (const key of this.keys) {
      const timestamp =
        log.getRange(key, time, time)?.timestamps[0] ?? log.getNumber(key + "/length", time, time)?.timestamps[0];
      if (timestamp !== undefined && timestamp <= time && (!latest || timestamp > latest.timestamp))
        latest = { key, timestamp };
    }
    if (!latest) {
      this.status.textContent = window.t("hub.pathPlanner.loggedAutoMissing");
      return [];
    }
    if (this.status.textContent !== latest.key) this.status.textContent = latest.key;
    if (
      this.cached?.key !== latest.key ||
      this.cached.timestamp !== latest.timestamp ||
      this.cached.width !== width ||
      this.cached.height !== height
    ) {
      const poses = grabPose2dArray(log, latest.key, time).map(annotatedPose3dTo2d);
      this.cached = {
        ...latest,
        width,
        height,
        object: {
          type: "trajectory",
          color: "#ffe300",
          size: "normal",
          poses: convertFromCoordinateSystem(poses, "wall-blue", "blue", width, height)
        }
      };
    }
    return this.cached.object.poses.length ? [this.cached.object] : [];
  }
}
