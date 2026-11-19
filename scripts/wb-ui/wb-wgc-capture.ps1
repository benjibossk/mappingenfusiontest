# wb-wgc-capture.ps1 - capture ONE window with Windows Graphics Capture (alternative to PrintWindow).
#
# Model: burn0ut7 reforger-mcp-server docs/window-capture.md (IGraphicsCaptureItemInterop.CreateForWindow,
# free-threaded frame pool, D3D11 hardware device). Unlike PrintWindow it reads what the GPU composed, so the
# 3D viewport is NOT black, and a window covering the target does not matter. No focus change, no input.
# Limits: needs an unlocked interactive desktop and a visible, non-minimised window (WGC rejects minimised /
# cloaked windows); Windows may draw its yellow capture border; a window on a private desktop (wb-shots) cannot be
# captured this way (use System.MakeScreenshot there).
#
#   powershell -ExecutionPolicy Bypass -File scripts\wb-ui\wb-wgc-capture.ps1 [-ProcessName ArmaReforgerWorkbench*] [-Title "World Editor"] [-Hwnd N]
#       [-Out shot.png] [-Frames 1] [-IntervalMs 250]
# -Frames N > 1 writes shot_000.png, shot_001.png ... (an image sequence, e.g. to watch a regeneration).
# Prints one JSON line {ok, hwnd, title, width, height, files[]}.
param(
  [string]$ProcessName = "ArmaReforgerWorkbench*",
  [string]$Title = "",
  [long]$Hwnd = 0,
  [string]$Out = (Join-Path (Get-Location) "wgc.png"),
  [int]$Frames = 1,
  [int]$IntervalMs = 250
)
$ErrorActionPreference = "Stop"
$fw = [Runtime.InteropServices.RuntimeEnvironment]::GetRuntimeDirectory()
$wm = Join-Path $env:WINDIR "System32\WinMetadata"
$refs = @(
  (Join-Path $fw "System.Runtime.dll"), (Join-Path $fw "System.Drawing.dll"),
  (Join-Path $fw "System.Runtime.InteropServices.WindowsRuntime.dll"),
  (Join-Path $wm "Windows.Foundation.winmd"), (Join-Path $wm "Windows.Graphics.winmd"),
  (Join-Path $wm "Windows.Storage.winmd"), (Join-Path $wm "Windows.Security.winmd"))

# Add-Type cannot reference .winmd files: compile once with the Framework csc.exe, cache the dll.
$cache = Join-Path $env:LOCALAPPDATA "reforger-mapper"
$dll = Join-Path $cache "MgWgc.dll"
$src = @'
using System;
using System.IO;
using System.Runtime.InteropServices;
using Windows.Foundation;
using System.Threading;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
using Windows.Graphics.DirectX.Direct3D11;
using Windows.Graphics.Imaging;
using Windows.Storage.Streams;
using System.Drawing;
using System.Drawing.Imaging;

public static class MgWgc {
  [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IGraphicsCaptureItemInterop {
    IntPtr CreateForWindow(IntPtr window, [In] ref Guid iid);
    IntPtr CreateForMonitor(IntPtr monitor, [In] ref Guid iid);
  }
  [DllImport("d3d11.dll")] static extern int D3D11CreateDevice(IntPtr adapter, int driverType, IntPtr soft, uint flags,
    IntPtr levels, uint nLevels, uint sdk, out IntPtr device, out int level, out IntPtr ctx);
  [DllImport("d3d11.dll")] static extern int CreateDirect3D11DeviceFromDXGIDevice(IntPtr dxgi, out IntPtr graphicsDevice);
  [DllImport("combase.dll")] static extern int RoGetActivationFactory(IntPtr cls, [In] ref Guid iid, out IntPtr factory);
  [DllImport("combase.dll")] static extern int WindowsCreateString([MarshalAs(UnmanagedType.LPWStr)] string s, int len, out IntPtr hs);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);

  // System.Runtime.WindowsRuntime (AsTask) needs the union Windows.winmd: poll the operation instead
  static T Await<T>(IAsyncOperation<T> op) {
    var until = DateTime.UtcNow.AddSeconds(10);
    while (op.Status == AsyncStatus.Started) { if (DateTime.UtcNow > until) throw new Exception("async timeout"); Thread.Sleep(5); }
    if (op.Status != AsyncStatus.Completed) throw new Exception("async " + op.Status + " " + op.ErrorCode);
    return op.GetResults();
  }

  static IDirect3DDevice Device() {
    IntPtr dev, ctx; int lvl;
    int hr = D3D11CreateDevice(IntPtr.Zero, 1 /*HARDWARE*/, IntPtr.Zero, 0x20 /*BGRA_SUPPORT*/, IntPtr.Zero, 0, 7, out dev, out lvl, out ctx);
    if (hr < 0) throw new Exception("D3D11CreateDevice 0x" + hr.ToString("X"));
    Guid dxgiId = new Guid("54ec77fa-1377-44e6-8c32-88fd5f44c84c");
    IntPtr dxgi; Marshal.QueryInterface(dev, ref dxgiId, out dxgi);
    IntPtr gd; hr = CreateDirect3D11DeviceFromDXGIDevice(dxgi, out gd);
    if (hr < 0) throw new Exception("CreateDirect3D11DeviceFromDXGIDevice 0x" + hr.ToString("X"));
    Marshal.Release(dxgi); Marshal.Release(ctx); Marshal.Release(dev);
    object o = Marshal.GetObjectForIUnknown(gd); Marshal.Release(gd);
    return (IDirect3DDevice)o;
  }

