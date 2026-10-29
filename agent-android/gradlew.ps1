# PowerShell wrapper for gradlew.bat
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& "$scriptDir\gradlew.bat" @args

