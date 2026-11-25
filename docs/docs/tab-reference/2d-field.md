---
sidebar_position: 2
---

import Tabs from '@theme/Tabs';
import TabItem from '@theme/TabItem';

# 🗺 2D Field {#2d-field}

The 2D field tab shows a 2D visualization of the robot overlayed on a map of the field. It can also show extra data like vision targeting status and reference poses.

<img src="/img/tab-reference/2d-field-1.webp" alt="Overview of 2D field tab" />

<details>
<summary>Timeline Controls</summary>

The timeline is used to control playback and visualization. Clicking on the timeline selects a time, and right-clicking deselects it. The selected time is synchronized across all tabs, making it easy to quickly find this location in other views.

Yellow sections indicate when the robot is autonomous, blue sections indicate when the robot is teleoperated, and gray sections indicate when the robot is in utility mode.

To zoom, place the cursor over the timeline and scroll up or down. A range can also be selected by clicking and dragging while holding `Shift`. Move left and right by scrolling horizontally (on supported devices), or by clicking and dragging on the timeline. When connected live, scrolling to the left unlocks from the current time, and scrolling all the way to the right locks to the current time again. Press `Ctrl+\` to zoom to the period where the robot is enabled.

<img src="/img/tab-reference/timeline.webp" alt="Timeline" />

</details>

## Camera Controls {#camera-controls}

Scroll up and down over the field to zoom in and out. Click and drag to pan across the field. Right-click anywhere on the field to open the camera menu with the following options:

- **Unlocked**: Pan and zoom are manual.
- **Locked to Robot**: The camera automatically pans to track the robot.
- **Locked to Robot & Rotation**: The camera automatically pans and rotates to track the robot and its rotation.

In either locked mode, the camera can be freely panned away from the robot. The orientation buttons in the control pane can be used to rotate the camera in any mode.

## Adding Objects {#adding-objects}

To get started, drag a field to the "Poses" section. Delete an object using the X button, or hide it temporarily by clicking the eye icon or double-clicking the field name. To remove all objects, click the trash can near the axis title and then `Clear All`. Objects can be rearranged in the list by clicking and dragging.

**To customize each object, click the colored icon or right-click on the field name.** AdvantageScope supports a large number of object types, many of which can be customized (such as changing colors). Some objects must be added as children to an existing object.

:::tip
To see a full list of supported object types, click the `?` icon. This list also includes the supported data types and whether the objects must be added as children.
:::

<img src="/img/tab-reference/2d-field-2.webp" alt="2D field with objects" />

## PathPlanner

In the Windows desktop build, open **Tabs → New Tab → PathPlanner** to use the bundled PathPlanner workspace. There you can create and edit paths and autonomous command groups, configure the robot, preview generated trajectories, edit navigation obstacles, and use PathPlanner's telemetry view. Choose your robot project in the workspace to save edits to the project.

In the 2D Field tab, expand **PathPlanner**, choose **Link project…**, and select the same robot project or its `pathplanner` deploy folder. Pick a path or auto for the overlay. The overlay refreshes as the workspace saves files. To edit the linked project, switch to the PathPlanner tab. To review PathPlannerLib pose topics published to NetworkTables or recorded in a log, click **Add robot telemetry** to add the current pose, target pose, and active path to **Poses** when those topics are available.

### Quick path edits

1. Choose your FRC field and expand **PathPlanner** in the 2D Field tab settings.
2. Use **Open files…** for individual `.path` files or **Open folder…** for the `src/main/deploy/pathplanner` folder. To preview an `.auto`, import its referenced `.path` files in the same selection.
3. Pick a path or auto. The orange overlay uses the blue origin from the path file. For a red-side preview, choose the rotation or mirror option that matches your robot's PathPlanner configuration.
4. To edit a path, select it under **Paths**. Drag a waypoint on the field, then drag its handles to adjust the curve. You can also pick a waypoint and enter X and Y in meters. Moving an anchor moves its handles with it. Editing a handle keeps the opposite handle aligned at interior waypoints.
5. Use **Export .path copy** to save your edits. Put the downloaded file in your PathPlanner project's `paths` folder. Keep the original filename if an auto references it.

The 2D Field overlay and quick editor support PathPlanner's `2025.0` file format. Quick edits apply to the selected path's waypoint geometry and preserve constraints, event markers, and other path data. Export before closing the tab or importing another set of files. Recheck linked waypoints in PathPlanner if you move an anchor shared by multiple files.

An auto overlay shows the geometry of its referenced paths. For live telemetry or replay, log PathPlanner's `setLogActivePathCallback` as a `Pose2d[]` and `setLogTargetPoseCallback` as a `Pose2d`, then drag those fields into **Poses** as **Trajectory** and **Ghost**. Add your odometry pose as **Robot** to compare it with the plan. Use the matching AdvantageScope coordinate system for your telemetry, such as **Blue Wall (FRC 2023–2026)** for WPILib blue-origin poses.

## Data Format {#data-format}

Geometry data should be published as a byte-encoded struct or protobuf. Various 2D and 3D geometry types are supported, including `Pose2d`, `Pose3d`, `Translation2d`, `Translation3d`, and more.

Many libraries support the struct format, including WPILib and AdvantageKit. The example code below shows how to log 2D pose data.

<Tabs groupId="library">
<TabItem value="wpilib-java" label="Java" default>

```java
Pose2d poseA = new Pose2d();
Pose2d poseB = new Pose2d();

