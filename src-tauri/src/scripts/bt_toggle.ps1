$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class IslandBt
{
    [StructLayout(LayoutKind.Sequential)]
    public struct SYSTEMTIME
    {
        public ushort wYear, wMonth, wDayOfWeek, wDay, wHour, wMinute, wSecond, wMilliseconds;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct BLUETOOTH_DEVICE_INFO
    {
        public uint dwSize;
        public ulong Address;
        public uint ulClassofDevice;
        [MarshalAs(UnmanagedType.Bool)] public bool fConnected;
        [MarshalAs(UnmanagedType.Bool)] public bool fRemembered;
        [MarshalAs(UnmanagedType.Bool)] public bool fAuthenticated;
        public SYSTEMTIME stLastSeen;
        public SYSTEMTIME stLastUsed;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string szName;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct BLUETOOTH_FIND_RADIO_PARAMS { public uint dwSize; }

    [DllImport("bthprops.cpl", SetLastError = true)]
    static extern IntPtr BluetoothFindFirstRadio(ref BLUETOOTH_FIND_RADIO_PARAMS p, out IntPtr hRadio);
    [DllImport("bthprops.cpl", SetLastError = true)]
    static extern bool BluetoothFindRadioClose(IntPtr hFind);
    [DllImport("bthprops.cpl", SetLastError = true)]
    static extern uint BluetoothGetDeviceInfo(IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info);
    [DllImport("bthprops.cpl", SetLastError = true)]
    static extern uint BluetoothSetServiceState(IntPtr hRadio, ref BLUETOOTH_DEVICE_INFO info, ref Guid service, uint flags);
    [DllImport("kernel32.dll")]
    static extern bool CloseHandle(IntPtr h);

    // Audio sink (headphones / speakers) and hands-free (headset microphone)
    static readonly Guid[] Services = new Guid[]
    {
        new Guid("0000110B-0000-1000-8000-00805F9B34FB"),
        new Guid("0000111E-0000-1000-8000-00805F9B34FB")
    };

    // Disconnect = switch the device's audio services off. Connect = off then on again,
    // which makes Windows reach out to the device.
    public static string Run(ulong address, bool connect)
    {
        IntPtr hRadio;
        BLUETOOTH_FIND_RADIO_PARAMS p = new BLUETOOTH_FIND_RADIO_PARAMS();
        p.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_FIND_RADIO_PARAMS));
        IntPtr hFind = BluetoothFindFirstRadio(ref p, out hRadio);
        if (hFind == IntPtr.Zero) { return "No Bluetooth radio was found"; }
        try
        {
            BLUETOOTH_DEVICE_INFO info = new BLUETOOTH_DEVICE_INFO();
            info.dwSize = (uint)Marshal.SizeOf(typeof(BLUETOOTH_DEVICE_INFO));
            info.Address = address;
            uint found = BluetoothGetDeviceInfo(hRadio, ref info);
            if (found != 0) { return "Windows couldn't find that device (error " + found + ")"; }

            int ok = 0;
            string errors = "";
            foreach (Guid service in Services)
            {
                Guid g = service;
                uint off = BluetoothSetServiceState(hRadio, ref info, ref g, 0);
                if (connect)
                {
                    uint on = BluetoothSetServiceState(hRadio, ref info, ref g, 1);
                    if (on == 0) { ok++; } else { errors += " on:" + on; }
                }
                else
                {
                    if (off == 0) { ok++; } else { errors += " off:" + off; }
                }
            }
            return ok > 0 ? "ok" : "Windows couldn't change that device (error" + errors + ")";
        }
        finally
        {
            CloseHandle(hRadio);
            BluetoothFindRadioClose(hFind);
        }
    }
}
'@
[IslandBt]::Run([Convert]::ToUInt64('__ADDRESS__', 16), __CONNECT__)
