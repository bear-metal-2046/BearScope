// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

import AdmZip from "adm-zip";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "win32") process.exit(0);

const root = path.dirname(fileURLToPath(import.meta.url));
const bundle = path.join(root, "vendor", "pathplanner");
const plannerExe = path.join(bundle, "pathplanner.exe");
const versionStamp = path.join(bundle, "release.txt");
const version = "2026.1.2";
const expectedHash = "f1735cae32511eb8cab80114a3b25f8a5e412267fc6882596167fc0476fb8d11";
const archiveUrl = `https://github.com/mjansen4857/pathplanner/releases/download/v${version}/PathPlanner-Windows-v${version}.zip`;

if (!fs.existsSync(plannerExe) || !fs.existsSync(versionStamp) || fs.readFileSync(versionStamp, "utf8") !== version) {
  let archive;
  if (process.argv[2]) {
    archive = fs.readFileSync(process.argv[2]);
  } else {
    const response = await fetch(archiveUrl);
    if (!response.ok) throw new Error(`PathPlanner download failed with HTTP ${response.status}`);
    archive = Buffer.from(await response.arrayBuffer());
  }
  if (createHash("sha256").update(archive).digest("hex") !== expectedHash) {
    throw new Error("PathPlanner release checksum mismatch");
  }
  new AdmZip(archive).extractAllTo(bundle, true);
  fs.writeFileSync(versionStamp, version);
}

fs.copyFileSync(path.join(root, "PATHPLANNER-LICENSE"), path.join(bundle, "LICENSE.txt"));
const compiler = path.join(
  process.env.SystemRoot ?? "C:\\Windows",
  "Microsoft.NET",
  "Framework64",
  "v4.0.30319",
  "csc.exe"
);
execFileSync(
  compiler,
  [
    "/nologo",
    "/optimize+",
    "/platform:x64",
    `/out:${path.join(bundle, "pathPlannerHost.exe")}`,
    path.join(root, "src", "main", "electron", "pathPlannerHost.cs")
  ],
  { stdio: "inherit" }
);
