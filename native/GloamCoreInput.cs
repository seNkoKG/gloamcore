using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

// Minimal first-party Windows input helper. One invocation performs exactly one
// user-triggered action: copying the currently hovered Path of Exile item.
// Every copy is bound to a foreground HWND/PID/process/title identity obtained
// immediately beforehand, and to an absolute deadline supplied by the app.
internal static class GloamCoreInput
{
    private const uint InputKeyboard = 1;
    private const uint KeyEventKeyUp = 0x0002;
    private const uint KeyEventUnicode = 0x0004;
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const ushort VirtualKeyControl = 0x11;
    private const ushort VirtualKeyShift = 0x10;
    private const ushort VirtualKeyAlt = 0x12;
    private const ushort VirtualKeyEnter = 0x0D;
    private const ushort VirtualKeyC = 0x43;
    private const ushort VirtualKeyLeft = 0x25;
    private const ushort VirtualKeyRight = 0x27;
    private const ushort VirtualKeyLeftMouse = 0x01;
    private const int MaxTitleLength = 256;
    private const int MaxProcessNameLength = 128;
    private const int MaxReleaseKeys = 8;
    private const int MaxAllowedProcesses = 8;
    private const int MaxChatTextLength = 512;
    private const int WhMouseLowLevel = 14;
    private const uint WmStartupFeedbackComplete = 0x8000;
    private const uint PeekMessageNoRemove = 0x0000;
    private const int WmMouseWheel = 0x020A;
    private const int PanelNoAction = 0;
    private const int PanelPromoteTracked = 10;
    private const int PanelHide = 11;
    private const int PanelReturnToTarget = 13;
    private const double PoeSidebarRatio = 370.0 / 600.0;
    private static readonly UTF8Encoding StrictUtf8 = new UTF8Encoding(false, true);

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public uint Type;
        public InputUnion Data;
    }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)]
        public KeyboardInput Keyboard;

        // These members preserve the native Win32 union size on x86 and x64.
        [FieldOffset(0)]
        public MouseInput Mouse;

        [FieldOffset(0)]
        public HardwareInput Hardware;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KeyboardInput
    {
        public ushort VirtualKey;
        public ushort ScanCode;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MouseInput
    {
        public int X;
        public int Y;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct HardwareInput
    {
        public uint Message;
        public ushort ParameterLow;
        public ushort ParameterHigh;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativePoint
    {
        public int X;
        public int Y;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeRect
    {
        public int Left;
        public int Top;
        public int Right;
        public int Bottom;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LowLevelMouseInput
    {
        public NativePoint Point;
        public uint MouseData;
        public uint Flags;
        public uint Time;
        public UIntPtr ExtraInfo;
    }

    private delegate IntPtr LowLevelMouseProcedure(int code, IntPtr message, IntPtr data);
    private static LowLevelMouseProcedure StashMouseProcedure;
    private static ushort StashModifierVirtualKey;

    private sealed class WindowIdentity
    {
        public IntPtr Handle;
        public uint ProcessId;
        public string ProcessName;
        public string Title;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(
        uint inputCount,
        [In] Input[] inputs,
        int inputSize
    );

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr window);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(
        IntPtr window,
        out uint processId
    );

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowTextLength(IntPtr window);

    [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int GetWindowText(
        IntPtr window,
        StringBuilder text,
        int maximumCount
    );

    [DllImport("user32.dll")]
    private static extern uint GetClipboardSequenceNumber();

    [DllImport("user32.dll")]
    private static extern short GetAsyncKeyState(int virtualKey);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetCursorPos(out NativePoint point);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetWindowRect(IntPtr window, out NativeRect bounds);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int hookId, LowLevelMouseProcedure callback, IntPtr module, uint threadId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hook, int code, IntPtr message, IntPtr data);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hook);

    [DllImport("user32.dll")]
    private static extern int GetMessage(out NativeMessage message, IntPtr window, uint minimum, uint maximum);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PeekMessage(
        out NativeMessage message,
        IntPtr window,
        uint minimum,
        uint maximum,
        uint removeMessage
    );

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool PostThreadMessage(
        uint threadId,
        uint message,
        UIntPtr wParam,
        IntPtr lParam
    );

    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();

    [StructLayout(LayoutKind.Sequential)]
    private struct NativeMessage
    {
        public IntPtr Window;
        public uint Message;
        public UIntPtr WParam;
        public IntPtr LParam;
        public uint Time;
        public NativePoint Point;
    }

    private static void CompleteStartupFeedback()
    {
        // This executable is compiled as a GUI process. Windows keeps the
        // working-in-background cursor active until that process retrieves its
        // first message, even though most helper commands do not run a message
        // loop. Post and retrieve one private thread message immediately so a
        // short copy or long-lived panel watcher never leaks that cursor into
        // Path of Exile or the overlay.
        NativeMessage message;
        PeekMessage(
            out message,
            IntPtr.Zero,
            WmStartupFeedbackComplete,
            WmStartupFeedbackComplete,
            PeekMessageNoRemove
        );
        if (PostThreadMessage(
            GetCurrentThreadId(),
            WmStartupFeedbackComplete,
            UIntPtr.Zero,
            IntPtr.Zero
        ))
        {
            GetMessage(
                out message,
                IntPtr.Zero,
                WmStartupFeedbackComplete,
                WmStartupFeedbackComplete
            );
        }
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(
        uint desiredAccess,
        [MarshalAs(UnmanagedType.Bool)] bool inheritHandle,
        uint processId
    );

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryFullProcessImageName(
        IntPtr process,
        uint flags,
        StringBuilder executableName,
        ref int size
    );

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);

    private static Input Key(ushort virtualKey, bool keyUp)
    {
        return new Input
        {
            Type = InputKeyboard,
            Data = new InputUnion
            {
                Keyboard = new KeyboardInput
                {
                    VirtualKey = virtualKey,
                    Flags = keyUp ? KeyEventKeyUp : 0,
                },
            },
        };
    }

    private static Input UnicodeKey(char codeUnit, bool keyUp)
    {
        return new Input
        {
            Type = InputKeyboard,
            Data = new InputUnion
            {
                Keyboard = new KeyboardInput
                {
                    VirtualKey = 0,
                    ScanCode = codeUnit,
                    Flags = KeyEventUnicode | (keyUp ? KeyEventKeyUp : 0),
                },
            },
        };
    }

    private static long UtcNowMilliseconds()
    {
        const long UnixEpochTicks = 621355968000000000L;
        return (DateTime.UtcNow.Ticks - UnixEpochTicks) / TimeSpan.TicksPerMillisecond;
    }

    private static bool TryPositiveLong(string value, out long parsed)
    {
        return long.TryParse(
            value,
            NumberStyles.None,
            CultureInfo.InvariantCulture,
            out parsed
        ) && parsed > 0;
    }

    private static bool TryPositiveUInt(string value, out uint parsed)
    {
        return uint.TryParse(
            value,
            NumberStyles.None,
            CultureInfo.InvariantCulture,
            out parsed
        ) && parsed > 0;
    }

    private static bool TryVirtualKey(string value, out ushort virtualKey)
    {
        virtualKey = 0;
        ushort parsed;
        if (!ushort.TryParse(
            value,
            NumberStyles.None,
            CultureInfo.InvariantCulture,
            out parsed
        ) || parsed == 0 || parsed > 0xfe) return false;
        virtualKey = parsed;
        return true;
    }

    private static bool IsSafeProcessName(string value)
    {
        if (string.IsNullOrEmpty(value) || value.Length > MaxProcessNameLength) return false;
        if (!value.EndsWith(".exe", StringComparison.OrdinalIgnoreCase)) return false;
        if (!string.Equals(Path.GetFileName(value), value, StringComparison.Ordinal)) return false;
        for (var index = 0; index < value.Length; index += 1)
        {
            var character = value[index];
            if (!(char.IsLetterOrDigit(character) || character == '_' ||
                  character == '-' || character == '.')) return false;
        }
        return true;
    }

    private static bool TryDecode(string value, int maximumLength, out string decoded)
    {
        decoded = null;
        try
        {
            var bytes = Convert.FromBase64String(value);
            var candidate = StrictUtf8.GetString(bytes);
            if (string.IsNullOrEmpty(candidate) || candidate.Length > maximumLength ||
                candidate.IndexOf('\0') >= 0) return false;
            decoded = candidate;
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string Encode(string value)
    {
        return Convert.ToBase64String(StrictUtf8.GetBytes(value));
    }

    private static bool TryReadProcessName(uint processId, out string processName)
    {
        processName = null;
        var process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero) return false;
        try
        {
            var capacity = 32768;
            var path = new StringBuilder(capacity);
            if (!QueryFullProcessImageName(process, 0, path, ref capacity)) return false;
            var candidate = Path.GetFileName(path.ToString());
            if (!IsSafeProcessName(candidate)) return false;
            processName = candidate;
            return true;
        }
        finally
        {
            CloseHandle(process);
        }
    }

    private static bool TryReadForegroundIdentity(out WindowIdentity identity)
    {
        identity = null;
        var window = GetForegroundWindow();
        if (window == IntPtr.Zero || !IsWindow(window)) return false;

        uint processId;
        if (GetWindowThreadProcessId(window, out processId) == 0 || processId == 0) return false;
        var titleLength = GetWindowTextLength(window);
        if (titleLength <= 0 || titleLength > MaxTitleLength) return false;
        var title = new StringBuilder(titleLength + 1);
        if (GetWindowText(window, title, title.Capacity) != titleLength) return false;

        string processName;
        if (!TryReadProcessName(processId, out processName)) return false;
        identity = new WindowIdentity
        {
            Handle = window,
            ProcessId = processId,
            ProcessName = processName,
            Title = title.ToString(),
        };
        return true;
    }

    private static bool IdentityMatches(
        WindowIdentity actual,
        IntPtr expectedHandle,
        uint expectedProcessId,
        string expectedProcessName,
        string expectedTitle
    )
    {
        return actual != null &&
            actual.Handle == expectedHandle &&
            actual.ProcessId == expectedProcessId &&
            string.Equals(actual.ProcessName, expectedProcessName, StringComparison.OrdinalIgnoreCase) &&
            string.Equals(actual.Title, expectedTitle, StringComparison.Ordinal);
    }

    private static bool IsAllowedProcess(string actual, ICollection<string> allowed)
    {
        foreach (var expected in allowed)
        {
            if (string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase)) return true;
        }
        return false;
    }

    private static bool IsAllowedIdentity(WindowIdentity actual, ICollection<WindowIdentity> allowed)
    {
        if (actual == null) return false;
        foreach (var expected in allowed)
        {
            if (string.Equals(actual.ProcessName, expected.ProcessName, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(actual.Title, expected.Title, StringComparison.Ordinal)) return true;
        }
        return false;
    }

    private static int Inspect(string[] arguments)
    {
        // inspect <deadline-ms> <expected-title-b64> <allowed-process.exe> [...]
        if (arguments.Length < 4 || arguments.Length > 11) return 64;
        long deadline;
        string expectedTitle;
        if (!TryPositiveLong(arguments[1], out deadline) ||
            !TryDecode(arguments[2], MaxTitleLength, out expectedTitle)) return 64;
        var allowedProcesses = new List<string>();
        for (var index = 3; index < arguments.Length; index += 1)
        {
            if (!IsSafeProcessName(arguments[index])) return 64;
            allowedProcesses.Add(arguments[index]);
        }
        if (UtcNowMilliseconds() >= deadline) return 66;

        WindowIdentity actual;
        if (!TryReadForegroundIdentity(out actual)) return 67;
        if (!string.Equals(actual.Title, expectedTitle, StringComparison.Ordinal) ||
            !IsAllowedProcess(actual.ProcessName, allowedProcesses)) return 65;
        if (UtcNowMilliseconds() >= deadline) return 66;

        Console.Out.WriteLine(
            actual.Handle.ToInt64().ToString(CultureInfo.InvariantCulture) + "|" +
            actual.ProcessId.ToString(CultureInfo.InvariantCulture) + "|" +
            Encode(actual.ProcessName) + "|" +
            Encode(actual.Title)
        );
        return 0;
    }

    private static int CopyIdentity(
        WindowIdentity expected,
        long deadline,
        uint waitMilliseconds,
        IList<ushort> releaseKeys,
        ushort preserveHeldVirtualKey
    )
    {
        var preserveHeldModifier = preserveHeldVirtualKey != 0 &&
            (GetAsyncKeyState(preserveHeldVirtualKey) & 0x8000) != 0;
        var preserveControl = preserveHeldModifier && preserveHeldVirtualKey == VirtualKeyControl;
        var effectiveReleaseKeys = new List<ushort>();
        foreach (var virtualKey in releaseKeys)
        {
            if (!(preserveHeldModifier && virtualKey == preserveHeldVirtualKey))
                effectiveReleaseKeys.Add(virtualKey);
        }
        var releaseCount = effectiveReleaseKeys.Count;
        var copyInputCount = preserveControl ? 2 : 4;
        var inputs = new Input[releaseCount + copyInputCount];
        for (var index = 0; index < releaseCount; index += 1)
        {
            inputs[index] = Key(effectiveReleaseKeys[releaseCount - index - 1], true);
        }
        if (preserveControl)
        {
            inputs[releaseCount] = Key(VirtualKeyC, false);
            inputs[releaseCount + 1] = Key(VirtualKeyC, true);
        }
        else
        {
            inputs[releaseCount] = Key(VirtualKeyControl, false);
            inputs[releaseCount + 1] = Key(VirtualKeyC, false);
            inputs[releaseCount + 2] = Key(VirtualKeyC, true);
            inputs[releaseCount + 3] = Key(VirtualKeyControl, true);
        }

        if (UtcNowMilliseconds() >= deadline) return 66;
        WindowIdentity actual;
        if (!TryReadForegroundIdentity(out actual) ||
            !IdentityMatches(
                actual,
                expected.Handle,
                expected.ProcessId,
                expected.ProcessName,
                expected.Title
            )) return 65;

        // This is the final gate immediately before SendInput. A delayed helper
        // or an alt-tab after validation therefore fails closed.
        if (UtcNowMilliseconds() >= deadline ||
            GetForegroundWindow() != expected.Handle) return 66;
        var clipboardSequence = GetClipboardSequenceNumber();
        var sent = SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
        if (sent != inputs.Length) return 1;

        var waitDeadline = Math.Min(deadline, UtcNowMilliseconds() + waitMilliseconds);
        while (UtcNowMilliseconds() < waitDeadline)
        {
            if (GetForegroundWindow() != expected.Handle) return 65;
            if (GetClipboardSequenceNumber() != clipboardSequence)
            {
                if (!TryReadForegroundIdentity(out actual) ||
                    !IdentityMatches(
                        actual,
                        expected.Handle,
                        expected.ProcessId,
                        expected.ProcessName,
                        expected.Title
                    )) return 65;
                return 0;
            }
            Thread.Sleep(8);
        }
        return 3;
    }

    private static int Copy(string[] arguments)
    {
        // copy <deadline-ms> <wait-ms> <hwnd> <pid> <process-b64> <title-b64> [release-vk ...]
        if (arguments.Length < 7 || arguments.Length > 7 + MaxReleaseKeys) return 64;
        long deadline;
        uint waitMilliseconds;
        long expectedHandleValue;
        uint expectedProcessId;
        string expectedProcessName;
        string expectedTitle;
        if (!TryPositiveLong(arguments[1], out deadline) ||
            !TryPositiveUInt(arguments[2], out waitMilliseconds) ||
            waitMilliseconds > 2000 ||
            !TryPositiveLong(arguments[3], out expectedHandleValue) ||
            !TryPositiveUInt(arguments[4], out expectedProcessId) ||
            !TryDecode(arguments[5], MaxProcessNameLength, out expectedProcessName) ||
            !IsSafeProcessName(expectedProcessName) ||
            !TryDecode(arguments[6], MaxTitleLength, out expectedTitle)) return 64;

        var releaseKeys = new List<ushort>();
        var releaseCount = arguments.Length - 7;
        for (var index = 0; index < releaseCount; index += 1)
        {
            ushort virtualKey;
            if (!TryVirtualKey(arguments[7 + index], out virtualKey)) return 64;
            releaseKeys.Add(virtualKey);
        }
        return CopyIdentity(
            new WindowIdentity
            {
                Handle = new IntPtr(expectedHandleValue),
                ProcessId = expectedProcessId,
                ProcessName = expectedProcessName,
                Title = expectedTitle,
            },
            deadline,
            waitMilliseconds,
            releaseKeys,
            0
        );
    }

    private static int Capture(string[] arguments)
    {
        // capture <deadline-ms> <wait-ms> <preserve-held-vk> <expected-title-b64>
        //         <process-count> <process.exe> [...] <release-count> <release-vk> [...]
        if (arguments.Length < 8) return 64;
        long deadline;
        uint waitMilliseconds;
        ushort preserveHeldVirtualKey;
        string expectedTitle;
        int processCount;
        if (!TryPositiveLong(arguments[1], out deadline) ||
            !TryPositiveUInt(arguments[2], out waitMilliseconds) ||
            waitMilliseconds > 2000 ||
            !ushort.TryParse(
                arguments[3],
                NumberStyles.None,
                CultureInfo.InvariantCulture,
                out preserveHeldVirtualKey
            ) || preserveHeldVirtualKey > 0xfe ||
            !TryDecode(arguments[4], MaxTitleLength, out expectedTitle) ||
            !int.TryParse(arguments[5], NumberStyles.None, CultureInfo.InvariantCulture, out processCount) ||
            processCount < 1 || processCount > MaxAllowedProcesses) return 64;
        var processStart = 6;
        var releaseCountIndex = processStart + processCount;
        if (releaseCountIndex >= arguments.Length) return 64;
        var allowedProcesses = new List<string>();
        for (var index = 0; index < processCount; index += 1)
        {
            var processName = arguments[processStart + index];
            if (!IsSafeProcessName(processName)) return 64;
            allowedProcesses.Add(processName);
        }

        int releaseCount;
        if (!int.TryParse(
            arguments[releaseCountIndex],
            NumberStyles.None,
            CultureInfo.InvariantCulture,
            out releaseCount
        ) || releaseCount < 0 || releaseCount > MaxReleaseKeys ||
            arguments.Length != releaseCountIndex + 1 + releaseCount) return 64;
        var releaseKeys = new List<ushort>();
        for (var index = 0; index < releaseCount; index += 1)
        {
            ushort virtualKey;
            if (!TryVirtualKey(arguments[releaseCountIndex + 1 + index], out virtualKey)) return 64;
            releaseKeys.Add(virtualKey);
        }
        if (preserveHeldVirtualKey != 0 && !releaseKeys.Contains(preserveHeldVirtualKey)) return 64;

        if (UtcNowMilliseconds() >= deadline) return 66;
        WindowIdentity foreground;
        if (!TryReadForegroundIdentity(out foreground)) return 67;
        if (!string.Equals(foreground.Title, expectedTitle, StringComparison.Ordinal) ||
            !IsAllowedProcess(foreground.ProcessName, allowedProcesses)) return 65;
        return CopyIdentity(
            foreground,
            deadline,
            waitMilliseconds,
            releaseKeys,
            preserveHeldVirtualKey
        );
    }

    private static int PanelInteractionAction(
        bool moved,
        bool insideEntryArea,
        bool insidePanel,
        bool holdDown,
        bool leftDown,
        bool previousLeftDown,
        bool dismissOnOutsideClick
    )
    {
        var freshClick = leftDown && !previousLeftDown;
        if (freshClick)
        {
            // The Electron window is shaped to the visible card. It receives
            // this original click directly, before polling could promote it.
            if (insidePanel) return PanelNoAction;
            if (dismissOnOutsideClick) return PanelHide;
        }
        // Pointer hover is never an activation gesture. A passive price card
        // must leave Path of Exile focused until the player deliberately
        // clicks it or enters the widget column while holding the hotkey.
        if (moved && holdDown && insideEntryArea) return PanelPromoteTracked;
        return PanelNoAction;
    }

    private static bool ShouldReturnToTarget(
        bool moved,
        bool leftDown,
        bool cursorInsideArea
    )
    {
        return moved && !leftDown && !cursorInsideArea;
    }

    private static int WatchPanel(string[] arguments)
    {
        // watch-panel <deadline-ms> <hold-vk> <dismiss-on-outside-click>
        //             <entry-left> <entry-top> <entry-right> <entry-bottom>
        //             <panel-left> <panel-top> <panel-right> <panel-bottom>
        if (arguments.Length != 12) return 64;
        long deadline;
        ushort holdVirtualKey;
        bool dismissOnOutsideClick;
        int entryLeft;
        int entryTop;
        int entryRight;
        int entryBottom;
        int panelLeft;
        int panelTop;
        int panelRight;
        int panelBottom;
        if (!TryPositiveLong(arguments[1], out deadline) ||
            !TryVirtualKey(arguments[2], out holdVirtualKey) ||
            (arguments[3] != "0" && arguments[3] != "1") ||
            !int.TryParse(arguments[4], NumberStyles.Integer, CultureInfo.InvariantCulture, out entryLeft) ||
            !int.TryParse(arguments[5], NumberStyles.Integer, CultureInfo.InvariantCulture, out entryTop) ||
            !int.TryParse(arguments[6], NumberStyles.Integer, CultureInfo.InvariantCulture, out entryRight) ||
            !int.TryParse(arguments[7], NumberStyles.Integer, CultureInfo.InvariantCulture, out entryBottom) ||
            !int.TryParse(arguments[8], NumberStyles.Integer, CultureInfo.InvariantCulture, out panelLeft) ||
            !int.TryParse(arguments[9], NumberStyles.Integer, CultureInfo.InvariantCulture, out panelTop) ||
            !int.TryParse(arguments[10], NumberStyles.Integer, CultureInfo.InvariantCulture, out panelRight) ||
            !int.TryParse(arguments[11], NumberStyles.Integer, CultureInfo.InvariantCulture, out panelBottom) ||
            entryRight <= entryLeft || entryBottom <= entryTop ||
            panelRight <= panelLeft || panelBottom <= panelTop) return 64;
        dismissOnOutsideClick = arguments[3] == "1";

        NativePoint previousCursor;
        if (!GetCursorPos(out previousCursor)) return 67;
        var previousLeftDown = (GetAsyncKeyState(VirtualKeyLeftMouse) & 0x8000) != 0;
        while (UtcNowMilliseconds() < deadline)
        {
            NativePoint cursor;
            if (!GetCursorPos(out cursor)) return 67;
            var insideEntryArea = cursor.X > entryLeft && cursor.X < entryRight &&
                cursor.Y > entryTop && cursor.Y < entryBottom;
            var insidePanel = cursor.X > panelLeft && cursor.X < panelRight &&
                cursor.Y > panelTop && cursor.Y < panelBottom;
            var moved = cursor.X != previousCursor.X || cursor.Y != previousCursor.Y;
            var holdDown = (GetAsyncKeyState(holdVirtualKey) & 0x8000) != 0;
            var leftDown = (GetAsyncKeyState(VirtualKeyLeftMouse) & 0x8000) != 0;
            var action = PanelInteractionAction(
                moved,
                insideEntryArea,
                insidePanel,
                holdDown,
                leftDown,
                previousLeftDown,
                dismissOnOutsideClick
            );
            if (action != PanelNoAction) return action;
            previousCursor = cursor;
            previousLeftDown = leftDown;
            Thread.Sleep(8);
        }
        return 12;
    }

    private static int WatchPanelExit(string[] arguments)
    {
        // watch-panel-exit <deadline-ms> <overlay-hwnd> <left> <top> <right> <bottom>
        if (arguments.Length != 7) return 64;
        long deadline;
        long overlayHandleValue;
        int left;
        int top;
        int right;
        int bottom;
        if (!TryPositiveLong(arguments[1], out deadline) ||
            !TryPositiveLong(arguments[2], out overlayHandleValue) ||
            !int.TryParse(arguments[3], NumberStyles.Integer, CultureInfo.InvariantCulture, out left) ||
            !int.TryParse(arguments[4], NumberStyles.Integer, CultureInfo.InvariantCulture, out top) ||
            !int.TryParse(arguments[5], NumberStyles.Integer, CultureInfo.InvariantCulture, out right) ||
            !int.TryParse(arguments[6], NumberStyles.Integer, CultureInfo.InvariantCulture, out bottom) ||
            right <= left || bottom <= top) return 64;
        var overlayHandle = new IntPtr(overlayHandleValue);
        if (!IsWindow(overlayHandle)) return 65;

        NativePoint previousCursor;
        if (!GetCursorPos(out previousCursor)) return 67;
        while (UtcNowMilliseconds() < deadline)
        {
            if (!IsWindow(overlayHandle)) return 65;
            NativePoint cursor;
            if (!GetCursorPos(out cursor)) return 67;
            var moved = cursor.X != previousCursor.X || cursor.Y != previousCursor.Y;
            var leftDown = (GetAsyncKeyState(VirtualKeyLeftMouse) & 0x8000) != 0;
            var cursorInsideArea = cursor.X > left && cursor.X < right &&
                cursor.Y > top && cursor.Y < bottom;
            if (ShouldReturnToTarget(moved, leftDown, cursorInsideArea))
                return PanelReturnToTarget;
            previousCursor = cursor;
            Thread.Sleep(8);
        }
        return 12;
    }

    private static int SendText(string[] arguments)
    {
        // send-text <deadline-ms> <identity-count>
        //           <process.exe> <exact-title-b64> [...] <single-line-text-b64>
        if (arguments.Length < 6) return 64;
        long deadline;
        int identityCount;
        if (!TryPositiveLong(arguments[1], out deadline) ||
            !int.TryParse(arguments[2], NumberStyles.None, CultureInfo.InvariantCulture, out identityCount) ||
            identityCount < 1 || identityCount > MaxAllowedProcesses ||
            arguments.Length != 4 + (identityCount * 2)) return 64;

        var allowedIdentities = new List<WindowIdentity>();
        for (var index = 0; index < identityCount; index += 1)
        {
            var processName = arguments[3 + (index * 2)];
            string expectedTitle;
            if (!IsSafeProcessName(processName) ||
                !TryDecode(arguments[4 + (index * 2)], MaxTitleLength, out expectedTitle)) return 64;
            allowedIdentities.Add(new WindowIdentity { ProcessName = processName, Title = expectedTitle });
        }
        string text;
        if (!TryDecode(arguments[3 + (identityCount * 2)], MaxChatTextLength, out text) ||
            text.Length == 0 || text.IndexOf('\r') >= 0 || text.IndexOf('\n') >= 0 ||
            text.IndexOf('\0') >= 0) return 64;

        WindowIdentity foreground;
        if (UtcNowMilliseconds() >= deadline ||
            !TryReadForegroundIdentity(out foreground) ||
            !IsAllowedIdentity(foreground, allowedIdentities)) return 65;

        var inputs = new List<Input>();
        // Global accelerator modifiers may still be physically down. Releasing
        // them makes the following Enter and Unicode events deterministic.
        inputs.Add(Key(VirtualKeyControl, true));
        inputs.Add(Key(VirtualKeyShift, true));
        inputs.Add(Key(VirtualKeyAlt, true));
        inputs.Add(Key(VirtualKeyEnter, false));
        inputs.Add(Key(VirtualKeyEnter, true));
        foreach (var codeUnit in text)
        {
            inputs.Add(UnicodeKey(codeUnit, false));
            inputs.Add(UnicodeKey(codeUnit, true));
        }
        inputs.Add(Key(VirtualKeyEnter, false));
        inputs.Add(Key(VirtualKeyEnter, true));

        WindowIdentity finalForeground;
        if (UtcNowMilliseconds() >= deadline ||
            !TryReadForegroundIdentity(out finalForeground) ||
            !IdentityMatches(
                finalForeground,
                foreground.Handle,
                foreground.ProcessId,
                foreground.ProcessName,
                foreground.Title
            )) return 66;
        var payload = inputs.ToArray();
        var sent = SendInput((uint)payload.Length, payload, Marshal.SizeOf(typeof(Input)));
        return sent == payload.Length ? 0 : 1;
    }

    private static bool IsPoeWindow(WindowIdentity identity)
    {
        if (identity == null) return false;
        var process = identity.ProcessName;
        if (!string.Equals(identity.Title, "Path of Exile", StringComparison.Ordinal)) return false;
        return string.Equals(process, "PathOfExile_x64.exe", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(process, "PathOfExile_x64Steam.exe", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(process, "PathOfExile_x64EGS.exe", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(process, "PathOfExileSteam.exe", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(process, "PathOfExileEGS.exe", StringComparison.OrdinalIgnoreCase) ||
            string.Equals(process, "PathOfExile.exe", StringComparison.OrdinalIgnoreCase);
    }

    private static IntPtr StashMouseHook(int code, IntPtr message, IntPtr data)
    {
        if (code >= 0 && message.ToInt32() == WmMouseWheel &&
            (GetAsyncKeyState(StashModifierVirtualKey) & 0x8000) != 0)
        {
            WindowIdentity foreground;
            NativeRect bounds;
            if (TryReadForegroundIdentity(out foreground) && IsPoeWindow(foreground) &&
                GetWindowRect(foreground.Handle, out bounds))
            {
                var mouse = (LowLevelMouseInput)Marshal.PtrToStructure(data, typeof(LowLevelMouseInput));
                var width = bounds.Right - bounds.Left;
                var height = bounds.Bottom - bounds.Top;
                var inside = mouse.Point.X >= bounds.Left && mouse.Point.X <= bounds.Right &&
                    mouse.Point.Y >= bounds.Top && mouse.Point.Y <= bounds.Bottom;
                var sidebarRight = bounds.Left + (int)Math.Round(height * PoeSidebarRatio);
                var gridTop = bounds.Top + (height * 154) / 1600;
                var gridBottom = bounds.Top + (height * 1192) / 1600;
                var inStashGrid = mouse.Point.X <= sidebarRight && mouse.Point.Y > gridTop && mouse.Point.Y < gridBottom;
                if (width > 0 && height > 0 && inside && !inStashGrid)
                {
                    var delta = unchecked((short)((mouse.MouseData >> 16) & 0xffff));
                    if (delta != 0)
                    {
                        var virtualKey = delta > 0 ? VirtualKeyRight : VirtualKeyLeft;
                        var inputs = new[] { Key(virtualKey, false), Key(virtualKey, true) };
                        WindowIdentity finalForeground;
                        if (TryReadForegroundIdentity(out finalForeground) &&
                            IdentityMatches(
                                finalForeground,
                                foreground.Handle,
                                foreground.ProcessId,
                                foreground.ProcessName,
                                foreground.Title
                            ))
                        {
                            SendInput((uint)inputs.Length, inputs, Marshal.SizeOf(typeof(Input)));
                        }
                    }
                }
            }
        }
        return CallNextHookEx(IntPtr.Zero, code, message, data);
    }

    private static int WatchStashScroll(string[] arguments)
    {
        // watch-stash-scroll <Ctrl|Shift|Alt>
        if (arguments.Length != 2) return 64;
        StashModifierVirtualKey = string.Equals(arguments[1], "Ctrl", StringComparison.Ordinal) ? VirtualKeyControl :
            string.Equals(arguments[1], "Shift", StringComparison.Ordinal) ? VirtualKeyShift :
            string.Equals(arguments[1], "Alt", StringComparison.Ordinal) ? VirtualKeyAlt : (ushort)0;
        if (StashModifierVirtualKey == 0) return 64;
        StashMouseProcedure = StashMouseHook;
        var hook = SetWindowsHookEx(WhMouseLowLevel, StashMouseProcedure, IntPtr.Zero, 0);
        if (hook == IntPtr.Zero) return 1;
        try
        {
            NativeMessage message;
            while (GetMessage(out message, IntPtr.Zero, 0, 0) > 0) { }
            return 0;
        }
        finally
        {
            UnhookWindowsHookEx(hook);
        }
    }

    public static int Main(string[] arguments)
    {
        CompleteStartupFeedback();
        if (arguments.Length == 1 &&
            string.Equals(arguments[0], "self-test", StringComparison.OrdinalIgnoreCase))
        {
            var expectedInputSize = IntPtr.Size == 8 ? 40 : 28;
            if (Marshal.SizeOf(typeof(Input)) != expectedInputSize) return 2;
            if (PanelInteractionAction(false, true, true, true, false, false, true) != PanelNoAction) return 3;
            if (PanelInteractionAction(true, true, false, true, false, false, true) != PanelPromoteTracked) return 4;
            if (PanelInteractionAction(false, true, true, false, true, true, true) != PanelNoAction) return 5;
            if (PanelInteractionAction(false, true, true, false, true, false, true) != PanelNoAction) return 6;
            // Plain movement never dismisses a remotely positioned card.
            if (PanelInteractionAction(true, false, false, false, false, false, true) != PanelNoAction) return 7;
            // A fresh outside click dismisses only the unpinned close-on-blur card.
            if (PanelInteractionAction(false, false, false, false, true, false, true) != PanelHide) return 12;
            if (PanelInteractionAction(false, false, false, false, true, false, false) != PanelNoAction) return 15;
            // A direct card click remains owned by the shaped Electron window.
            if (PanelInteractionAction(true, true, true, true, true, false, true) != PanelNoAction) return 16;
            // Pointer entry alone stays passive.
            if (PanelInteractionAction(true, true, true, false, false, false, true) != PanelNoAction) return 17;
            if (ShouldReturnToTarget(false, false, false)) return 8;
            if (ShouldReturnToTarget(true, true, false)) return 9;
            if (ShouldReturnToTarget(true, false, true)) return 10;
            if (!ShouldReturnToTarget(true, false, false)) return 11;
            var poeOne = new WindowIdentity { ProcessName = "PathOfExile.exe", Title = "Path of Exile" };
            var identities = new List<WindowIdentity> { poeOne };
            if (!IsAllowedIdentity(poeOne, identities)) return 18;
            if (IsAllowedIdentity(new WindowIdentity { ProcessName = "PathOfExile.exe", Title = "Unexpected title" }, identities)) return 19;
            var captured = new WindowIdentity { Handle = new IntPtr(7), ProcessId = 9, ProcessName = "PathOfExile.exe", Title = "Path of Exile" };
            if (!IdentityMatches(captured, captured.Handle, captured.ProcessId, captured.ProcessName, captured.Title)) return 21;
            if (IdentityMatches(new WindowIdentity { Handle = new IntPtr(8), ProcessId = 9, ProcessName = "PathOfExile.exe", Title = "Path of Exile" }, captured.Handle, captured.ProcessId, captured.ProcessName, captured.Title)) return 22;
            if (IdentityMatches(new WindowIdentity { Handle = captured.Handle, ProcessId = 10, ProcessName = "PathOfExile.exe", Title = "Path of Exile" }, captured.Handle, captured.ProcessId, captured.ProcessName, captured.Title)) return 23;
            if (IdentityMatches(new WindowIdentity { Handle = captured.Handle, ProcessId = captured.ProcessId, ProcessName = "PathOfExile.exe", Title = "Unexpected title" }, captured.Handle, captured.ProcessId, captured.ProcessName, captured.Title)) return 24;
            if (IsPoeWindow(new WindowIdentity { ProcessName = "notepad.exe", Title = "Path of Exile" })) return 25;
            if (IsPoeWindow(new WindowIdentity { ProcessName = "PathOfExile.exe", Title = "Unexpected title" })) return 26;
            return 0;
        }
        if (arguments.Length == 0) return 64;
        if (string.Equals(arguments[0], "inspect", StringComparison.Ordinal))
            return Inspect(arguments);
        if (string.Equals(arguments[0], "copy", StringComparison.Ordinal))
            return Copy(arguments);
        if (string.Equals(arguments[0], "capture", StringComparison.Ordinal))
            return Capture(arguments);
        if (string.Equals(arguments[0], "watch-panel", StringComparison.Ordinal))
            return WatchPanel(arguments);
        if (string.Equals(arguments[0], "watch-panel-exit", StringComparison.Ordinal))
            return WatchPanelExit(arguments);
        if (string.Equals(arguments[0], "send-text", StringComparison.Ordinal))
            return SendText(arguments);
        if (string.Equals(arguments[0], "watch-stash-scroll", StringComparison.Ordinal))
            return WatchStashScroll(arguments);
        return 64;
    }
}