Telemetry.log("MyPose", poseA);
Telemetry.log("MyPoseArray", new Pose2d[] {poseA, poseB});
```

</TabItem>
<TabItem value="wpilib-cpp" label="C++">

```cpp
wpi::math::Pose2d poseA;
wpi::math::Pose2d poseB;

wpi::telemetry::Log("MyPose", poseA);
wpi::telemetry::Log("MyPoseArray", std::vector{poseA, poseB});
```

</TabItem>
<TabItem value="wpilib-python" label="Python">

```python
from wpimath import Pose2d
import telemetry

pose_a = Pose2d()
pose_b = Pose2d()

telemetry.log("MyPose", pose_a)
telemetry.log("MyPoseArray", [pose_a, pose_b], element_type=Pose2d)
```

</TabItem>
<TabItem value="advantagekit" label="AdvantageKit">

```java
Pose2d poseA = new Pose2d();
Pose2d poseB = new Pose2d();

Logger.recordOutput("MyPose", poseA);
Logger.recordOutput("MyPoseArray", poseA, poseB);
Logger.recordOutput("MyPoseArray", new Pose2d[] {poseA, poseB});
```

</TabItem>
<TabItem value="ftcdashboard" label="FTC Dashboard">

```java
// This protocol does not support the modern struct format, but pose
// values can be published using separate fields that include the
// suffixes "x", "y", and "heading" (as shown below):
TelemetryPacket packet = new TelemetryPacket();
packet.put("Pose x", 6.3); // Inches
packet.put("Pose y", 2.8); // Inches
packet.put("Pose heading", 3.14); // Radians

// Alternatively, headings can be published in degrees
packet.put("Pose heading (deg)", 180.0); // Degrees

// Add other telemetry values here...

FtcDashboard.getInstance().sendTelemetryPacket(packet)

// Alternately, use MultipleTelemetry and the standard SDK telemetry:
// During OpMode Init:
telemetry = new MultipleTelemetry(telemetry,FtcDashboard.getInstance().getTelemetry());

// During Loop:
telemetry.addData("Pose x", 6.3); // Inches
telemetry.addData("Pose y", 2.8); // Inches
telemetry.addData("Pose heading", 3.14); // Radians

// or...
telemetry.addData("Pose heading (deg)", 180.0); // Degrees

// Add other telemetry values here...
telemetry.update();
```

</TabItem>
</Tabs>

## Configuration {#configuration}

- **Field:** The field image to use. All recent FRC and FTC games are supported. To add a custom field image, see [Custom Assets](/more-features/custom-assets).
- **Orientation:** The orientation of the field image in the viewer pane.
- **Size:** The side length of the robot (30/27/24 inches for FRC, 18/16/14 inches for FTC).

:::info
The coordinate system used on the this tab is customizable. See the [coordinate system](/more-features/coordinate-systems) page for details.
:::
