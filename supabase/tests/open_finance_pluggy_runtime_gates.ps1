[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-SupabaseStatusCapture {
  param([string[]]$Arguments)

  $previousPreference = $ErrorActionPreference
  try {
    # Capture every stream because status formatting differs across CLI builds.
    # Nothing captured here is written to the console: it contains local keys.
    $ErrorActionPreference = 'Continue'
    $output = @(
      & npx --no-install supabase status @Arguments 2>&1 |
        ForEach-Object { $_.ToString() }
    )
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }

  [pscustomobject]@{
    ExitCode = $exitCode
    Text = $output -join "`n"
  }
}

function Unquote-StatusValue {
  param([string]$Value)

  $trimmed = $Value.Trim()
  if ($trimmed.Length -ge 2) {
    $first = $trimmed[0]
    $last = $trimmed[$trimmed.Length - 1]
    if (($first -eq '"' -and $last -eq '"') -or ($first -eq "'" -and $last -eq "'")) {
      return $trimmed.Substring(1, $trimmed.Length - 2)
    }
  }

  return $trimmed
}

function Read-StatusEnvironment {
  param([string]$Text)

  $values = @{}
  foreach ($line in ($Text -split "`r?`n")) {
    if ($line -match '^\s*(?:export\s+)?(?<name>[A-Z][A-Z0-9_]*)=(?<value>.*)\s*$') {
      $values[$Matches.name] = Unquote-StatusValue -Value $Matches.value
    }
  }
  return $values
}

function Read-NamedKeyMap {
  param(
    [hashtable]$Values,
    [string]$Name,
    [string]$Prefix
  )

  if (-not $Values.ContainsKey($Name)) { return $null }
  try {
    $parsed = $Values[$Name] | ConvertFrom-Json
    foreach ($candidateName in @('open-finance', 'default')) {
      $property = $parsed.PSObject.Properties[$candidateName]
      if ($null -ne $property) {
        $candidate = [string]$property.Value
        if ($candidate.StartsWith($Prefix, [StringComparison]::Ordinal)) {
          return $candidate
        }
      }
    }
  }
  catch {
    return $null
  }
  return $null
}

function First-StatusValue {
  param(
    [hashtable]$Values,
    [string[]]$Names,
    [string]$Prefix = ''
  )

  foreach ($name in $Names) {
    if (-not $Values.ContainsKey($name)) { continue }
    $candidate = [string]$Values[$name]
    if (-not $Prefix -or $candidate.StartsWith($Prefix, [StringComparison]::Ordinal)) {
      return $candidate
    }
  }
  return $null
}

function Save-EnvironmentValue {
  param(
    [hashtable]$Previous,
    [string]$Name,
    [string]$Value
  )

  $item = Get-Item -LiteralPath "Env:$Name" -ErrorAction SilentlyContinue
  $Previous[$Name] = [pscustomobject]@{
    Existed = $null -ne $item
    Value = if ($null -ne $item) { [string]$item.Value } else { '' }
  }
  Set-Item -LiteralPath "Env:$Name" -Value $Value
}

function Restore-EnvironmentValues {
  param([hashtable]$Previous)

  foreach ($entry in $Previous.GetEnumerator()) {
    if ($entry.Value.Existed) {
      Set-Item -LiteralPath "Env:$($entry.Key)" -Value $entry.Value.Value
    }
    else {
      Remove-Item -LiteralPath "Env:$($entry.Key)" -ErrorAction SilentlyContinue
    }
  }
}

$repositoryRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$testPath = 'supabase/functions/open-finance-pluggy/local-postgres.integration.test.ts'
$previousEnvironment = @{}
$failed = $false

try {
  Push-Location $repositoryRoot
  $null = Get-Command npx -ErrorAction Stop

  $status = Invoke-SupabaseStatusCapture -Arguments @('--output', 'env')
  if ($status.ExitCode -ne 0) {
    throw 'The local Supabase stack is not available. Run supabase start/reset first.'
  }

  $values = Read-StatusEnvironment -Text $status.Text
  $apiUrl = First-StatusValue -Values $values -Names @('API_URL', 'SUPABASE_URL')
  $publishableKey = First-StatusValue `
    -Values $values `
    -Names @('PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEY') `
    -Prefix 'sb_publishable_'
  $secretKey = First-StatusValue `
    -Values $values `
    -Names @('SECRET_KEY', 'SUPABASE_SECRET_KEY') `
    -Prefix 'sb_secret_'

  if (-not $publishableKey) {
    $publishableKey = Read-NamedKeyMap `
      -Values $values `
      -Name 'SUPABASE_PUBLISHABLE_KEYS' `
      -Prefix 'sb_publishable_'
  }
  if (-not $secretKey) {
    $secretKey = Read-NamedKeyMap `
      -Values $values `
      -Name 'SUPABASE_SECRET_KEYS' `
      -Prefix 'sb_secret_'
  }

  # Some CLI versions omit the modern keys from --output env while showing
  # them in the human-readable status. Capture that output without echoing it.
  if (-not $apiUrl -or -not $publishableKey -or -not $secretKey) {
    $plainStatus = Invoke-SupabaseStatusCapture -Arguments @()
    if ($plainStatus.ExitCode -ne 0) {
      throw 'Unable to read local Supabase status.'
    }

    if (-not $apiUrl -and $plainStatus.Text -match '(?im)API\s+URL[^\r\n]*?(?<url>https?://(?:127\.0\.0\.1|localhost|\[::1\]):\d+)') {
      $apiUrl = $Matches.url
    }
    if (-not $publishableKey -and $plainStatus.Text -match '(?<key>sb_publishable_[A-Za-z0-9_-]+)') {
      $publishableKey = $Matches.key
    }
    if (-not $secretKey -and $plainStatus.Text -match '(?<key>sb_secret_[A-Za-z0-9_-]+)') {
      $secretKey = $Matches.key
    }
  }

  if (-not $apiUrl -or -not $publishableKey -or -not $secretKey) {
    throw 'Local status did not expose an API URL plus modern publishable/secret keys.'
  }

  $parsedUrl = [Uri]$apiUrl
  if (
    $parsedUrl.Scheme -ne 'http' `
    -or -not (
      $parsedUrl.Host -eq 'localhost' `
      -or [System.Net.IPAddress]::IsLoopback([System.Net.IPAddress]::Parse($parsedUrl.Host))
    )
  ) {
    throw 'Refusing to run the local integration test against a non-loopback URL.'
  }

  Save-EnvironmentValue -Previous $previousEnvironment -Name 'OPEN_FINANCE_LOCAL_POSTGRES' -Value '1'
  Save-EnvironmentValue -Previous $previousEnvironment -Name 'OPEN_FINANCE_LOCAL_SUPABASE_URL' -Value $apiUrl
  Save-EnvironmentValue -Previous $previousEnvironment -Name 'OPEN_FINANCE_LOCAL_PUBLISHABLE_KEY' -Value $publishableKey
  Save-EnvironmentValue -Previous $previousEnvironment -Name 'OPEN_FINANCE_LOCAL_SECRET_KEY' -Value $secretKey

  Write-Host 'Running local-only Pluggy handler integration against loopback Supabase services.'
  Write-Host 'Local API keys are held in process memory and will not be printed.'

  & npx --no-install vitest run $testPath `
    --reporter=verbose `
    --testTimeout=120000 `
    --hookTimeout=60000
  if ($LASTEXITCODE -ne 0) {
    throw "The local Pluggy integration suite failed with exit code $LASTEXITCODE."
  }
}
catch {
  $failed = $true
  Write-Host "OPEN FINANCE PLUGGY LOCAL INTEGRATION FAILED: $($_.Exception.Message)" -ForegroundColor Red
}
finally {
  Restore-EnvironmentValues -Previous $previousEnvironment
  Pop-Location -ErrorAction SilentlyContinue
}

if ($failed) { exit 1 }
Write-Host 'OPEN FINANCE PLUGGY LOCAL INTEGRATION PASSED' -ForegroundColor Green
exit 0
