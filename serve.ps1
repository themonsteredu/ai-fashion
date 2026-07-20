# Simple offline HTTP server for the kiosk app (no internet needed).
# Started automatically by start.bat - keep this window open while using the app.

$port = 8017
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

$mime = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "text/javascript; charset=utf-8"
  ".mjs"  = "text/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json"
  ".wasm" = "application/wasm"
  ".task" = "application/octet-stream"
  ".vrm"  = "application/octet-stream"
  ".png"  = "image/png"
  ".jpg"  = "image/jpeg"
  ".jpeg" = "image/jpeg"
  ".svg"  = "image/svg+xml"
  ".ico"  = "image/x-icon"
}

$listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
try {
  $listener.Start()
} catch {
  Write-Host "ERROR: port $port is already in use. Close other windows and run start.bat again."
  Start-Sleep -Seconds 10
  exit 1
}

Write-Host "=============================================="
Write-Host " Fashion Avatar Studio - local server running"
Write-Host " Open:  http://localhost:$port/"
Write-Host " Keep this window open while using the app."
Write-Host "=============================================="

while ($true) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $stream = $client.GetStream()
    $reader = New-Object System.IO.StreamReader($stream)
    $requestLine = $reader.ReadLine()
    while ($true) {
      $line = $reader.ReadLine()
      if ($null -eq $line -or $line -eq "") { break }
    }

    $status = "404 Not Found"
    $bytes = [Text.Encoding]::UTF8.GetBytes("Not Found")
    $ct = "text/plain"

    if ($requestLine -match "^GET\s+(\S+)") {
      $path = $Matches[1].Split("?")[0]
      $path = [System.Uri]::UnescapeDataString($path)
      if ($path -eq "/") { $path = "/index.html" }
      $rel = $path.TrimStart("/").Replace("/", [IO.Path]::DirectorySeparatorChar)
      $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
      if ($full.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $full -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($full)
        $ext = [IO.Path]::GetExtension($full).ToLower()
        $ct = $mime[$ext]
        if (-not $ct) { $ct = "application/octet-stream" }
        $status = "200 OK"
      }
    }

    $header = "HTTP/1.1 $status`r`nContent-Type: $ct`r`nContent-Length: $($bytes.Length)`r`nCache-Control: no-cache`r`nConnection: close`r`n`r`n"
    $hb = [Text.Encoding]::ASCII.GetBytes($header)
    $stream.Write($hb, 0, $hb.Length)
    $stream.Write($bytes, 0, $bytes.Length)
    $stream.Flush()
  } catch {
    # ignore individual request errors
  } finally {
    if ($client) { $client.Close() }
  }
}
