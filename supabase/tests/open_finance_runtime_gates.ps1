[CmdletBinding()]
param(
  [ValidateRange(5, 30)]
  [int]$OverlapSeconds = 6
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$script:DbContainer = $null
$script:TrackedJobs = @()
$script:Failed = $false
$script:FixturesInstalled = $false

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Message)

  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Assert-True {
  param(
    [Parameter(Mandatory = $true)][bool]$Condition,
    [Parameter(Mandatory = $true)][string]$Message
  )

  if (-not $Condition) {
    throw "ASSERTION FAILED: $Message"
  }

  Write-Host "PASS: $Message" -ForegroundColor Green
}

function Invoke-PsqlCapture {
  param([Parameter(Mandatory = $true)][string]$Sql)

  if ([string]::IsNullOrWhiteSpace($script:DbContainer)) {
    throw 'The local Supabase database container has not been selected.'
  }

  $null = Get-Command docker -CommandType Application -ErrorAction Stop
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    # Native stderr must be captured as evidence for expected SQL failures.
    # Windows PowerShell otherwise turns it into a terminating NativeCommandError
    # while ErrorActionPreference is Stop.
    $ErrorActionPreference = 'Continue'
    $raw = @(
      $Sql | & docker exec -i $script:DbContainer psql `
          -X `
          -q `
          -A `
          -t `
          -F '|' `
          -v 'ON_ERROR_STOP=1' `
          -v 'VERBOSITY=verbose' `
          -U postgres `
          -d postgres 2>&1
    )
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
  $output = ($raw | ForEach-Object { $_.ToString() }) -join "`n"

  [pscustomobject]@{
    ExitCode = $exitCode
    Output = $output.Trim()
  }
}

function Invoke-PsqlRequired {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [string]$Description = 'PostgreSQL command'
  )

  $result = Invoke-PsqlCapture -Sql $Sql
  if ($result.ExitCode -ne 0) {
    throw "$Description failed with exit code $($result.ExitCode).`n$($result.Output)"
  }

  return [string]$result.Output
}

function Assert-ExpectedSqlFailure {
  param(
    [Parameter(Mandatory = $true)][string]$Sql,
    [Parameter(Mandatory = $true)][string]$Description,
    [Parameter(Mandatory = $true)][string[]]$RequiredPatterns
  )

  $result = Invoke-PsqlCapture -Sql $Sql
  Write-Host "$Description output:"
  Write-Host $result.Output

  Assert-True `
    -Condition ($result.ExitCode -ne 0) `
    -Message "$Description is rejected by PostgreSQL"

  foreach ($pattern in $RequiredPatterns) {
    Assert-True `
      -Condition ($result.Output -match $pattern) `
      -Message "$Description reports /$pattern/"
  }
}

function Get-OnlyOutputLine {
  param(
    [Parameter(Mandatory = $true)][string]$Output,
    [Parameter(Mandatory = $true)][string]$Description
  )

  $lines = @(
    $Output -split "`r?`n" |
      ForEach-Object { $_.Trim() } |
      Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
  )

  Assert-True `
    -Condition ($lines.Count -eq 1) `
    -Message "$Description returns exactly one data row"

  return [string]$lines[0]
}

function Remove-TrackedJobs {
  foreach ($job in @($script:TrackedJobs)) {
    if ($null -eq $job) {
      continue
    }

    try {
      if ($job.State -in @('Running', 'NotStarted', 'Blocked')) {
        Stop-Job -Job $job -ErrorAction SilentlyContinue
      }
      Remove-Job -Job $job -Force -ErrorAction SilentlyContinue
    }
    catch {
      Write-Warning "Could not remove job $($job.Id): $($_.Exception.Message)"
    }
  }

  $script:TrackedJobs = @()
}

