# whenpc metrics collector
# Reads Windows performance counters via PDH (English counter names, works on localized Windows)
# and writes one JSON line per second to stdout. Spawned and owned by the Electron main process.
param([int]$IntervalMs = 1000, [int]$ParentPid = 0)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$source = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public static class WhenPcCollector
{
    const uint PDH_FMT_DOUBLE = 0x00000200;
    const uint PDH_FMT_NOCAP100 = 0x00008000;
    const uint PDH_MORE_DATA = 0x800007D2;

    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhOpenQuery(string dataSource, IntPtr userData, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr userData, out IntPtr counter);
    [DllImport("pdh.dll")]
    static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)]
    static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint format, ref uint bufferSize, out uint itemCount, IntPtr buffer);

    static IntPtr query;        // always collected
    static IntPtr detailQuery;  // per-process counters, collected only while the detail panel is open
    static volatile bool detailOn = false;
    static Dictionary<string, IntPtr> counters = new Dictionary<string, IntPtr>();

    static void Add(string key, string path) { AddTo(query, key, path); }

    static void AddTo(IntPtr q, string key, string path)
    {
        IntPtr c;
        if (PdhAddEnglishCounter(q, path, IntPtr.Zero, out c) == 0) counters[key] = c;
    }

    // stdin commands from the Electron main process: "detail 1" / "detail 0"
    static void ListenStdin()
    {
        var t = new Thread(delegate ()
        {
            try
            {
                string line;
                while ((line = Console.In.ReadLine()) != null)
                {
                    line = line.Trim();
                    if (line == "detail 1") detailOn = true;
                    else if (line == "detail 0") detailOn = false;
                }
            }
            catch { }
        });
        t.IsBackground = true;
        t.Start();
    }

    class Group
    {
        public string Name;
        public int Count;
        public double Cpu, Mem, Read, Write, Gpu, Vram;
    }

    // GPU instances: "pid_1234_luid_..." (prefix "pid_"); Process V2 instances: "name:1234" (prefix null)
    static int PidOf(string instance, string prefix)
    {
        int pid;
        if (prefix == null)
        {
            int colon = instance.LastIndexOf(':');
            return colon >= 0 && int.TryParse(instance.Substring(colon + 1), out pid) ? pid : -1;
        }
        if (!instance.StartsWith(prefix)) return -1;
        int end = instance.IndexOf('_', prefix.Length);
        if (end < 0) end = instance.Length;
        return int.TryParse(instance.Substring(prefix.Length, end - prefix.Length), out pid) ? pid : -1;
    }

    static string DetailJson(int threads)
    {
        var byPid = new Dictionary<int, Group>();
        var byName = new Dictionary<string, Group>();

        foreach (var kv in Read("pMem"))
        {
            int pid = PidOf(kv.Key, null);
            if (pid <= 0) continue; // skips _total and idle:0
            string name = kv.Key.Substring(0, kv.Key.LastIndexOf(':'));
            Group g;
            if (!byName.TryGetValue(name, out g)) { g = new Group(); g.Name = name; byName[name] = g; }
            g.Count++;
            g.Mem += kv.Value;
            byPid[pid] = g;
        }
        Group x;
        foreach (var kv in Read("pCpu")) if (byPid.TryGetValue(PidOf(kv.Key, null), out x)) x.Cpu += kv.Value / Math.Max(1, threads);
        foreach (var kv in Read("pRead")) if (byPid.TryGetValue(PidOf(kv.Key, null), out x)) x.Read += kv.Value;
        foreach (var kv in Read("pWrite")) if (byPid.TryGetValue(PidOf(kv.Key, null), out x)) x.Write += kv.Value;
        foreach (var kv in Read("gpDed")) if (byPid.TryGetValue(PidOf(kv.Key, "pid_"), out x)) x.Vram += kv.Value;

        // Per-process GPU like Task Manager: the busiest engine of that process.
        var pidEngine = new Dictionary<string, double>();
        foreach (var kv in Read("gpuEngine"))
        {
            int et = kv.Key.IndexOf("_engtype_");
            if (et < 0) continue;
            string k = kv.Key.Substring(0, et);
            double cur;
            pidEngine.TryGetValue(k, out cur);
            pidEngine[k] = cur + kv.Value;
        }
        var pidGpu = new Dictionary<int, double>();
        foreach (var kv in pidEngine)
        {
            int pid = PidOf(kv.Key, "pid_");
            double cur;
            pidGpu.TryGetValue(pid, out cur);
            pidGpu[pid] = Math.Max(cur, kv.Value);
        }
        foreach (var kv in pidGpu) if (byPid.TryGetValue(kv.Key, out x)) x.Gpu += kv.Value;

        var all = new List<Group>(byName.Values);
        var sb = new StringBuilder("{");
        string[] keys = { "cpu", "mem", "gpu", "io" };
        for (int k = 0; k < keys.Length; k++)
        {
            string key = keys[k];
            Comparison<Group> cmp;
            if (key == "cpu") cmp = delegate (Group a, Group b) { return b.Cpu.CompareTo(a.Cpu); };
            else if (key == "mem") cmp = delegate (Group a, Group b) { return b.Mem.CompareTo(a.Mem); };
            else if (key == "gpu") cmp = delegate (Group a, Group b) { int c = b.Gpu.CompareTo(a.Gpu); return c != 0 ? c : b.Vram.CompareTo(a.Vram); };
            else cmp = delegate (Group a, Group b) { return (b.Read + b.Write).CompareTo(a.Read + a.Write); };
            all.Sort(cmp);
            if (k > 0) sb.Append(',');
            sb.Append(S(key)).Append(":[");
            for (int i = 0; i < Math.Min(10, all.Count); i++)
            {
                var g = all[i];
                if (i > 0) sb.Append(',');
                sb.Append("{\"n\":").Append(S(g.Name)).Append(",\"c\":").Append(g.Count)
                  .Append(",\"cpu\":").Append(N(Math.Min(100, g.Cpu)))
                  .Append(",\"mem\":").Append(N(g.Mem))
                  .Append(",\"gpu\":").Append(N(Math.Min(100, g.Gpu)))
                  .Append(",\"vram\":").Append(N(g.Vram))
                  .Append(",\"r\":").Append(N(g.Read))
                  .Append(",\"w\":").Append(N(g.Write)).Append('}');
            }
            sb.Append(']');
        }
        return sb.Append('}').ToString();
    }

    // Returns instance -> value for a (possibly wildcard) counter. Wildcards are re-expanded on every collect.
    static List<KeyValuePair<string, double>> Read(string key)
    {
        var result = new List<KeyValuePair<string, double>>();
        IntPtr c;
        if (!counters.TryGetValue(key, out c)) return result;
        uint size = 0, count;
        uint status = PdhGetFormattedCounterArray(c, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, IntPtr.Zero);
        if (status != PDH_MORE_DATA || size == 0) return result;
        IntPtr buf = Marshal.AllocHGlobal((int)size);
        try
        {
            status = PdhGetFormattedCounterArray(c, PDH_FMT_DOUBLE | PDH_FMT_NOCAP100, ref size, out count, buf);
            if (status != 0) return result;
            // PDH_FMT_COUNTERVALUE_ITEM_W (x64): LPWSTR szName; { DWORD CStatus; pad; double value }
            int itemSize = IntPtr.Size + 16;
            for (int i = 0; i < count; i++)
            {
                IntPtr item = new IntPtr(buf.ToInt64() + (long)i * itemSize);
                string name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(item));
                uint cstatus = (uint)Marshal.ReadInt32(item, IntPtr.Size);
                if (cstatus != 0 && cstatus != 0x00000001) continue; // PDH_CSTATUS_VALID_DATA / NEW_DATA
                double v = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(item, IntPtr.Size + 8));
                if (double.IsNaN(v) || double.IsInfinity(v)) continue;
                result.Add(new KeyValuePair<string, double>(name, v));
            }
        }
        finally { Marshal.FreeHGlobal(buf); }
        return result;
    }

    static double First(string key)
    {
        var l = Read(key);
        return l.Count > 0 ? l[0].Value : -1;
    }

    static double Sum(string key)
    {
        double s = 0;
        foreach (var kv in Read(key)) s += kv.Value;
        return s;
    }

    static string N(double v) { return v.ToString("0.###", CultureInfo.InvariantCulture); }

    static string S(string v)
    {
        if (v == null) return "null";
        var sb = new StringBuilder("\"");
        foreach (char ch in v)
        {
            if (ch == '"' || ch == '\\') sb.Append('\\').Append(ch);
            else if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4"));
            else sb.Append(ch);
        }
        return sb.Append('"').ToString();
    }

    static bool IsVirtualNic(string name)
    {
        string n = name.ToLowerInvariant();
        return n.Contains("virtual") || n.Contains("pseudo") || n.Contains("isatap") || n.Contains("teredo")
            || n.Contains("loopback") || n.Contains("vethernet") || n.Contains("wan miniport");
    }

    static string DrivesJson()
    {
        var sb = new StringBuilder("[");
        bool first = true;
        foreach (var d in DriveInfo.GetDrives())
        {
            try
            {
                if (d.DriveType != DriveType.Fixed || !d.IsReady) continue;
                if (!first) sb.Append(',');
                first = false;
                sb.Append("{\"name\":").Append(S(d.Name.TrimEnd('\\')))
                  .Append(",\"label\":").Append(S(d.VolumeLabel))
                  .Append(",\"total\":").Append(d.TotalSize)
                  .Append(",\"free\":").Append(d.TotalFreeSpace).Append('}');
            }
            catch { }
        }
        return sb.Append(']').ToString();
    }

    public static void Run(int intervalMs, int parentPid, string cpuName, string gpuName, double maxMhz, double totalMem, int cores, int threads)
    {
        if (PdhOpenQuery(null, IntPtr.Zero, out query) != 0) throw new Exception("PdhOpenQuery failed");

        Add("cpu", @"\Processor Information(_Total)\% Processor Utility");
        Add("cpuPerf", @"\Processor Information(_Total)\% Processor Performance");
        Add("memAvail", @"\Memory\Available Bytes");
        Add("commit", @"\Memory\Committed Bytes");
        Add("commitLimit", @"\Memory\Commit Limit");
        Add("gpuEngine", @"\GPU Engine(*)\Utilization Percentage");
        Add("gpuDedicated", @"\GPU Adapter Memory(*)\Dedicated Usage");
        Add("gpuShared", @"\GPU Adapter Memory(*)\Shared Usage");
        Add("diskRead", @"\PhysicalDisk(_Total)\Disk Read Bytes/sec");
        Add("diskWrite", @"\PhysicalDisk(_Total)\Disk Write Bytes/sec");
        Add("diskIdle", @"\PhysicalDisk(_Total)\% Idle Time");
        Add("netRx", @"\Network Interface(*)\Bytes Received/sec");
        Add("netTx", @"\Network Interface(*)\Bytes Sent/sec");
        Add("thermal", @"\Thermal Zone Information(*)\Temperature");
        Add("procs", @"\System\Processes");
        Add("threadCount", @"\System\Threads");
        Add("uptime", @"\System\System Up Time");

        if (PdhOpenQuery(null, IntPtr.Zero, out detailQuery) != 0) throw new Exception("PdhOpenQuery failed");
        AddTo(detailQuery, "pCpu", @"\Process V2(*)\% Processor Time");
        AddTo(detailQuery, "pMem", @"\Process V2(*)\Working Set - Private");
        AddTo(detailQuery, "pRead", @"\Process V2(*)\IO Read Bytes/sec");
        AddTo(detailQuery, "pWrite", @"\Process V2(*)\IO Write Bytes/sec");
        AddTo(detailQuery, "gpDed", @"\GPU Process Memory(*)\Dedicated Usage");
        ListenStdin();
        bool detailPrimed = false;

        string staticJson = "\"info\":{\"cpuName\":" + S(cpuName) + ",\"gpuName\":" + S(gpuName)
            + ",\"cores\":" + cores + ",\"threads\":" + threads + ",\"memTotal\":" + N(totalMem) + "}";

        PdhCollectQueryData(query);
        Thread.Sleep(intervalMs);

        string drives = DrivesJson();
        DateTime drivesAt = DateTime.UtcNow;
        var stdout = Console.Out;

        System.Diagnostics.Process parent = null;
        if (parentPid > 0) { try { parent = System.Diagnostics.Process.GetProcessById(parentPid); } catch { return; } }

        while (true)
        {
            // Exit with the owning Electron process even if it was killed without cleanup.
            if (parent != null && parent.HasExited) return;
            DateTime tick = DateTime.UtcNow;
            PdhCollectQueryData(query);

            // GPU: like Task Manager, sum each engine across processes, then take the busiest engine.
            var perEngine = new Dictionary<string, double>();
            var perType = new Dictionary<string, double>();
            foreach (var kv in Read("gpuEngine"))
            {
                string name = kv.Key;
                int luid = name.IndexOf("_luid_");
                int et = name.IndexOf("_engtype_");
                if (luid < 0 || et < 0) continue;
                string engineKey = name.Substring(luid, et - luid);
                string type = name.Substring(et + 9);
                if (type.Length == 0) type = "Other";
                double cur;
                perEngine.TryGetValue(engineKey, out cur);
                perEngine[engineKey] = cur + kv.Value;
                double t;
                perType.TryGetValue(type, out t);
                perType[type] = Math.Max(t, cur + kv.Value);
            }
            double gpuUtil = 0;
            foreach (var v in perEngine.Values) gpuUtil = Math.Max(gpuUtil, v);

            double rx = 0, tx = 0;
            foreach (var kv in Read("netRx")) if (!IsVirtualNic(kv.Key)) rx += kv.Value;
            foreach (var kv in Read("netTx")) if (!IsVirtualNic(kv.Key)) tx += kv.Value;

            double thermalK = 0;
            foreach (var kv in Read("thermal")) thermalK = Math.Max(thermalK, kv.Value);

            if ((DateTime.UtcNow - drivesAt).TotalSeconds >= 15) { drives = DrivesJson(); drivesAt = DateTime.UtcNow; }

            double perf = First("cpuPerf");
            double idle = First("diskIdle");

            var sb = new StringBuilder("{");
            sb.Append(staticJson);
            sb.Append(",\"cpu\":{\"util\":").Append(N(Math.Min(100, Math.Max(0, First("cpu")))))
              .Append(",\"mhz\":").Append(perf >= 0 && maxMhz > 0 ? N(maxMhz * perf / 100) : "null").Append('}');
            sb.Append(",\"mem\":{\"avail\":").Append(N(First("memAvail")))
              .Append(",\"commit\":").Append(N(First("commit")))
              .Append(",\"commitLimit\":").Append(N(First("commitLimit"))).Append('}');
            sb.Append(",\"gpu\":{\"util\":").Append(N(Math.Min(100, gpuUtil)))
              .Append(",\"dedicated\":").Append(N(Sum("gpuDedicated")))
              .Append(",\"shared\":").Append(N(Sum("gpuShared")))
              .Append(",\"engines\":{");
            bool firstType = true;
            foreach (var kv in perType)
            {
                if (!firstType) sb.Append(',');
                firstType = false;
                sb.Append(S(kv.Key)).Append(':').Append(N(Math.Min(100, kv.Value)));
            }
            sb.Append("}}");
            sb.Append(",\"disk\":{\"read\":").Append(N(First("diskRead")))
              .Append(",\"write\":").Append(N(First("diskWrite")))
              .Append(",\"active\":").Append(idle >= 0 ? N(Math.Max(0, Math.Min(100, 100 - idle))) : "null")
              .Append(",\"drives\":").Append(drives).Append('}');
            sb.Append(",\"net\":{\"rx\":").Append(N(rx)).Append(",\"tx\":").Append(N(tx)).Append('}');
            sb.Append(",\"temp\":{\"acpi\":").Append(thermalK > 0 ? N(thermalK - 273.15) : "null").Append('}');
            sb.Append(",\"sys\":{\"procs\":").Append(N(First("procs")))
              .Append(",\"threads\":").Append(N(First("threadCount")))
              .Append(",\"uptime\":").Append(N(First("uptime"))).Append('}');
            if (detailOn)
            {
                PdhCollectQueryData(detailQuery);
                // Rate counters need two samples; skip output on the first collect after enabling.
                if (detailPrimed) sb.Append(",\"detail\":").Append(DetailJson(threads));
                detailPrimed = true;
            }
            else detailPrimed = false;
            sb.Append('}');

            stdout.WriteLine(sb.ToString());
            stdout.Flush();

            int elapsed = (int)(DateTime.UtcNow - tick).TotalMilliseconds;
            Thread.Sleep(Math.Max(100, intervalMs - elapsed));
        }
    }
}
'@

Add-Type -TypeDefinition $source -Language CSharp

$cpu = Get-CimInstance Win32_Processor | Select-Object -First 1
$gpus = Get-CimInstance Win32_VideoController | Where-Object { $_.Name -notmatch 'Basic Display|Remote|Virtual|Parsec|Meta' }
$gpuName = ($gpus | Select-Object -ExpandProperty Name) -join ' + '
$totalMem = [double](Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
$threads = ([int[]](Get-CimInstance Win32_Processor | ForEach-Object { $_.NumberOfLogicalProcessors }) | Measure-Object -Sum).Sum
$cores = ([int[]](Get-CimInstance Win32_Processor | ForEach-Object { $_.NumberOfCores }) | Measure-Object -Sum).Sum

[WhenPcCollector]::Run($IntervalMs, $ParentPid, $cpu.Name.Trim(), $gpuName, [double]$cpu.MaxClockSpeed, $totalMem, $cores, $threads)
