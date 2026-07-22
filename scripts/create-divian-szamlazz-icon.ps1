# Divian Szamlazz.hu API (elonezet) — asztali parancsikon
$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$iconPath = Join-Path $projectRoot "divian-szamlazz.ico"
$launcherBat = Join-Path $projectRoot "inditas-teszt-tervezo-szamlazz.bat"
$shortcutLabel = "Divian Szamlazz (elonezet)"
$desktopShortcut = Join-Path ([Environment]::GetFolderPath("Desktop")) ($shortcutLabel + ".lnk")
$projectShortcut = Join-Path $projectRoot ($shortcutLabel + ".lnk")

if (-not (Test-Path -LiteralPath $launcherBat)) {
    Write-Error "Nem talalhato: $launcherBat"
}

$mainIcon = Join-Path $projectRoot "divian-inditas.ico"
$tesztIcon = Join-Path $projectRoot "divian-teszt.ico"
if (-not (Test-Path -LiteralPath $iconPath)) {
    if (Test-Path -LiteralPath $tesztIcon) {
        Copy-Item -LiteralPath $tesztIcon -Destination $iconPath -Force
    } elseif (Test-Path -LiteralPath $mainIcon) {
        Copy-Item -LiteralPath $mainIcon -Destination $iconPath -Force
    } else {
        & (Join-Path $PSScriptRoot "create-divian-launcher-icon.ps1") | Out-Null
        if (Test-Path -LiteralPath $mainIcon) {
            Copy-Item -LiteralPath $mainIcon -Destination $iconPath -Force
        }
    }
}

function New-DivianSzamlazzShortcut {
    param(
        [string]$LinkPath,
        [string]$TargetPath,
        [string]$WorkingDirectory,
        [string]$IconLocation
    )

    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($LinkPath)
    $shortcut.TargetPath = $TargetPath
    $shortcut.Arguments = ""
    $shortcut.WorkingDirectory = $WorkingDirectory
    $shortcut.WindowStyle = 1
    $shortcut.Description = "Divian: Cyncly + arajanlat + Szamlazz.hu API elonezet (nem napi, kell agent kulcs)"
    if (Test-Path -LiteralPath $IconLocation) {
        $shortcut.IconLocation = "$IconLocation,0"
    }
    $shortcut.Save()
}

Write-Host ""
Write-Host " Divian Szamlazz parancsikon keszitese..."
Write-Host " Indito: inditas-teszt-tervezo-szamlazz.bat"
Write-Host " Mappa: $projectRoot"
Write-Host ""

New-DivianSzamlazzShortcut -LinkPath $desktopShortcut -TargetPath $launcherBat -WorkingDirectory $projectRoot -IconLocation $iconPath
Write-Host " Asztal: $desktopShortcut"

New-DivianSzamlazzShortcut -LinkPath $projectShortcut -TargetPath $launcherBat -WorkingDirectory $projectRoot -IconLocation $iconPath
Write-Host " Mappa:  $projectShortcut"

Write-Host ""
Write-Host " Kesz. Csak elonezeti PDF - nem ment a szamlazz.hu fiokba."
Write-Host " Tesztuzem (fiokba mentes): inditas-teszt-tervezo-szamlazz-tesztuzem.bat"
Write-Host ""