function Stop-HarnessDatabaseBackends {
  param([Parameter(Mandatory = $true)][string]$Description)

  $terminateSql = @'
set statement_timeout = '15s';

with harness_backends as materialized (
  select activity.pid
  from pg_catalog.pg_stat_activity as activity
  where activity.datname = current_database()
    and activity.pid <> pg_catalog.pg_backend_pid()
    and activity.application_name in (
      'open_finance_runtime_a',
      'open_finance_runtime_b'
    )
)
select count(*)
from harness_backends as backend
where pg_catalog.pg_terminate_backend(backend.pid);
'@

  $terminatedCount = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $terminateSql -Description $Description) `
    -Description $Description
  Assert-True `
    -Condition ($terminatedCount -match '^\d+$') `
    -Message "$Description reports a backend count"
  Write-Host "INFO: $Description terminated $terminatedCount harness backend(s)."
}

$cleanupSql = @'
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $runtime_cleanup_markers$
begin
  if (
    select count(*)
    from auth.users
    where id in (
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002'
    )
  ) <> 2
  or exists (
    select 1
    from auth.users
    where (
      id = 'a1000000-0000-4000-8000-000000000001'
      and email is distinct from 'open-finance-runtime-member@example.invalid'
    )
    or (
      id = 'a1000000-0000-4000-8000-000000000002'
      and email is distinct from 'open-finance-runtime-other@example.invalid'
    )
  ) then
    raise exception 'OPEN_FINANCE_RUNTIME_CLEANUP_USER_MARKER_MISMATCH';
  end if;

  if (
    select count(*)
    from public.households
    where id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
  ) <> 2
  or exists (
    select 1
    from public.households
    where (
      id = 'a2000000-0000-4000-8000-000000000001'
      and (
        name is distinct from 'Open Finance runtime household'
        or created_by is distinct from 'a1000000-0000-4000-8000-000000000001'
      )
    )
    or (
      id = 'a2000000-0000-4000-8000-000000000002'
      and (
        name is distinct from 'Open Finance runtime other household'
        or created_by is distinct from 'a1000000-0000-4000-8000-000000000002'
      )
    )
  ) then
    raise exception 'OPEN_FINANCE_RUNTIME_CLEANUP_HOUSEHOLD_MARKER_MISMATCH';
  end if;

  if (
    select count(*)
    from public.memberships
    where (
      household_id = 'a2000000-0000-4000-8000-000000000001'
      and user_id = 'a1000000-0000-4000-8000-000000000001'
      and role = 'owner'
    )
    or (
      household_id = 'a2000000-0000-4000-8000-000000000002'
      and user_id = 'a1000000-0000-4000-8000-000000000002'
      and role = 'owner'
    )
  ) <> 2 then
    raise exception 'OPEN_FINANCE_RUNTIME_CLEANUP_MEMBERSHIP_MARKER_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.bank_connections
    where id = 'a3000000-0000-4000-8000-000000000001'
      and household_id = 'a2000000-0000-4000-8000-000000000001'
      and created_by = 'a1000000-0000-4000-8000-000000000001'
      and provider = 'pluggy'
      and external_connection_id = 'open-finance-runtime-connection'
      and external_account_id = 'open-finance-runtime-account'
  ) then
    raise exception 'OPEN_FINANCE_RUNTIME_CLEANUP_CONNECTION_MARKER_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.bank_connection_consents
    where id = 'a4000000-0000-4000-8000-000000000001'
      and connection_id = 'a3000000-0000-4000-8000-000000000001'
      and household_id = 'a2000000-0000-4000-8000-000000000001'
      and created_by = 'a1000000-0000-4000-8000-000000000001'
      and provider = 'pluggy'
      and external_consent_id = 'open-finance-runtime-consent'
  ) then
    raise exception 'OPEN_FINANCE_RUNTIME_CLEANUP_CONSENT_MARKER_MISMATCH';
  end if;

  if not exists (
    select 1
    from public.bank_sync_runs
    where id = 'a5000000-0000-4000-8000-000000000001'
      and connection_id = 'a3000000-0000-4000-8000-000000000001'
      and household_id = 'a2000000-0000-4000-8000-000000000001'
      and created_by = 'a1000000-0000-4000-8000-000000000001'
      and provider = 'pluggy'
      and month_key = '2026-08'
  ) then
    raise exception 'OPEN_FINANCE_RUNTIME_CLEANUP_SYNC_MARKER_MISMATCH';
  end if;
end
$runtime_cleanup_markers$;

drop trigger if exists __open_finance_runtime_pause_insert
  on public.imported_bank_transactions;
drop trigger if exists __open_finance_runtime_fail_association
  on public.imported_bank_transactions;
drop function if exists public.__open_finance_runtime_pause_insert();
drop function if exists public.__open_finance_runtime_fail_association();

delete from auth.users
where id in (
  'a1000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000002'
);

commit;
'@

try {
  Write-Step 'Locating the local Supabase database container'

  $supabaseDirectory = Split-Path -Parent $PSScriptRoot
  $configPath = Join-Path $supabaseDirectory 'config.toml'
  Assert-True -Condition (Test-Path -LiteralPath $configPath -PathType Leaf) -Message 'supabase/config.toml exists'

  $configText = Get-Content -LiteralPath $configPath -Raw
  $projectMatches = [regex]::Matches(
    $configText,
    '(?m)^\s*project_id\s*=\s*"([^"]+)"\s*(?:#.*)?$'
  )
  Assert-True -Condition ($projectMatches.Count -eq 1) -Message 'config.toml declares exactly one project_id'

  $projectId = $projectMatches[0].Groups[1].Value
  Assert-True `
    -Condition ($projectId -match '^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$') `
    -Message 'project_id is safe to use for exact container matching'

  $expectedContainerName = "supabase_db_$projectId"
  $dockerRows = @(& docker ps --format '{{.ID}}|{{.Names}}|{{.Image}}' 2>&1)
  $dockerPsExitCode = $LASTEXITCODE
  if ($dockerPsExitCode -ne 0) {
    throw "docker ps failed with exit code $dockerPsExitCode.`n$($dockerRows -join "`n")"
  }

  $matchingContainers = @(
    $dockerRows |
      ForEach-Object { $_.ToString() } |
      Where-Object {
        $parts = $_ -split '\|', 3
        $parts.Count -eq 3 -and $parts[1] -ceq $expectedContainerName
      }
  )
  Assert-True `
    -Condition ($matchingContainers.Count -eq 1) `
    -Message "exactly one running container is named $expectedContainerName"

  $containerParts = $matchingContainers[0] -split '\|', 3
  $script:DbContainer = $containerParts[1]
  Assert-True `
    -Condition ($containerParts[2] -match '(?i)supabase/postgres') `
    -Message 'the selected container uses a Supabase Postgres image'

  $inspectRows = @(& docker inspect $script:DbContainer 2>&1)
  $inspectExitCode = $LASTEXITCODE
  if ($inspectExitCode -ne 0) {
    throw "docker inspect failed with exit code $inspectExitCode.`n$($inspectRows -join "`n")"
  }

  $inspectJson = ($inspectRows | ForEach-Object { $_.ToString() }) -join "`n"
  $inspectObjects = @($inspectJson | ConvertFrom-Json)
  Assert-True `
    -Condition ($inspectObjects.Count -eq 1 -and [bool]$inspectObjects[0].State.Running) `
    -Message 'the selected database container is running'
  Assert-True `
    -Condition ([string]$inspectObjects[0].Config.Image -match '(?i)supabase/postgres') `
    -Message 'docker inspect confirms the Supabase Postgres image'

  $projectLabel = [string]$inspectObjects[0].Config.Labels.'com.supabase.cli.project'
  if (-not [string]::IsNullOrWhiteSpace($projectLabel)) {
    Assert-True `
      -Condition ($projectLabel -ceq $projectId) `
      -Message 'the Supabase CLI project label matches config.toml'
  }
  else {
    Write-Host 'INFO: the CLI project label is absent; exact name and image checks selected the container.'
  }

  Write-Host "Database container: $script:DbContainer"

  Write-Step 'Terminating stale database sessions owned by this runtime harness'
  Stop-HarnessDatabaseBackends -Description 'preflight harness backend termination'

  Write-Step 'Checking the hardened database contract and effective grants'

  $catalogAssertionsSql = @'
do $runtime_assertions$
declare
  rpc_signature regprocedure := to_regprocedure(
    'public.import_open_finance_transaction(text,uuid,uuid,uuid,text,text,date,text,bigint,text,uuid,timestamp with time zone,jsonb)'
  );
begin
  if rpc_signature is null then
    raise exception 'RUNTIME_ASSERT_RPC_MISSING';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    join pg_catalog.pg_namespace as namespace
      on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
      and not relation.relrowsecurity
  ) then
    raise exception 'RUNTIME_ASSERT_RLS_NOT_ENABLED';
  end if;

  if (
    select count(*)
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'authenticated'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
  ) <> 4
  or exists (
    select 1
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'authenticated'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
      and grant_row.privilege_type <> 'SELECT'
  ) then
    raise exception 'RUNTIME_ASSERT_AUTHENTICATED_GRANTS';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'anon'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
  ) then
    raise exception 'RUNTIME_ASSERT_ANON_GRANTS';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class as relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) as privilege
    where relation.oid = any (
      array[
        'public.bank_connections'::regclass,
        'public.bank_connection_consents'::regclass,
        'public.bank_sync_runs'::regclass,
        'public.imported_bank_transactions'::regclass
      ]
    )
      and privilege.grantee = 0
  ) then
    raise exception 'RUNTIME_ASSERT_PUBLIC_GRANTS';
  end if;

  if (
    select count(*)
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'service_role'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
  ) <> 16
  or exists (
    select 1
    from information_schema.role_table_grants as grant_row
    where grant_row.grantee = 'service_role'
      and grant_row.table_schema = 'public'
      and grant_row.table_name in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
      and grant_row.privilege_type not in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'RUNTIME_ASSERT_SERVICE_ROLE_GRANTS';
  end if;

  if exists (
    select 1
    from (
      values
        ('anon', 'bank_connections', 'SELECT', false),
        ('anon', 'bank_connections', 'INSERT', false),
        ('anon', 'bank_connections', 'UPDATE', false),
        ('anon', 'bank_connections', 'DELETE', false),
        ('anon', 'bank_connection_consents', 'SELECT', false),
        ('anon', 'bank_connection_consents', 'INSERT', false),
        ('anon', 'bank_connection_consents', 'UPDATE', false),
        ('anon', 'bank_connection_consents', 'DELETE', false),
        ('anon', 'bank_sync_runs', 'SELECT', false),
        ('anon', 'bank_sync_runs', 'INSERT', false),
        ('anon', 'bank_sync_runs', 'UPDATE', false),
        ('anon', 'bank_sync_runs', 'DELETE', false),
        ('anon', 'imported_bank_transactions', 'SELECT', false),
        ('anon', 'imported_bank_transactions', 'INSERT', false),
        ('anon', 'imported_bank_transactions', 'UPDATE', false),
        ('anon', 'imported_bank_transactions', 'DELETE', false),
        ('authenticated', 'bank_connections', 'SELECT', true),
        ('authenticated', 'bank_connections', 'INSERT', false),
        ('authenticated', 'bank_connections', 'UPDATE', false),
        ('authenticated', 'bank_connections', 'DELETE', false),
        ('authenticated', 'bank_connection_consents', 'SELECT', true),
        ('authenticated', 'bank_connection_consents', 'INSERT', false),
        ('authenticated', 'bank_connection_consents', 'UPDATE', false),
        ('authenticated', 'bank_connection_consents', 'DELETE', false),
        ('authenticated', 'bank_sync_runs', 'SELECT', true),
        ('authenticated', 'bank_sync_runs', 'INSERT', false),
        ('authenticated', 'bank_sync_runs', 'UPDATE', false),
        ('authenticated', 'bank_sync_runs', 'DELETE', false),
        ('authenticated', 'imported_bank_transactions', 'SELECT', true),
        ('authenticated', 'imported_bank_transactions', 'INSERT', false),
        ('authenticated', 'imported_bank_transactions', 'UPDATE', false),
        ('authenticated', 'imported_bank_transactions', 'DELETE', false),
        ('service_role', 'bank_connections', 'SELECT', true),
        ('service_role', 'bank_connections', 'INSERT', true),
        ('service_role', 'bank_connections', 'UPDATE', true),
        ('service_role', 'bank_connections', 'DELETE', true),
        ('service_role', 'bank_connection_consents', 'SELECT', true),
        ('service_role', 'bank_connection_consents', 'INSERT', true),
        ('service_role', 'bank_connection_consents', 'UPDATE', true),
        ('service_role', 'bank_connection_consents', 'DELETE', true),
        ('service_role', 'bank_sync_runs', 'SELECT', true),
        ('service_role', 'bank_sync_runs', 'INSERT', true),
        ('service_role', 'bank_sync_runs', 'UPDATE', true),
        ('service_role', 'bank_sync_runs', 'DELETE', true),
        ('service_role', 'imported_bank_transactions', 'SELECT', true),
        ('service_role', 'imported_bank_transactions', 'INSERT', true),
        ('service_role', 'imported_bank_transactions', 'UPDATE', true),
        ('service_role', 'imported_bank_transactions', 'DELETE', true)
    ) as expected(role_name, table_name, privilege_name, should_have)
    where has_table_privilege(
      expected.role_name,
      format('public.%I', expected.table_name),
      expected.privilege_name
    ) is distinct from expected.should_have
  ) then
    raise exception 'RUNTIME_ASSERT_EFFECTIVE_ROW_GRANTS';
  end if;

  if exists (
    select 1
    from unnest(array['anon', 'authenticated', 'service_role']) as client(role_name)
    cross join unnest(
      array['TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']
    ) as forbidden(privilege_name)
    cross join unnest(
      array[
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      ]
    ) as banking(table_name)
    where has_table_privilege(
      client.role_name,
      format('public.%I', banking.table_name),
      forbidden.privilege_name
    )
  ) then
    raise exception 'RUNTIME_ASSERT_EFFECTIVE_ADMIN_GRANTS';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
  ) <> 4
  or exists (
    select 1
    from pg_catalog.pg_policies as policy
    where policy.schemaname = 'public'
      and policy.tablename in (
        'bank_connections',
        'bank_connection_consents',
        'bank_sync_runs',
        'imported_bank_transactions'
      )
      and (
        policy.cmd <> 'SELECT'
        or policy.roles <> array['authenticated']::name[]
      )
  ) then
    raise exception 'RUNTIME_ASSERT_BANKING_POLICIES';
  end if;

  if has_function_privilege('anon', rpc_signature, 'EXECUTE')
    or has_function_privilege('authenticated', rpc_signature, 'EXECUTE')
    or not has_function_privilege('service_role', rpc_signature, 'EXECUTE')
  then
    raise exception 'RUNTIME_ASSERT_RPC_GRANTS';
  end if;

  if (
    select procedure.prosecdef
    from pg_catalog.pg_proc as procedure
    where procedure.oid = rpc_signature
  ) then
    raise exception 'RUNTIME_ASSERT_RPC_MUST_BE_SECURITY_INVOKER';
  end if;

  if (
    select procedure.proconfig
    from pg_catalog.pg_proc as procedure
    where procedure.oid = rpc_signature
  ) is distinct from array['search_path=""']::text[] then
    raise exception 'RUNTIME_ASSERT_RPC_SEARCH_PATH';
  end if;
