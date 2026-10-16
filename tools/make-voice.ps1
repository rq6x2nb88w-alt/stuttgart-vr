# Erzeugt die Sprachansagen als WAV-Dateien (assets/voice/*.wav) mit der deutschen Windows-Stimme "Katja".
# Die Quest hat keine Sprachausgabe im Browser – deshalb spielt das Spiel diese Aufnahmen ab.
# Aufruf:  powershell -ExecutionPolicy Bypass -File tools\make-voice.ps1
$ErrorActionPreference = 'Stop'
$out = Join-Path $PSScriptRoot '..\assets\voice'
New-Item -ItemType Directory -Force $out | Out-Null

$lines = @'
willkommen|Willkommen,
spieler|Spieler
z0|null
z1|eins
z2|zwei
z3|drei
z4|vier
z5|fünf
z6|sechs
z7|sieben
z8|acht
z9|neun
ruft_an|ruft an.
anruf|Eingehender Anruf.
nav_berechnet|Route wird berechnet.
nav_neu|Route wird neu berechnet.
nav_wenden|Bitte wenden.
nav_next_rechts|Bei der nächsten Kreuzung rechts.
nav_next_links|Bei der nächsten Kreuzung links.
nav_next_wenden|Bitte bei der nächsten Gelegenheit wenden.
nav_gerade_rechts|Weiter geradeaus, dann rechts abbiegen.
nav_gerade_links|Weiter geradeaus, dann links abbiegen.
nav_gerade_wenden|Weiter geradeaus, dann wenden.
nav_folge|Folge der Straße für
nav_dann_rechts|dann rechts abbiegen.
nav_dann_links|dann links abbiegen.
nav_dann_wenden|dann wenden.
nav_dann_ziel|Dann hast du dein Ziel erreicht.
nav_ziel_vorne|Weiter geradeaus, das Ziel liegt vor dir.
nav_ziel|Du hast dein Ziel erreicht.
nav_ende|Navigation beendet.
d500|500 Meter,
d600|600 Meter,
d700|700 Meter,
d800|800 Meter,
d900|900 Meter,
d1000|einen Kilometer,
d1500|eineinhalb Kilometer,
d2000|zwei Kilometer,
d2500|zweieinhalb Kilometer,
d3000|drei Kilometer,
d4000|vier Kilometer,
d5000|fünf Kilometer,
'@ -split "`r?`n" | Where-Object { $_ -match '\|' }

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
function Wait-Op($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like '*Katja*' } | Select-Object -First 1
if (-not $voice) { $voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -like 'de*' } | Select-Object -First 1 }
$synth.Voice = $voice
try { $synth.Options.SpeakingRate = 1.05 } catch { }
"Stimme: " + $voice.DisplayName

foreach ($l in $lines) {
  $key, $text = $l.Split('|', 2)
  $stream = Wait-Op ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $n = [uint32]$stream.Size
  $null = Wait-Op ($reader.LoadAsync($n)) ([uint32])
  $bytes = New-Object byte[] $n; $reader.ReadBytes($bytes)
  [IO.File]::WriteAllBytes((Join-Path $out ($key + '.wav')), $bytes)
  $reader.Dispose(); $stream.Dispose()
}
"Fertig: " + $lines.Count + " Ansagen in " + (Resolve-Path $out)
# alle WAVs in eine Datei packen (voice.bin + voice.json), damit GitHub-Uploads klein bleiben
node (Join-Path $PSScriptRoot 'pack-assets.js')
