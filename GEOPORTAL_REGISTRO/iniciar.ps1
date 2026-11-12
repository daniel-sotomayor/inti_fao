# Servidor local del geoportal (sin instalaciones, solo PowerShell de Windows)
# Uso: doble clic en iniciar.bat
# Si el puerto 8000 está ocupado, prueba con el siguiente libre.

$ErrorActionPreference = "Stop"
$raiz = $PSScriptRoot

# busca un puerto libre entre 8000 y 8010
$listener = $null
$puerto = $null
foreach ($p in 8000..8010) {
    try {
        $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $p)
        $l.Start()
        $listener = $l
        $puerto = $p
        break
    } catch {
        continue
    }
}

if (-not $listener) {
    Write-Host ""
    Write-Host "  No se encontro un puerto libre entre 8000 y 8010." -ForegroundColor Red
    Write-Host "  Cierra otras ventanas del geoportal y vuelve a intentar." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "  Pulsa Enter para salir"
    exit
}

Write-Host ""
Write-Host "  Geoportal del Registro Agrario" -ForegroundColor Cyan
Write-Host "  Direccion: http://localhost:$puerto" -ForegroundColor Cyan
Write-Host "  Para cerrar: Ctrl+C o cierra esta ventana." -ForegroundColor DarkGray
Write-Host ""

Start-Process "http://localhost:$puerto/"

$mimes = @{
  ".html" = "text/html; charset=utf-8"
  ".js"   = "application/javascript; charset=utf-8"
  ".css"  = "text/css; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".geojson" = "application/json; charset=utf-8"
  ".png"  = "image/png"
  ".ico"  = "image/x-icon"
  ".txt"  = "text/plain; charset=utf-8"
}

try {
    while ($true) {
        $client = $listener.AcceptTcpClient()
        try {
            $stream = $client.GetStream()
            $reader = New-Object System.IO.StreamReader($stream)

            $linea = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($linea)) { $client.Close(); continue }
            $partes = $linea -split ' '
            $metodo = $partes[0]
            $ruta = if ($partes.Length -gt 1) { $partes[1] } else { "/" }
            $ruta = [System.Uri]::UnescapeDataString($ruta.Split('?')[0]).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($ruta)) { $ruta = "index.html" }

            $estado = "200 OK"
            $bytes = $null
            $mime = "application/octet-stream"

            if ($ruta -match '\.\.') {
                $estado = "403 Forbidden"
            } else {
                $archivo = Join-Path $raiz $ruta
                if (Test-Path -LiteralPath $archivo -PathType Leaf) {
                    $bytes = [System.IO.File]::ReadAllBytes($archivo)
                    $ext = [System.IO.Path]::GetExtension($archivo).ToLower()
                    if ($mimes.ContainsKey($ext)) { $mime = $mimes[$ext] }
                } else {
                    $estado = "404 Not Found"
                }
            }

            $largo = if ($bytes) { $bytes.Length } else { 0 }
            $cabecera = "HTTP/1.1 $estado`r`nContent-Type: $mime`r`nContent-Length: $largo`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
            $hb = [System.Text.Encoding]::ASCII.GetBytes($cabecera)
            $stream.Write($hb, 0, $hb.Length)
            if ($metodo -ne "HEAD" -and $bytes) { $stream.Write($bytes, 0, $bytes.Length) }
            $stream.Flush()
        } catch {
            # conexion interrumpida: se ignora y se sigue
        } finally {
            $client.Close()
        }
    }
}
finally {
    $listener.Stop()
}