end
$runtime_assertions$;
'@

  $null = Invoke-PsqlRequired `
    -Sql $catalogAssertionsSql `
    -Description 'catalog grants/RLS assertions'
  Write-Host 'PASS: catalog grants, policies, RLS flags, and RPC exposure are hardened' -ForegroundColor Green

  Write-Step 'Preparing deterministic runtime fixtures and fault-injection triggers'

  # Both trigger functions are test-only and are removed in finally. The pause
  # happens after the RPC has acquired its transaction-scoped advisory lock,
  # making the other real session wait on that same advisory identity lock.
  $fixtureSql = @'
begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $runtime_fixture_preflight$
begin
  if exists (
    select 1
    from auth.users
    where id in (
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002'
    )
      or email in (
        'open-finance-runtime-member@example.invalid',
        'open-finance-runtime-other@example.invalid'
      )
  )
  or exists (
    select 1
    from public.households
    where id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
      or name in (
        'Open Finance runtime household',
        'Open Finance runtime other household'
      )
  )
  or exists (
    select 1
    from public.bank_connections
    where id = 'a3000000-0000-4000-8000-000000000001'
      or external_connection_id = 'open-finance-runtime-connection'
      or external_account_id = 'open-finance-runtime-account'
  )
  or exists (
    select 1
    from public.bank_connection_consents
    where id = 'a4000000-0000-4000-8000-000000000001'
      or external_consent_id = 'open-finance-runtime-consent'
  )
  or exists (
    select 1
    from public.bank_sync_runs
    where id = 'a5000000-0000-4000-8000-000000000001'
  )
  or exists (
    select 1
    from public.imported_bank_transactions
    where external_transaction_id in (
      'open-finance-runtime-concurrent',
      'open-finance-runtime-explicit-rollback',
      'open-finance-runtime-rollback'
    )
  )
  or exists (
    select 1
    from public.transactions
    where note in (
      'Runtime concurrent import',
      'Runtime explicit transaction rollback',
      'Runtime forced rollback'
    )
  )
  or exists (
    select 1
    from pg_catalog.pg_trigger
    where tgname in (
      '__open_finance_runtime_pause_insert',
      '__open_finance_runtime_fail_association'
    )
      and not tgisinternal
  )
  or to_regprocedure('public.__open_finance_runtime_pause_insert()') is not null
  or to_regprocedure('public.__open_finance_runtime_fail_association()') is not null
  then
    raise exception using
      errcode = '55000',
      message = 'OPEN_FINANCE_RUNTIME_FIXTURE_MARKER_COLLISION',
      hint = 'Inspect the stale or conflicting marker before running this harness.';
  end if;
