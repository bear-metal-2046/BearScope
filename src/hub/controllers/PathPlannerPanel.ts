// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import type { PathPlannerProjectSnapshot } from "../../main/electron/PathPlannerProject";
import { IS_LITE } from "../../shared/buildConstants";
import type { Translation2d } from "../../shared/geometry";
import type {
  Field2dPathPlannerHandle,
  Field2dRendererCommand_TrajectoryObj
} from "../../shared/renderers/Field2dRenderer";
import {
  PathPlannerAuto,
  PathPlannerPath,
  PathPlannerPoint,
  PathPlannerPointKey,
  importPathPlannerFiles,
  movePathPlannerPoint,
  samplePathPlannerPath
} from "../PathPlanner";
import PathPlannerReplay from "../PathPlannerReplay";

const pointKeys = ["anchor", "prevControl", "nextControl"] as const;

export default class PathPlannerPanel {
  private readonly route: HTMLSelectElement;
  private readonly side: HTMLSelectElement;
  private readonly waypoint: HTMLSelectElement;
  private readonly editor: HTMLElement;
  private readonly points: HTMLElement[];
  private readonly status: HTMLElement;
  private readonly issues: HTMLUListElement;
  private readonly link: HTMLButtonElement;
  private readonly replay: PathPlannerReplay;
  private paths: PathPlannerPath[] = [];
  private autos: PathPlannerAuto[] = [];
  private project?: string;
  private revision = 0;
  private fieldSize: Translation2d = [0, 0];
  private cachedOverlay?: { key: string; objects: Field2dRendererCommand_TrajectoryObj[] };

