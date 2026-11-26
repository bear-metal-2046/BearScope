// Copyright (c) 2021-2026 Littleton Robotics
// http://github.com/Mechanical-Advantage
//
// Use of this source code is governed by a BSD
// license that can be found in the LICENSE file
// at the root directory of this project.

using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

// Hosts the bundled Flutter application in the desktop hub's native window.
internal static class PathPlannerHost
{
    private const int WindowStyle = -16;
    private const int Child = 0x40000000;
    private const int ExtendedStyle = -20;
    private const int Layered = 0x80000;
    private const int ClipSiblings = 0x04000000;
    private const int PopupAndFrame = unchecked((int)0x80cf0000);
    private const uint NoActivate = 0x0010;
    private const uint FrameChanged = 0x0020;
    private const uint Show = 0x0040;
    private const uint CloseMessage = 0x0010;

    private delegate bool EnumWindowsCallback(IntPtr window, IntPtr data);

    [DllImport("user32.dll")] private static extern bool SetProcessDpiAwarenessContext(IntPtr value);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindow(IntPtr window);
    [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr data);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder name, int size);
    [DllImport("user32.dll", SetLastError = true)] private static extern int GetWindowLong(IntPtr window, int index);
    [DllImport("user32.dll", SetLastError = true)] private static extern int SetWindowLong(IntPtr window, int index, int value);
    [DllImport("user32.dll", SetLastError = true)] private static extern IntPtr SetParent(IntPtr window, IntPtr parent);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetLayeredWindowAttributes(IntPtr window, uint key, byte opacity, uint flags);
    [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
    [DllImport("user32.dll")] private static extern IntPtr GetParent(IntPtr window);
    [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr window, int command);
    [DllImport("user32.dll", SetLastError = true)] private static extern bool SetWindowPos(IntPtr window, IntPtr insertAfter, int x, int y, int width, int height, uint flags);
    [DllImport("user32.dll")] private static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);

    private static IntPtr FindPlannerWindow(int processId)
    {
        IntPtr result = IntPtr.Zero;
        EnumWindows(delegate(IntPtr window, IntPtr unused)
        {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner != processId || !IsWindowVisible(window)) return true;
            var name = new StringBuilder(64);
            GetClassName(window, name, name.Capacity);
            if (name.ToString() != "FLUTTER_RUNNER_WIN32_WINDOW") return true;
            GetWindowText(window, name, name.Capacity);
            if (name.ToString() != "PathPlanner") return true;
            result = window;
            return false;
        }, IntPtr.Zero);
        return result;
    }

    private static void ApplyViewport(IntPtr parent, IntPtr window, string line, ref string placement)
    {
        if (line == "hide" || IsIconic(parent) || !IsWindowVisible(parent))
        {
            if (placement != "hide") ShowWindowAsync(window, 0);
            placement = "hide";
            return;
        }
        string[] parts = line.Split(' ');
        if (parts.Length != 5 || parts[0] != "show") return;

        double scale = GetDpiForWindow(parent) / 96.0;
        int[] bounds = new int[4];
        for (int i = 0; i < bounds.Length; i++)
        {
            double value = double.Parse(parts[i + 1], CultureInfo.InvariantCulture);
            bounds[i] = (int)Math.Round(value * scale);
        }
        string next = string.Join("/", bounds);
        if (next == placement && IsWindowVisible(window)) return;
        uint flags = NoActivate | Show | FrameChanged;
        if (!SetWindowPos(window, IntPtr.Zero, bounds[0], bounds[1], bounds[2], bounds[3], flags))
        {
            throw new InvalidOperationException("Could not resize the embedded PathPlanner window.");
        }
        placement = next;
    }

    private static int Main(string[] args)
    {
        SetProcessDpiAwarenessContext(new IntPtr(-4)); // Per-monitor DPI awareness v2
        if (args.Length != 2) return 1;
        IntPtr parent = new IntPtr(long.Parse(args[0], CultureInfo.InvariantCulture));
        if (!IsWindow(parent)) return 1;
        IntPtr window = IntPtr.Zero;
        Process planner = null;
        try
        {
            planner = Process.Start(new ProcessStartInfo(args[1])
            {
                WorkingDirectory = Path.GetDirectoryName(args[1]),
                UseShellExecute = false,
                WindowStyle = ProcessWindowStyle.Hidden
            });
            var timeout = Stopwatch.StartNew();
            while (window == IntPtr.Zero && timeout.ElapsedMilliseconds < 15000 && !planner.HasExited && IsWindow(parent))
            {
                window = FindPlannerWindow(planner.Id);
                if (window == IntPtr.Zero) Thread.Sleep(35);
            }
            if (window == IntPtr.Zero) throw new InvalidOperationException("PathPlanner did not open its editor window.");
            // A layered child participates in Windows composition above Chromium's GPU surface.
            int style = GetWindowLong(window, WindowStyle);
            SetWindowLong(window, WindowStyle, (style & ~PopupAndFrame) | Child | ClipSiblings);
            SetWindowLong(window, ExtendedStyle, GetWindowLong(window, ExtendedStyle) | Layered);
            if (!SetLayeredWindowAttributes(window, 0, 255, 2)) throw new InvalidOperationException("Could not compose the editor.");
            SetParent(window, parent);
            if (GetParent(window) != parent) throw new InvalidOperationException("Could not dock the editor.");

            Console.WriteLine("ready");
            Console.Out.Flush();
            string placement = null;
            string viewport = "hide";
            while (!planner.HasExited && IsWindow(parent))
            {
                var command = Task.Run(() => Console.ReadLine());
                while (!command.Wait(32) && !planner.HasExited && IsWindow(parent))
                    ApplyViewport(parent, window, viewport, ref placement);
                if (!command.IsCompleted || command.Result == null || command.Result == "close") break;
                viewport = command.Result;
                ApplyViewport(parent, window, viewport, ref placement);
            }
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.Message);
            return 1;
        }
        finally
        {
            if (planner != null)
            {
                if (!planner.HasExited && IsWindow(window)) PostMessage(window, CloseMessage, IntPtr.Zero, IntPtr.Zero);
                if (!planner.WaitForExit(2000)) planner.Kill();
                planner.Dispose();
            }
        }
    }
}