end
$runtime_fixture_preflight$;

insert into auth.users (id, email)
values
  (
    'a1000000-0000-4000-8000-000000000001',
    'open-finance-runtime-member@example.invalid'
  ),
  (
    'a1000000-0000-4000-8000-000000000002',
    'open-finance-runtime-other@example.invalid'
  );

insert into public.households (id, name, type, created_by)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'Open Finance runtime household',
    'individual',
    'a1000000-0000-4000-8000-000000000001'
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'Open Finance runtime other household',
    'individual',
    'a1000000-0000-4000-8000-000000000002'
  );

insert into public.memberships (household_id, user_id, role)
values
  (
    'a2000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001',
    'owner'
  ),
  (
    'a2000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000002',
    'owner'
  );

insert into public.bank_connections (
  id,
  household_id,
  created_by,
  provider,
  institution_name,
  external_connection_id,
  external_account_id,
  account_name
)
values (
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'pluggy',
  'Open Finance runtime institution',
  'open-finance-runtime-connection',
  'open-finance-runtime-account',
  'Open Finance runtime account'
);

insert into public.bank_connection_consents (
  id,
  connection_id,
  household_id,
  created_by,
  provider,
  external_consent_id
)
values (
  'a4000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'pluggy',
  'open-finance-runtime-consent'
);

insert into public.bank_sync_runs (
  id,
  connection_id,
  household_id,
  created_by,
  provider,
  month_key
)
values (
  'a5000000-0000-4000-8000-000000000001',
  'a3000000-0000-4000-8000-000000000001',
  'a2000000-0000-4000-8000-000000000001',
  'a1000000-0000-4000-8000-000000000001',
  'pluggy',
  '2026-08'
);

create function public.__open_finance_runtime_pause_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  barrier_attempt integer;
begin
  if new.external_transaction_id = 'open-finance-runtime-concurrent'
    and pg_catalog.current_setting('application_name', true) = 'open_finance_runtime_a'
  then
    -- Session A holds the RPC advisory lock while it waits for session B to
    -- identify itself. Once B is visible, keep both sessions overlapped long
    -- enough for the observer to capture the real advisory waiter/blocker.
    for barrier_attempt in 1..300 loop
      -- Statistics views cache their snapshot inside a transaction. Refresh it
      -- so this long-running trigger can observe the newly opened B backend.
      perform pg_catalog.pg_stat_clear_snapshot();
      exit when exists (
        select 1
        from pg_catalog.pg_stat_activity as activity
        where activity.datname = pg_catalog.current_database()
          and activity.application_name = 'open_finance_runtime_b'
      );
      perform pg_catalog.pg_sleep(0.1);
    end loop;

    perform pg_catalog.pg_stat_clear_snapshot();
    if not exists (
      select 1
      from pg_catalog.pg_stat_activity as activity
      where activity.datname = pg_catalog.current_database()
        and activity.application_name = 'open_finance_runtime_b'
    ) then
      raise exception using
        errcode = '57014',
        message = 'OPEN_FINANCE_RUNTIME_BARRIER_TIMEOUT';
    end if;

    perform pg_catalog.pg_sleep(__OVERLAP_SECONDS__);
  end if;
  return new;
end;
$function$;

revoke all on function public.__open_finance_runtime_pause_insert()
  from public, anon, authenticated;
grant execute on function public.__open_finance_runtime_pause_insert()
  to service_role;

create trigger __open_finance_runtime_pause_insert
before insert on public.imported_bank_transactions
for each row
execute function public.__open_finance_runtime_pause_insert();

create function public.__open_finance_runtime_fail_association()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  raise exception using
    errcode = 'P0001',
    message = 'OPEN_FINANCE_RUNTIME_FORCED_FAILURE';
end;
$function$;

revoke all on function public.__open_finance_runtime_fail_association()
  from public, anon, authenticated;
grant execute on function public.__open_finance_runtime_fail_association()
  to service_role;

create trigger __open_finance_runtime_fail_association
before update of transaction_id on public.imported_bank_transactions
for each row
when (
  old.transaction_id is null
  and new.transaction_id is not null
  and new.external_transaction_id = 'open-finance-runtime-rollback'
)
execute function public.__open_finance_runtime_fail_association();

