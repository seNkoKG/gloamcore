using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;

// Minimal, windowless LuaJIT host for the installed Path of Building runtime.
// It deliberately exposes only read-only file enumeration inside the selected
// PoB root. All build input and calculation output travel over stdin/stdout.
internal static class Program
{
    private const int LuaGlobalsIndex = -10002;
    private const int LuaMultRet = -1;
    private static readonly DateTime UnixEpoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
    private static readonly LuaCallback FileSearchCallback = HostFileSearch;
    private static string allowedRoot = "";
    private static string allowedRootWithSeparator = "";

    [UnmanagedFunctionPointer(CallingConvention.Cdecl)]
    private delegate int LuaCallback(IntPtr state);

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool SetDllDirectory(string path);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr luaL_newstate();

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void luaL_openlibs(IntPtr state);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int luaL_loadfile(IntPtr state, [MarshalAs(UnmanagedType.LPStr)] string fileName);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int luaL_loadstring(IntPtr state, [MarshalAs(UnmanagedType.LPStr)] string source);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int lua_pcall(IntPtr state, int argumentCount, int resultCount, int errorFunction);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr lua_tolstring(IntPtr state, int index, out UIntPtr length);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern int lua_toboolean(IntPtr state, int index);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void lua_close(IntPtr state);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void lua_createtable(IntPtr state, int arrayCount, int recordCount);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void lua_setfield(IntPtr state, int index, [MarshalAs(UnmanagedType.LPStr)] string key);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void lua_pushcclosure(IntPtr state, IntPtr function, int upvalueCount);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern IntPtr lua_pushlstring(IntPtr state, IntPtr value, UIntPtr length);

    [DllImport("lua51.dll", CallingConvention = CallingConvention.Cdecl)]
    private static extern void lua_pushnil(IntPtr state);

    private static string ReadLuaString(IntPtr state, int index)
    {
        UIntPtr nativeLength;
        IntPtr value = lua_tolstring(state, index, out nativeLength);
        if (value == IntPtr.Zero)
        {
            return "";
        }

        ulong length = nativeLength.ToUInt64();
        if (length > Int32.MaxValue)
        {
            throw new InvalidDataException("Lua string exceeds the host limit.");
        }

        byte[] bytes = new byte[(int)length];
        Marshal.Copy(value, bytes, 0, bytes.Length);
        return Encoding.UTF8.GetString(bytes);
    }

    private static void PushLuaString(IntPtr state, string value)
    {
        byte[] bytes = Encoding.UTF8.GetBytes(value);
        IntPtr native = Marshal.AllocHGlobal(bytes.Length == 0 ? 1 : bytes.Length);
        try
        {
            if (bytes.Length > 0)
            {
                Marshal.Copy(bytes, 0, native, bytes.Length);
            }
            lua_pushlstring(state, native, new UIntPtr((uint)bytes.Length));
        }
        finally
        {
            Marshal.FreeHGlobal(native);
        }
    }

    private static bool IsInsideAllowedRoot(string candidate)
    {
        return String.Equals(candidate, allowedRoot, StringComparison.OrdinalIgnoreCase)
            || candidate.StartsWith(allowedRootWithSeparator, StringComparison.OrdinalIgnoreCase);
    }

    private static IEnumerable<string> EnumerateMatches(string specification, bool directoriesOnly)
    {
        string nativeSpecification = specification.Replace('/', Path.DirectorySeparatorChar);
        // Path.GetFullPath rejects '*' and '?' on .NET Framework. Resolve and
        // validate the directory separately, then pass the leaf pattern only
        // to Directory.GetFiles/GetDirectories.
        string rawDirectory = Path.GetDirectoryName(nativeSpecification) ?? allowedRoot;
        string pattern = Path.GetFileName(nativeSpecification);
        bool wildcard = pattern.IndexOf('*') >= 0 || pattern.IndexOf('?') >= 0;

        string directory = Path.GetFullPath(rawDirectory);
        string normalized = wildcard ? Path.Combine(directory, pattern) : Path.GetFullPath(nativeSpecification);
        if (!IsInsideAllowedRoot(directory) || !Directory.Exists(directory))
        {
            yield break;
        }

        FileAttributes directoryAttributes = File.GetAttributes(directory);
        if ((directoryAttributes & FileAttributes.ReparsePoint) != 0)
        {
            yield break;
        }

        if (!wildcard)
        {
            if (directoriesOnly ? Directory.Exists(normalized) : File.Exists(normalized))
            {
                FileAttributes attributes = File.GetAttributes(normalized);
                if ((attributes & FileAttributes.ReparsePoint) == 0 && IsInsideAllowedRoot(normalized))
                {
                    yield return normalized;
                }
            }
            yield break;
        }

        string[] matches = directoriesOnly
            ? Directory.GetDirectories(directory, pattern, SearchOption.TopDirectoryOnly)
            : Directory.GetFiles(directory, pattern, SearchOption.TopDirectoryOnly);
        Array.Sort(matches, StringComparer.OrdinalIgnoreCase);
        foreach (string match in matches)
        {
            string fullPath = Path.GetFullPath(match);
            FileAttributes attributes = File.GetAttributes(fullPath);
            if ((attributes & FileAttributes.ReparsePoint) == 0 && IsInsideAllowedRoot(fullPath))
            {
                yield return fullPath;
            }
        }
    }

