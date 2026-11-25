# RandevunHazır'ı canlıya yayınlar (Windows).
# Kullanım: dosyaya sağ tık → "PowerShell ile çalıştır"  ya da PowerShell'de:  .\deploy\yayinla.ps1 [--testsiz] [--kuru] [--hepsi]
# Betik çalıştırma kapalıysa bir kez:  Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host 'Node.js kurulu degil: https://nodejs.org' -ForegroundColor Red
  Read-Host 'Kapatmak icin Enter' | Out-Null
  exit 1
}
node deploy/yayinla.mjs @args
$code = $LASTEXITCODE
Read-Host 'Bitti. Kapatmak icin Enter' | Out-Null
exit $code