commit;
'@
  $fixtureSql = $fixtureSql.Replace(
    '__OVERLAP_SECONDS__',
    $OverlapSeconds.ToString([System.Globalization.CultureInfo]::InvariantCulture)
  )
  $null = Invoke-PsqlRequired -Sql $fixtureSql -Description 'runtime fixture setup'
  $script:FixturesInstalled = $true
  Write-Host 'PASS: deterministic fixtures and test-only triggers are installed' -ForegroundColor Green

  Write-Step 'Proving that client roles cannot execute the import RPC'

  foreach ($roleName in @('anon', 'authenticated')) {
    $rpcDeniedSql = @'
set role __ROLE__;
select *
from public.import_open_finance_transaction(
  'pluggy'::text,
  'a3000000-0000-4000-8000-000000000001'::uuid,
  'a2000000-0000-4000-8000-000000000001'::uuid,
  'a1000000-0000-4000-8000-000000000001'::uuid,
  'open-finance-runtime-account'::text,
  'open-finance-runtime-client-denied'::text,
  date '2026-08-20',
  'Client role must be denied'::text,
  101::bigint,
  'expense'::text,
  'a5000000-0000-4000-8000-000000000001'::uuid,
  null::timestamp with time zone,
  null::jsonb
);
'@
    $rpcDeniedSql = $rpcDeniedSql.Replace('__ROLE__', $roleName)
    Assert-ExpectedSqlFailure `
      -Sql $rpcDeniedSql `
      -Description "$roleName RPC execution" `
      -RequiredPatterns @('42501', '(?i)permission denied for function import_open_finance_transaction')
  }

  Write-Step 'Running two concurrent service-role RPC sessions'

  $rpcSqlTemplate = @'
set application_name = '__APPLICATION_NAME__';
set role service_role;
set statement_timeout = '120s';
select
  result.imported_bank_transaction_id::text,
  result.transaction_id::text,
  result.inserted::text,
  result.content_changed::text
from public.import_open_finance_transaction(
  p_provider => 'pluggy',
  p_connection_id => 'a3000000-0000-4000-8000-000000000001',
  p_household_id => 'a2000000-0000-4000-8000-000000000001',
  p_created_by => 'a1000000-0000-4000-8000-000000000001',
  p_external_account_id => 'open-finance-runtime-account',
  p_external_transaction_id => 'open-finance-runtime-concurrent',
  p_occurred_on => date '2026-08-20',
  p_description => 'Runtime concurrent import',
  p_amount_cents => 4242,
  p_direction => 'expense',
  p_sync_run_id => 'a5000000-0000-4000-8000-000000000001',
  p_posted_at => timestamptz '2026-08-20 12:00:00+00',
  p_raw_payload => '{"runtime":true}'::jsonb
) as result;
'@

  $jobRunner = {
    param(
      [string]$Container,
      [string]$Sql,
      [string]$SessionName
    )

    Set-StrictMode -Version Latest

    try {
      $null = Get-Command docker -CommandType Application -ErrorAction Stop
      $ErrorActionPreference = 'Continue'
      $rawOutput = @(
        $Sql | & docker exec -i $Container psql `
            -X `
            -q `
            -A `
            -t `
            -F '|' `
            -v 'ON_ERROR_STOP=1' `
            -v 'VERBOSITY=verbose' `
            -U postgres `
            -d postgres 2>&1
      )
      $nativeExitCode = $LASTEXITCODE
      [pscustomobject]@{
        Session = $SessionName
        ExitCode = $nativeExitCode
        Output = (($rawOutput | ForEach-Object { $_.ToString() }) -join "`n").Trim()
      }
    }
    catch {
      [pscustomobject]@{
        Session = $SessionName
        ExitCode = 900
        Output = $_.Exception.ToString()
      }
    }
  }

  $sessionASql = $rpcSqlTemplate.Replace('__APPLICATION_NAME__', 'open_finance_runtime_a')
  $sessionBSql = $rpcSqlTemplate.Replace('__APPLICATION_NAME__', 'open_finance_runtime_b')
  $jobA = Start-Job `
    -Name 'open-finance-runtime-a' `
    -ScriptBlock $jobRunner `
    -ArgumentList $script:DbContainer, $sessionASql, 'a'

  $script:TrackedJobs = @($jobA)
  $barrierDeadline = [DateTime]::UtcNow.AddSeconds(45)
  $sessionABarrierRecord = $null
  while ($null -eq $sessionABarrierRecord) {
    if ($jobA.State -in @('Completed', 'Failed', 'Stopped')) {
      throw "Session A ended before reaching the database barrier (job state: $($jobA.State))."
    }
    if ([DateTime]::UtcNow -ge $barrierDeadline) {
      throw 'Session A did not reach the database barrier within 45 seconds.'
    }

    $barrierSql = @'
select concat_ws(
  '|',
  activity.pid::text,
  coalesce(activity.wait_event_type, ''),
  coalesce(activity.wait_event, ''),
  activity.state
)
from pg_catalog.pg_stat_activity as activity
where activity.datname = current_database()
  and activity.application_name = 'open_finance_runtime_a'
  and activity.state = 'active'
  and activity.wait_event_type = 'Timeout'
  and activity.wait_event = 'PgSleep';
'@
    $barrierOutput = Invoke-PsqlRequired -Sql $barrierSql -Description 'session A barrier observation'
    $barrierLines = @(
      $barrierOutput -split "`r?`n" |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )
    if ($barrierLines.Count -eq 1) {
      $sessionABarrierRecord = [string]$barrierLines[0]
      continue
    }

    Start-Sleep -Milliseconds 100
  }

  Assert-True `
    -Condition ($sessionABarrierRecord -match '^\d+\|Timeout\|PgSleep\|active$') `
    -Message 'session A holds the advisory identity lock at the database barrier'

  $jobB = Start-Job `
    -Name 'open-finance-runtime-b' `
    -ScriptBlock $jobRunner `
    -ArgumentList $script:DbContainer, $sessionBSql, 'b'
  $script:TrackedJobs = @($jobA, $jobB)

  $waitRecords = [System.Collections.Generic.List[string]]::new()
  $seenWaitRecords = [System.Collections.Generic.HashSet[string]]::new()
  $sawCorrelatedAdvisoryWait = $false
  $deadline = [DateTime]::UtcNow.AddSeconds(($OverlapSeconds * 3) + 30)

  while (@($script:TrackedJobs | Where-Object { $_.State -notin @('Completed', 'Failed', 'Stopped') }).Count -gt 0) {
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'Concurrent RPC jobs exceeded their runtime deadline.'
    }

    $snapshotSql = @'
with harness_activity as materialized (
  select
    activity.pid,
    activity.application_name,
    activity.wait_event_type,
    activity.wait_event,
    activity.state,
    pg_catalog.pg_blocking_pids(activity.pid) as blocking_pids
  from pg_catalog.pg_stat_activity as activity
  where activity.datname = current_database()
    and activity.application_name in (
      'open_finance_runtime_a',
      'open_finance_runtime_b'
    )
),
harness_snapshot as (
  select
    count(*) as session_count,
    pg_catalog.string_agg(
      activity.application_name,
      ',' order by activity.application_name
    ) as applications
  from harness_activity as activity
)
select
  snapshot.session_count::text,
  coalesce(snapshot.applications, ''),
  waiter.application_name,
  waiter.pid::text,
  coalesce(waiter.wait_event_type, ''),
  coalesce(waiter.wait_event, ''),
  blocker.application_name,
  blocker.pid::text,
  exists (
    select 1
    from pg_catalog.pg_locks as waiter_lock
    where waiter_lock.pid = waiter.pid
      and waiter_lock.locktype = 'advisory'
      and not waiter_lock.granted
  )::text,
  exists (
    select 1
    from pg_catalog.pg_locks as blocker_lock
    where blocker_lock.pid = blocker.pid
      and blocker_lock.locktype = 'advisory'
      and blocker_lock.granted
  )::text,
  waiter.state,
  blocker.state