  constructor(
    private readonly root: HTMLDetailsElement,
    private readonly getTabId: () => string
  ) {
    this.route = root.querySelector<HTMLSelectElement>(".pathplanner-route")!;
    this.replay = new PathPlannerReplay(root.querySelector<HTMLDetailsElement>(".pathplanner-replay")!);
    this.side = root.querySelector<HTMLSelectElement>(".pathplanner-side")!;
    this.waypoint = root.querySelector<HTMLSelectElement>(".pathplanner-waypoint")!;
    this.editor = root.querySelector<HTMLElement>(".pathplanner-editor")!;
    this.points = Array.from(this.editor.querySelectorAll<HTMLElement>(".pathplanner-point"));
    this.status = root.querySelector<HTMLElement>(".pathplanner-status")!;
    this.issues = root.querySelector<HTMLUListElement>(".pathplanner-issues")!;
    this.link = root.querySelector<HTMLButtonElement>(".pathplanner-link")!;
    this.link.hidden = IS_LITE;
    const currentProject = root.querySelector<HTMLButtonElement>(".pathplanner-current-project")!;
    currentProject.hidden = IS_LITE;
    currentProject.addEventListener("click", () => {
      window.sendMainMessage("pathplanner-project-link-current", this.getTabId());
    });
    this.link.addEventListener("click", () => {
      if (this.project !== undefined) this.unlinkProject();
      else window.sendMainMessage("pathplanner-project-link", this.getTabId());
    });

    const pickers = Array.from(root.querySelectorAll<HTMLInputElement>('input[type="file"]'));
    const openButtons = root.querySelectorAll<HTMLButtonElement>(".pathplanner-open button");
    pickers.forEach((picker, index) => {
      openButtons[index].addEventListener("click", () => picker.click());
      picker.addEventListener("change", async () => {
        const files = Array.from(picker.files ?? []);
        picker.value = "";
        if (files.length === 0) return;
        this.unlinkProject();
        openButtons.forEach((button) => (button.disabled = true));
        this.status.textContent = window.t("hub.pathPlanner.loading");
        this.issues.replaceChildren();
        try {
          await this.load(files.filter((file) => /\.(path|auto)$/i.test(file.name)));
        } finally {
          openButtons.forEach((button) => (button.disabled = false));
        }
      });
    });

    this.route.addEventListener("change", () => this.updateWaypoints());
    this.waypoint.addEventListener("change", () => this.updatePointInputs());
    this.points.forEach((row, index) => {
      const [x, y] = row.querySelectorAll("input");
      const apply = () => {
        this.editPoint(this.waypoint.selectedIndex, pointKeys[index], { x: x.valueAsNumber, y: y.valueAsNumber });
      };
      for (const input of [x, y]) {
        input.addEventListener("change", apply);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") input.blur();
        });
      }
    });
    root.querySelector<HTMLButtonElement>(".pathplanner-export")!.addEventListener("click", () => this.exportPath());
  }

  private get selectedPath(): PathPlannerPath | undefined {
    const index = this.route.selectedIndex - 1;
    return this.paths[index];
  }

  updateProject(snapshot: PathPlannerProjectSnapshot, invalid: boolean) {
    if (invalid) {
      this.status.textContent = window.t(
        snapshot.noCurrentProject ? "hub.pathPlanner.noCurrentProject" : "hub.pathPlanner.invalidProject"
      );
      return;
    }
    const sameProject = this.project === snapshot.folder;
    this.project = snapshot.folder;
    this.status.title = snapshot.folder;
    this.link.textContent = window.t("hub.pathPlanner.unlinkProject");
    if (snapshot.error) {
      ++this.revision;
      this.status.textContent = window.t("hub.pathPlanner.projectError");
      this.updateWaypoints();
      return;
    }
    void this.load(
      snapshot.files.map(({ name, text }) => new File([text], name)),
      sameProject
    );
  }

  unlinkProject() {
    window.sendMainMessage("pathplanner-project-unlink", this.getTabId());
    if (this.project === undefined) return;
    ++this.revision;
    this.project = undefined;
    this.status.title = "";
    this.status.textContent = "";
    this.link.textContent = window.t("hub.pathPlanner.linkProject");
    this.updateWaypoints();
  }

  private async load(files: File[], preserveSelection = false) {
    const revision = ++this.revision;
    const { paths, autos, issues } = await importPathPlannerFiles(files);
    if (revision !== this.revision) return;
    const previous = this.route.value;
    const linked = this.project !== undefined;
    this.issues.replaceChildren();
    for (const issue of issues) {
      const item = document.createElement("li");
      item.textContent = window.t(`hub.pathPlanner.${issue.key}`, issue);
      this.issues.appendChild(item);
    }
    const empty = paths.length + autos.length === 0;
    if (empty && !linked) {
      this.status.textContent = window.t("hub.pathPlanner.noFiles");
      return;
    }

    this.paths = paths.sort((a, b) => a.name.localeCompare(b.name));
    this.autos = autos.sort((a, b) => a.name.localeCompare(b.name));
    const off = this.route.options[0];
    this.route.replaceChildren(off);
    for (const [label, routes] of [
      ["paths", this.paths],
      ["autos", this.autos]
    ] as const) {
      if (routes.length === 0) continue;
      const group = document.createElement("optgroup");
      group.label = window.t(`hub.pathPlanner.${label}`);
      for (const route of routes) group.appendChild(new Option(route.name, `${label}/${route.name}`));
      this.route.appendChild(group);
    }
    this.route.selectedIndex = empty ? 0 : this.autos.length > 0 ? 1 + this.paths.length : 1;
    if (preserveSelection && [...this.route.options].some((option) => option.value === previous))
      this.route.value = previous;
    this.route.disabled = empty;
    this.side.disabled = empty;
    this.status.textContent = linked
      ? window.t(empty ? "hub.pathPlanner.emptyProject" : "hub.pathPlanner.linkedProject")
      : "";
    this.cachedOverlay = undefined;
    this.updateWaypoints();
  }

  private updateWaypoints() {
    const path = this.selectedPath;
    this.editor.hidden = path === undefined || this.project !== undefined;
    this.waypoint.replaceChildren();
    if (path === undefined) return;
    path.document.waypoints.forEach((_, index) => {
      this.waypoint.appendChild(new Option(window.t("hub.pathPlanner.waypointNumber", { number: index + 1 })));
    });
    this.updatePointInputs();
  }

  private updatePointInputs() {
    const waypoint = this.selectedPath?.document.waypoints[this.waypoint.selectedIndex];
    if (waypoint === undefined) return;
    this.editor.querySelector<HTMLElement>(".pathplanner-locked")!.hidden = !waypoint.isLocked;
    this.points.forEach((row, index) => {
      const point = waypoint[pointKeys[index]];
      row.hidden = point === null;
      if (point === null) return;
      const [x, y] = row.querySelectorAll("input");
      x.value = String(point.x);
      y.value = String(point.y);
      x.disabled = y.disabled = Boolean(waypoint.isLocked);
    });
  }

  private editPoint(index: number, key: PathPlannerPointKey, point: PathPlannerPoint) {
    const waypoint = this.selectedPath?.document.waypoints[index];
    if (waypoint === undefined) return;
    movePathPlannerPoint(waypoint, key, point);
    this.cachedOverlay = undefined;
    this.updatePointInputs();
  }

  private exportPath() {
    const path = this.selectedPath;
    if (path === undefined) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(path.document, null, 2) + "\n"], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = path.fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private transformCoordinates([x, y]: Translation2d, toFile = false): Translation2d {
    const [width, height] = this.fieldSize;
    const xDirection = this.side.value === "blue" ? -1 : 1;
    const yDirection = this.side.value === "rotate" ? 1 : -1;
    return toFile
      ? [x * xDirection + width / 2, y * yDirection + height / 2]
      : [(x - width / 2) * xDirection, (y - height / 2) * yDirection];
  }

  handleDrag(handle: Field2dPathPlannerHandle, position?: Translation2d) {
    if (!this.root.open || this.selectedPath === undefined || this.project !== undefined) return;
    this.waypoint.selectedIndex = handle.index;
    if (position === undefined) {
      this.updatePointInputs();
      return;
    }
    const [x, y] = this.transformCoordinates(position, true);
    this.editPoint(handle.index, handle.point, { x, y });
  }

  getOverlay(width: number, height: number) {
    this.fieldSize = [width, height];
    const selectedPath = this.selectedPath;
    const selectedAuto = this.autos[this.route.selectedIndex - this.paths.length - 1];
    const paths = selectedPath === undefined ? selectedAuto?.paths ?? [] : [selectedPath];
    const key = `${this.route.selectedIndex}/${this.side.value}/${width}/${height}`;
    if (this.cachedOverlay?.key !== key) {
      this.cachedOverlay = {
        key,
        objects: paths.map((path) => ({
          type: "trajectory",
          color: "#ff8c00",
          size: "normal",
          poses: samplePathPlannerPath(path).map((translation) => ({
            pose: { translation: this.transformCoordinates(translation), rotation: 0 },
            annotation: { is2DSource: true }
          }))
        }))
      };
    }
    const handles: Field2dPathPlannerHandle[] = [];
    if (selectedPath !== undefined && this.root.open && this.project === undefined) {
      selectedPath.document.waypoints.forEach((waypoint, index) => {
        const selected = this.waypoint.selectedIndex === index;
        for (const point of selected ? pointKeys : (["anchor"] as const)) {
          const coordinates = waypoint[point];
          if (coordinates === null) continue;
          handles.push({
            index,
            point,
            position: this.transformCoordinates([coordinates.x, coordinates.y]),
            anchor: this.transformCoordinates([waypoint.anchor.x, waypoint.anchor.y]),
            locked: Boolean(waypoint.isLocked),
            selected
          });
        }
      });
    }
    const recorded = this.replay.update(paths, width, height, (point) => this.transformCoordinates(point));
    return { objects: [...this.cachedOverlay.objects, ...recorded], handles };
  }
}
