import 'package:flutter/material.dart';

/// Navigation lives inside the BearScope tab. Electron owns the window controls.
class CustomAppBar extends AppBar {
  CustomAppBar({
    Widget titleWidget = const Text('PathPlanner'),
    super.key,
    super.leading,
    super.automaticallyImplyLeading,
  }) : super(title: titleWidget, toolbarHeight: 44, elevation: 0);
}