from harness_activity as waiter
join harness_activity as blocker
  on blocker.pid = any (waiter.blocking_pids)
cross join harness_snapshot as snapshot
where waiter.wait_event_type = 'Lock'
  and waiter.wait_event = 'advisory'
order by waiter.application_name, blocker.application_name;
'@
    $snapshot = Invoke-PsqlRequired -Sql $snapshotSql -Description 'concurrency wait observation'
    $snapshotLines = @(
      $snapshot -split "`r?`n" |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    )

    foreach ($snapshotLine in $snapshotLines) {
      $timestampedRecord = "$(Get-Date -Format o)|$snapshotLine"
      if ($seenWaitRecords.Add($snapshotLine)) {
        $waitRecords.Add($timestampedRecord)
      }

      $snapshotParts = $snapshotLine -split '\|', 12
      if (
        $snapshotParts.Count -eq 12 `
        -and $snapshotParts[0] -eq '2' `
        -and $snapshotParts[1] -eq 'open_finance_runtime_a,open_finance_runtime_b' `
        -and $snapshotParts[2] -eq 'open_finance_runtime_b' `
        -and $snapshotParts[3] -match '^\d+$' `
        -and $snapshotParts[4] -eq 'Lock' `
        -and $snapshotParts[5] -eq 'advisory' `
        -and $snapshotParts[6] -eq 'open_finance_runtime_a' `
        -and $snapshotParts[7] -match '^\d+$' `
        -and $snapshotParts[3] -ne $snapshotParts[7] `
        -and $snapshotParts[8] -eq 'true' `
        -and $snapshotParts[9] -eq 'true'
      ) {
        $sawCorrelatedAdvisoryWait = $true
      }
    }

    Start-Sleep -Milliseconds 125
  }

  Write-Host 'Recorded database wait observations:'
  foreach ($waitRecord in $waitRecords) {
    Write-Host "  $waitRecord"
  }

  Assert-True `
    -Condition $sawCorrelatedAdvisoryWait `
    -Message 'one snapshot correlates both apps, the advisory waiter, and its holding blocker PID/app'

  $jobPayloads = @()
  foreach ($job in $script:TrackedJobs) {
    $received = @(Receive-Job -Job $job -Wait -ErrorAction Stop)
    Assert-True `
      -Condition ($received.Count -eq 1) `
      -Message "job $($job.Name) returns one result envelope"
    $jobPayloads += $received[0]
  }

  foreach ($payload in $jobPayloads) {
    Write-Host "Session $($payload.Session) output: $($payload.Output)"
    Assert-True `
      -Condition ([int]$payload.ExitCode -eq 0) `
      -Message "concurrent session $($payload.Session) exits successfully"
  }

  $rpcResults = @()
  foreach ($payload in $jobPayloads) {
    $resultLine = Get-OnlyOutputLine `
      -Output ([string]$payload.Output) `
      -Description "concurrent session $($payload.Session)"
    $resultParts = $resultLine -split '\|', 4
    Assert-True `
      -Condition ($resultParts.Count -eq 4) `
      -Message "concurrent session $($payload.Session) returns all four RPC columns"

    $rpcResults += [pscustomobject]@{
      Session = [string]$payload.Session
      ImportedId = [string]$resultParts[0]
      TransactionId = [string]$resultParts[1]
      Inserted = [string]$resultParts[2]
      ContentChanged = [string]$resultParts[3]
    }
  }

  Assert-True `
    -Condition (@($rpcResults | Where-Object { $_.Inserted -eq 'true' }).Count -eq 1) `
    -Message 'exactly one concurrent RPC reports inserted=true'
  Assert-True `
    -Condition (@($rpcResults | Where-Object { $_.Inserted -eq 'false' }).Count -eq 1) `
    -Message 'exactly one concurrent RPC reports inserted=false'
  Assert-True `
    -Condition (@($rpcResults | Select-Object -ExpandProperty ImportedId -Unique).Count -eq 1) `
    -Message 'both concurrent RPCs return the same imported row ID'
  Assert-True `
    -Condition (@($rpcResults | Select-Object -ExpandProperty TransactionId -Unique).Count -eq 1) `
    -Message 'both concurrent RPCs return the same transactions row ID'
  Assert-True `
    -Condition (@($rpcResults | Where-Object { $_.ContentChanged -ne 'false' }).Count -eq 0) `
    -Message 'the identical concurrent calls report no content change'

  $concurrencyCountSql = @'
select concat_ws(
  '|',
  (
    select count(*)
    from public.imported_bank_transactions as imported
    where imported.provider = 'pluggy'
      and imported.connection_id = 'a3000000-0000-4000-8000-000000000001'
      and imported.external_account_id = 'open-finance-runtime-account'
      and imported.external_transaction_id = 'open-finance-runtime-concurrent'
  ),
  (
    select count(*)
    from public.transactions as ledger
    join public.imported_bank_transactions as imported
      on imported.transaction_id = ledger.id
    where imported.provider = 'pluggy'
      and imported.connection_id = 'a3000000-0000-4000-8000-000000000001'
      and imported.external_account_id = 'open-finance-runtime-account'
      and imported.external_transaction_id = 'open-finance-runtime-concurrent'
  ),
  (
    select count(*)
    from public.imported_bank_transactions as imported
    where imported.household_id = 'a2000000-0000-4000-8000-000000000001'
      and imported.transaction_id is null
  ),
  (
    select count(*)
    from public.transactions as ledger
    left join public.imported_bank_transactions as imported
      on imported.transaction_id = ledger.id
    where ledger.household_id = 'a2000000-0000-4000-8000-000000000001'
      and ledger.created_by = 'a1000000-0000-4000-8000-000000000001'
      and imported.id is null
  )
);
'@
  $concurrencyCounts = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $concurrencyCountSql -Description 'concurrency row counts') `
    -Description 'concurrency row counts'
  Assert-True `
    -Condition ($concurrencyCounts -eq '1|1|0|0') `
    -Message 'concurrency leaves 1 imported row, 1 linked transaction, and 0 orphans'

  $persistedIdsSql = @'
select concat_ws('|', imported.id::text, imported.transaction_id::text)
from public.imported_bank_transactions as imported
where imported.provider = 'pluggy'
  and imported.connection_id = 'a3000000-0000-4000-8000-000000000001'
  and imported.external_account_id = 'open-finance-runtime-account'
  and imported.external_transaction_id = 'open-finance-runtime-concurrent';
'@
  $persistedIds = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $persistedIdsSql -Description 'persisted concurrency IDs') `
    -Description 'persisted concurrency IDs'
  $expectedIds = "$($rpcResults[0].ImportedId)|$($rpcResults[0].TransactionId)"
  Assert-True `
    -Condition ($persistedIds -eq $expectedIds) `
    -Message 'the shared RPC IDs are the IDs persisted in PostgreSQL'

  Remove-TrackedJobs

  Write-Step 'Validating effective table grants and row-level security with real role sessions'

  $anonReadSql = @'
set role anon;
select count(*) from public.bank_connections;
'@
  Assert-ExpectedSqlFailure `
    -Sql $anonReadSql `
    -Description 'anon banking table read' `
    -RequiredPatterns @('42501', '(?i)permission denied for table bank_connections')

  $authenticatedWriteSql = @'
begin;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-8000-000000000001';
update public.bank_connections
set account_name = 'This write must be denied'
where id = 'a3000000-0000-4000-8000-000000000001';
rollback;
'@
  Assert-ExpectedSqlFailure `
    -Sql $authenticatedWriteSql `
    -Description 'authenticated banking table write' `
    -RequiredPatterns @('42501', '(?i)permission denied for table bank_connections')

  $memberRlsSql = @'
begin;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-8000-000000000001';
select concat_ws(
  '|',
  (select count(*) from public.bank_connections where household_id = 'a2000000-0000-4000-8000-000000000001'),
  (select count(*) from public.bank_connection_consents where household_id = 'a2000000-0000-4000-8000-000000000001'),
  (select count(*) from public.bank_sync_runs where household_id = 'a2000000-0000-4000-8000-000000000001'),
  (select count(*) from public.imported_bank_transactions where household_id = 'a2000000-0000-4000-8000-000000000001')
);
rollback;
'@
  $memberRlsCounts = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $memberRlsSql -Description 'member RLS query') `
    -Description 'member RLS query'
  Assert-True `
    -Condition ($memberRlsCounts -eq '1|1|1|1') `
    -Message 'an authenticated member sees all four banking fixture rows'

  $otherRlsSql = @'
begin;
set local role authenticated;
set local "request.jwt.claim.sub" = 'a1000000-0000-4000-8000-000000000002';
select concat_ws(
  '|',
  (select count(*) from public.bank_connections where household_id = 'a2000000-0000-4000-8000-000000000001'),
  (select count(*) from public.bank_connection_consents where household_id = 'a2000000-0000-4000-8000-000000000001'),
  (select count(*) from public.bank_sync_runs where household_id = 'a2000000-0000-4000-8000-000000000001'),
  (select count(*) from public.imported_bank_transactions where household_id = 'a2000000-0000-4000-8000-000000000001')
);
rollback;
'@
  $otherRlsCounts = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $otherRlsSql -Description 'non-member RLS query') `
    -Description 'non-member RLS query'
  Assert-True `
    -Condition ($otherRlsCounts -eq '0|0|0|0') `
    -Message 'RLS hides all four banking rows from another authenticated user'

  Write-Step 'Running a successful RPC inside an explicit transaction and rolling it back'

  $explicitRollbackSql = @'
begin;
set local role service_role;
select
  result.imported_bank_transaction_id::text,
  result.transaction_id::text,
  result.inserted::text,
  result.content_changed::text
from public.import_open_finance_transaction(
  p_provider => 'pluggy',
  p_connection_id => 'a3000000-0000-4000-8000-000000000001',
  p_household_id => 'a2000000-0000-4000-8000-000000000001',
  p_created_by => 'a1000000-0000-4000-8000-000000000001',
  p_external_account_id => 'open-finance-runtime-account',
  p_external_transaction_id => 'open-finance-runtime-explicit-rollback',
  p_occurred_on => date '2026-08-21',
  p_description => 'Runtime explicit transaction rollback',
  p_amount_cents => 5050,
  p_direction => 'expense',
  p_sync_run_id => 'a5000000-0000-4000-8000-000000000001',
  p_posted_at => timestamptz '2026-08-21 10:00:00+00',
  p_raw_payload => '{"runtime":"explicit-rollback"}'::jsonb
) as result;
rollback;
'@
  $explicitRollbackResult = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $explicitRollbackSql -Description 'explicit RPC rollback') `
    -Description 'explicit RPC rollback result'
  $explicitRollbackParts = $explicitRollbackResult -split '\|', 4
  Assert-True `
    -Condition (
      $explicitRollbackParts.Count -eq 4 `
      -and $explicitRollbackParts[0] -match '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$' `
      -and $explicitRollbackParts[1] -match '^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$' `
      -and $explicitRollbackParts[2] -eq 'true' `
      -and $explicitRollbackParts[3] -eq 'false'
    ) `
    -Message 'the RPC succeeds and creates a linked pair before explicit rollback'

  $explicitRollbackCountSql = @'
