// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import { NoopRenderer } from "../shared/renderers/TabRenderer";

export default class PathPlannerWorkspaceRenderer extends NoopRenderer {
  private lastViewport = "";
  private failed = false;
  private readonly state: HTMLElement;
  private readonly retry: HTMLButtonElement;

  constructor(private readonly root: HTMLElement) {
    super();
    this.state = root.querySelector<HTMLElement>(".pathplanner-workspace-state")!;
    this.retry = root.querySelector<HTMLButtonElement>(".pathplanner-workspace-retry")!;
    this.retry.addEventListener("click", () => {
      this.failed = false;
      this.lastViewport = "";
      this.setState("loading");
    });
  }

  setState(state: string) {
    this.failed = ["closed", "failed", "unavailable", "busy"].includes(state);
    this.state.textContent = window.t(`hub.pathPlannerWorkspace.${state}`);
    this.retry.hidden = !this.failed || state === "unavailable";
  }

  render(): void {
    if (this.failed) return;
    const { left, top, width, height } = this.root.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const viewport = [left, top, width, height];
    const key = `${viewport}/${window.devicePixelRatio}`;
    if (key === this.lastViewport) return;
    this.lastViewport = key;
    window.sendMainMessage("pathplanner-workspace-viewport", viewport);
  }

  hide() {
    if (this.lastViewport !== "") window.sendMainMessage("pathplanner-workspace-viewport", null);
    this.lastViewport = "";
  }

  close() {
    window.sendMainMessage("pathplanner-workspace-close");
  }
}