    // Returns newline-delimited "mtimeMilliseconds<TAB>baseName" records.
    // Windows official PoB data filenames cannot contain newlines or tabs.
    private static int HostFileSearch(IntPtr state)
    {
        try
        {
            string specification = ReadLuaString(state, 1);
            bool directoriesOnly = lua_toboolean(state, 2) != 0;
            StringBuilder records = new StringBuilder();
            foreach (string match in EnumerateMatches(specification, directoriesOnly))
            {
                string name = Path.GetFileName(match);
                if (name.IndexOf('\t') >= 0 || name.IndexOf('\r') >= 0 || name.IndexOf('\n') >= 0)
                {
                    continue;
                }
                DateTime modified = directoriesOnly
                    ? Directory.GetLastWriteTimeUtc(match)
                    : File.GetLastWriteTimeUtc(match);
                long milliseconds = (long)(modified - UnixEpoch).TotalMilliseconds;
                records.Append(milliseconds).Append('\t').Append(name).Append('\n');
            }

            if (records.Length == 0)
            {
                lua_pushnil(state);
            }
            else
            {
                PushLuaString(state, records.ToString());
            }
            return 1;
        }
        catch
        {
            // A failed or out-of-bound search behaves exactly like no match.
            lua_pushnil(state);
            return 1;
        }
    }

    private static string LuaPath(string path)
    {
        return path.Replace('\\', '/');
    }

    private static string LuaError(IntPtr state)
    {
        string message = ReadLuaString(state, -1);
        return String.IsNullOrWhiteSpace(message) ? "Unknown Lua error." : message;
    }

    private static void RunString(IntPtr state, string source, string label)
    {
        int status = luaL_loadstring(state, source);
        if (status == 0)
        {
            status = lua_pcall(state, 0, LuaMultRet, 0);
        }
        if (status != 0)
        {
            throw new InvalidOperationException(label + ": " + LuaError(state));
        }
    }

    private static void RunFile(IntPtr state, string fileName, string label)
    {
        int status = luaL_loadfile(state, fileName);
        if (status == 0)
        {
            status = lua_pcall(state, 0, LuaMultRet, 0);
        }
        if (status != 0)
        {
            throw new InvalidOperationException(label + ": " + LuaError(state));
        }
    }

    public static int Main(string[] arguments)
    {
        if (arguments.Length != 5)
        {
            Console.Error.WriteLine("Usage: GloamCorePobHost <dll-dir> <pob-root> <runtime-lua-dir> <headless-wrapper> <worker>");
            return 64;
        }

        IntPtr state = IntPtr.Zero;
        try
        {
            string dllDirectory = Path.GetFullPath(arguments[0]);
            allowedRoot = Path.GetFullPath(arguments[1]).TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
            allowedRootWithSeparator = allowedRoot + Path.DirectorySeparatorChar;
            string runtimeLuaDirectory = Path.GetFullPath(arguments[2]);
            string wrapper = Path.GetFullPath(arguments[3]);
            string worker = Path.GetFullPath(arguments[4]);

            if (!File.Exists(Path.Combine(dllDirectory, "lua51.dll"))
                || !File.Exists(Path.Combine(allowedRoot, "Launch.lua"))
                || !Directory.Exists(runtimeLuaDirectory)
                || !File.Exists(wrapper)
                || !File.Exists(worker))
            {
                throw new FileNotFoundException("One or more required PoB headless-engine files are missing.");
            }
            if (!SetDllDirectory(dllDirectory))
            {
                throw new InvalidOperationException("Windows rejected the PoB DLL directory.");
            }

            Directory.SetCurrentDirectory(allowedRoot);
            state = luaL_newstate();
            if (state == IntPtr.Zero)
            {
                throw new InvalidOperationException("LuaJIT could not create a state.");
            }

            luaL_openlibs(state);
            lua_createtable(state, 0, 0);
            lua_setfield(state, LuaGlobalsIndex, "arg");
            lua_pushcclosure(state, Marshal.GetFunctionPointerForDelegate(FileSearchCallback), 0);
            lua_setfield(state, LuaGlobalsIndex, "HostFileSearch");

            string runtimeLua = LuaPath(runtimeLuaDirectory);
            string nativeDirectory = LuaPath(dllDirectory);
            RunString(
                state,
                "package.path = [=[" + runtimeLua + "/?.lua;" + runtimeLua + "/?/init.lua;]=] .. package.path\n"
                    + "package.cpath = [=[" + nativeDirectory + "/?.dll;]=] .. package.cpath",
                "runtime setup");
            RunFile(state, wrapper, "headless bootstrap");
            RunFile(state, worker, "calculation worker");
            return 0;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
        finally
        {
            if (state != IntPtr.Zero)
            {
                lua_close(state);
            }
        }
    }
}