select concat_ws(
  '|',
  (
    select count(*)
    from public.imported_bank_transactions
    where provider = 'pluggy'
      and connection_id = 'a3000000-0000-4000-8000-000000000001'
      and external_account_id = 'open-finance-runtime-account'
      and external_transaction_id = 'open-finance-runtime-explicit-rollback'
  ),
  (
    select count(*)
    from public.transactions
    where household_id = 'a2000000-0000-4000-8000-000000000001'
      and created_by = 'a1000000-0000-4000-8000-000000000001'
      and note = 'Runtime explicit transaction rollback'
      and occurred_on = date '2026-08-21'
      and amount_cents = 5050
  )
);
'@
  $explicitRollbackCounts = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $explicitRollbackCountSql -Description 'explicit rollback row counts') `
    -Description 'explicit rollback row counts'
  Assert-True `
    -Condition ($explicitRollbackCounts -eq '0|0') `
    -Message 'explicit ROLLBACK leaves zero imported and transactions rows'

  Write-Step 'Forcing a mid-RPC failure and proving statement rollback'

  $forcedFailureSql = @'
set role service_role;
select *
from public.import_open_finance_transaction(
  p_provider => 'pluggy',
  p_connection_id => 'a3000000-0000-4000-8000-000000000001',
  p_household_id => 'a2000000-0000-4000-8000-000000000001',
  p_created_by => 'a1000000-0000-4000-8000-000000000001',
  p_external_account_id => 'open-finance-runtime-account',
  p_external_transaction_id => 'open-finance-runtime-rollback',
  p_occurred_on => date '2026-08-21',
  p_description => 'Runtime forced rollback',
  p_amount_cents => 5151,
  p_direction => 'expense',
  p_sync_run_id => 'a5000000-0000-4000-8000-000000000001',
  p_posted_at => timestamptz '2026-08-21 12:00:00+00',
  p_raw_payload => '{"runtime":"rollback"}'::jsonb
);
'@
  Assert-ExpectedSqlFailure `
    -Sql $forcedFailureSql `
    -Description 'forced mid-RPC association failure' `
    -RequiredPatterns @('P0001', 'OPEN_FINANCE_RUNTIME_FORCED_FAILURE')

  $rollbackCountSql = @'
