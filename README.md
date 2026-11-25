<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/static/img/banner-ltr-dark.webp">
    <source media="(prefers-color-scheme: light)" srcset="docs/static/img/banner-ltr-light.webp">
    <img alt="AdvantageScope" src="docs/static/img/banner-ltr-light.webp">
  </picture>
</h1>

[![Build](https://github.com/Mechanical-Advantage/AdvantageScope/actions/workflows/build.yml/badge.svg?branch=main)](https://github.com/Mechanical-Advantage/AdvantageScope/actions/workflows/build.yml)

AdvantageScope is a robot diagnostics, log review/analysis, and data visualization application for FIRST teams developed by Team 6328. It reads logs in WPILOG, Hoot (CTRE), REVLOG (REV Robotics), Road Runner, CSV, NI DS log, and RLOG file formats, plus live robot data viewing using NT4, Phoenix, RLOG, or FTC Dashboard streaming. AdvantageScope can be used with any WPILib project, but is also optimized for use with our [AdvantageKit](https://docs.advantagekit.org) log replay framework. Note that **AdvantageKit is not required to use AdvantageScope**.

AdvantageScope includes the following tools:

- A wide selection of flexible graphs and charts
- 2D and 3D field visualizations of pose data, with customizable CAD-based robots
- Synchronized video playback from a separately loaded match video
- Joystick visualization, showing driver actions on customizable controller representations
- Swerve drive module vector displays
- Console message review
- Log statistics analysis
- Flexible export options, with support for CSV and WPILOG

**View the [online documentation](https://docs.advantagescope.org) or find it offline by clicking the 📖 icon in the tab bar.**

Feedback, feature requests, and bug reports are welcome on the [issues page](https://github.com/Mechanical-Advantage/AdvantageScope/issues). See the [contribution page](CONTRIBUTING.md) for more information on contributing to AdvantageScope. For non-public inquiries, please send a message to software@team6328.org.

## PathPlanner fork

The Windows build runs the full AdvantageScope desktop app and bundles PathPlanner 2026.1.2. Open **Tabs → New Tab → PathPlanner** to use the upstream workspace inside the desktop window. Open **2D Field → PathPlanner → Link project…** to follow changes to the same robot project's saved paths and autos while viewing a log or live telemetry.

For quick edits in the 2D Field tab, import a `.path` file, drag its waypoints and handles, and export a copy. See the [2D Field guide](docs/docs/tab-reference/2d-field.md#pathplanner) for the complete workflow.

On Windows, `npm run pathplanner:prepare` verifies the upstream release archive and builds the native host. The normal desktop build scripts run this step automatically. The bundled PathPlanner release is distributed with its [MIT license](PATHPLANNER-LICENSE).

![Example screenshot](/docs/static/img/screenshot-light.webp)