  static GraphicsCaptureItem Item(IntPtr hwnd) {
    IntPtr hs; string cls = "Windows.Graphics.Capture.GraphicsCaptureItem";
    WindowsCreateString(cls, cls.Length, out hs);
    Guid interopId = typeof(IGraphicsCaptureItemInterop).GUID;
    IntPtr f; int hr = RoGetActivationFactory(hs, ref interopId, out f);
    if (hr < 0) throw new Exception("RoGetActivationFactory 0x" + hr.ToString("X"));
    var interop = (IGraphicsCaptureItemInterop)Marshal.GetObjectForIUnknown(f); Marshal.Release(f);
    Guid itemId = new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760"); // IGraphicsCaptureItem
    IntPtr p = interop.CreateForWindow(hwnd, ref itemId);
    object o = Marshal.GetObjectForIUnknown(p); Marshal.Release(p);
    return (GraphicsCaptureItem)o;
  }

  public static string Capture(long hwnd, string outPath, int frames, int intervalMs) {
    IntPtr h = new IntPtr(hwnd);
    if (IsIconic(h)) throw new Exception("window is minimised (WGC cannot capture it)");
    var dev = Device();
    var item = Item(h);
    var size = item.Size;
    var pool = Direct3D11CaptureFramePool.CreateFreeThreaded(dev, DirectXPixelFormat.B8G8R8A8UIntNormalized, 2, size);
    var session = pool.CreateCaptureSession(item);
    try { session.IsCursorCaptureEnabled = false; } catch { }
    session.StartCapture();
    var files = new System.Collections.Generic.List<string>();
    try {
      for (int i = 0; i < frames; i++) {
        Direct3D11CaptureFrame frame = null;
        var until = DateTime.UtcNow.AddSeconds(10);
        while (frame == null && DateTime.UtcNow < until) { frame = pool.TryGetNextFrame(); if (frame == null) Thread.Sleep(15); }
        if (frame == null) throw new Exception("no frame within 10 s");
        string path = outPath;
        if (frames > 1) path = Path.Combine(Path.GetDirectoryName(Path.GetFullPath(outPath)), Path.GetFileNameWithoutExtension(outPath) + "_" + i.ToString("000") + ".png");
        using (frame) {
          var bmp = Await(SoftwareBitmap.CreateCopyFromSurfaceAsync(frame.Surface, BitmapAlphaMode.Ignore));
          int w = bmp.PixelWidth, hh = bmp.PixelHeight;
          var buf = new Windows.Storage.Streams.Buffer((uint)(w * hh * 4));
          bmp.CopyToBuffer(buf);
          var bytes = new byte[buf.Length];
          DataReader.FromBuffer(buf).ReadBytes(bytes);
          using (var img = new Bitmap(w, hh, PixelFormat.Format32bppRgb)) {
            var bd = img.LockBits(new Rectangle(0, 0, w, hh), ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
            for (int y = 0; y < hh; y++) Marshal.Copy(bytes, y * w * 4, bd.Scan0 + y * bd.Stride, w * 4);
            img.UnlockBits(bd);
            img.Save(path, ImageFormat.Png);
          }
          bmp.Dispose();
        }
        files.Add(path);
        if (i + 1 < frames) Thread.Sleep(intervalMs);
      }
    } finally { session.Dispose(); pool.Dispose(); }
    return size.Width + "x" + size.Height + "|" + string.Join("|", files);
  }
}
'@
if (-not (Test-Path $dll) -or (Get-Item $dll).LastWriteTime -lt (Get-Item $PSCommandPath).LastWriteTime) {
  New-Item -ItemType Directory -Force $cache | Out-Null
  $cs = Join-Path $cache "MgWgc.cs"
  [IO.File]::WriteAllText($cs, $src)
  $csc = Join-Path $fw "csc.exe"
  $o = & $csc /nologo /target:library /optimize "/out:$dll" ($refs | ForEach-Object { "/r:$_" }) $cs 2>&1
  if ($LASTEXITCODE -ne 0) { [pscustomobject]@{ ok = $false; error = "csc: $($o -join ' ')" } | ConvertTo-Json -Compress; exit 1 }
}
if (-not ("MgWgc" -as [type])) { Add-Type -Path $dll }

try {
  if (-not $Hwnd) {
    $p = Get-Process $ProcessName -ErrorAction Stop | Where-Object { $_.MainWindowHandle -ne 0 -and ($Title -eq "" -or $_.MainWindowTitle -like "*$Title*") } | Select-Object -First 1
    if (-not $p) { throw "no visible window for $ProcessName $Title" }
    $Hwnd = [long]$p.MainWindowHandle; $wt = $p.MainWindowTitle
  }
  $r = [MgWgc]::Capture($Hwnd, $Out, $Frames, $IntervalMs).Split("|")
  $wh = $r[0].Split("x")
  [pscustomobject]@{ ok = $true; hwnd = $Hwnd; title = $wt; width = [int]$wh[0]; height = [int]$wh[1]; files = @($r[1..($r.Count - 1)]) } | ConvertTo-Json -Compress
} catch {
  [pscustomobject]@{ ok = $false; error = $_.Exception.GetBaseException().Message } | ConvertTo-Json -Compress
  exit 1
}