select concat_ws(
  '|',
  (
    select count(*)
    from public.imported_bank_transactions
    where provider = 'pluggy'
      and connection_id = 'a3000000-0000-4000-8000-000000000001'
      and external_account_id = 'open-finance-runtime-account'
      and external_transaction_id = 'open-finance-runtime-rollback'
  ),
  (
    select count(*)
    from public.transactions
    where household_id = 'a2000000-0000-4000-8000-000000000001'
      and created_by = 'a1000000-0000-4000-8000-000000000001'
      and note = 'Runtime forced rollback'
      and occurred_on = date '2026-08-21'
      and amount_cents = 5151
  ),
  (
    select count(*)
    from public.imported_bank_transactions
    where household_id = 'a2000000-0000-4000-8000-000000000001'
      and transaction_id is null
  ),
  (
    select count(*)
    from public.transactions as ledger
    left join public.imported_bank_transactions as imported
      on imported.transaction_id = ledger.id
    where ledger.household_id = 'a2000000-0000-4000-8000-000000000001'
      and ledger.created_by = 'a1000000-0000-4000-8000-000000000001'
      and imported.id is null
  )
);
'@
  $rollbackCounts = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $rollbackCountSql -Description 'rollback row counts') `
    -Description 'rollback row counts'
  Assert-True `
    -Condition ($rollbackCounts -eq '0|0|0|0') `
    -Message 'the failed RPC leaves no reservation, ledger row, or fixture orphan'

  $postRollbackCounts = Get-OnlyOutputLine `
    -Output (Invoke-PsqlRequired -Sql $concurrencyCountSql -Description 'post-rollback concurrency counts') `
    -Description 'post-rollback concurrency counts'
  Assert-True `
    -Condition ($postRollbackCounts -eq '1|1|0|0') `
    -Message 'the successful concurrent import remains exactly one linked pair after rollback testing'

}
catch {
  $script:Failed = $true
  Write-Host "`nOPEN FINANCE RUNTIME GATE FAILED" -ForegroundColor Red
  Write-Host $_.Exception.ToString() -ForegroundColor Red
}
finally {
  if (-not [string]::IsNullOrWhiteSpace($script:DbContainer)) {
    Write-Step 'Terminating database sessions owned by this runtime harness'
    try {
      Stop-HarnessDatabaseBackends -Description 'final harness backend termination'
    }
    catch {
      $script:Failed = $true
      Write-Host "BACKEND TERMINATION FAILED: $($_.Exception.ToString())" -ForegroundColor Red
    }
  }

  Remove-TrackedJobs

  if (
    -not [string]::IsNullOrWhiteSpace($script:DbContainer) `
    -and $script:FixturesInstalled
  ) {
    Write-Step 'Cleaning test-only triggers, functions, and deterministic fixtures'
    try {
      $null = Invoke-PsqlRequired -Sql $cleanupSql -Description 'runtime fixture cleanup'

      $cleanupVerificationSql = @'
set statement_timeout = '15s';

select concat_ws(
  '|',
  (
    select count(*)
    from auth.users
    where id in (
      'a1000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000002'
    )
  ),
  (
    select count(*)
    from public.households
    where id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
  ),
  (
    select count(*)
    from public.memberships
    where household_id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
      or user_id in (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
  ),
  (
    select count(*)
    from public.bank_connections
    where id = 'a3000000-0000-4000-8000-000000000001'
      or household_id in (
        'a2000000-0000-4000-8000-000000000001',
        'a2000000-0000-4000-8000-000000000002'
      )
      or created_by in (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
      or external_connection_id = 'open-finance-runtime-connection'
  ),
  (
    select count(*)
    from public.bank_connection_consents
    where id = 'a4000000-0000-4000-8000-000000000001'
      or household_id in (
        'a2000000-0000-4000-8000-000000000001',
        'a2000000-0000-4000-8000-000000000002'
      )
      or created_by in (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
      or external_consent_id = 'open-finance-runtime-consent'
  ),
  (
    select count(*)
    from public.bank_sync_runs
    where id = 'a5000000-0000-4000-8000-000000000001'
      or household_id in (
        'a2000000-0000-4000-8000-000000000001',
        'a2000000-0000-4000-8000-000000000002'
      )
      or created_by in (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
  ),
  (
    select count(*)
    from public.imported_bank_transactions
    where household_id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
      or created_by in (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
      or external_transaction_id in (
        'open-finance-runtime-concurrent',
        'open-finance-runtime-explicit-rollback',
        'open-finance-runtime-rollback'
      )
  ),
  (
    select count(*)
    from public.transactions
    where household_id in (
      'a2000000-0000-4000-8000-000000000001',
      'a2000000-0000-4000-8000-000000000002'
    )
      or created_by in (
        'a1000000-0000-4000-8000-000000000001',
        'a1000000-0000-4000-8000-000000000002'
      )
      or note in (
        'Runtime concurrent import',
        'Runtime explicit transaction rollback',
        'Runtime forced rollback'
      )
  ),
  (
    select count(*)
    from pg_catalog.pg_trigger
    where tgname in (
      '__open_finance_runtime_pause_insert',
      '__open_finance_runtime_fail_association'
    )
      and not tgisinternal
  ),
  (
    select count(*)
    from pg_catalog.pg_proc
    where oid in (
      to_regprocedure('public.__open_finance_runtime_pause_insert()'),
      to_regprocedure('public.__open_finance_runtime_fail_association()')
    )
  )
);
'@
      $cleanupVerification = Get-OnlyOutputLine `
        -Output (Invoke-PsqlRequired -Sql $cleanupVerificationSql -Description 'cleanup verification') `
        -Description 'cleanup verification'
      if ($cleanupVerification -ne '0|0|0|0|0|0|0|0|0|0') {
        throw "cleanup verification returned $cleanupVerification instead of 0|0|0|0|0|0|0|0|0|0"
      }
      $script:FixturesInstalled = $false
      Write-Host 'PASS: runtime rows, transactions, triggers, and functions were removed' -ForegroundColor Green
    }
    catch {
      $script:Failed = $true
      Write-Host "CLEANUP FAILED: $($_.Exception.ToString())" -ForegroundColor Red
    }
  }
  elseif (-not [string]::IsNullOrWhiteSpace($script:DbContainer)) {
    Write-Host 'INFO: fixture setup never committed; destructive fixture cleanup was skipped.'
  }
}

if ($script:Failed) {
  exit 1
}

Write-Host "`nALL OPEN FINANCE RUNTIME GATES PASSED" -ForegroundColor Green
exit 0
