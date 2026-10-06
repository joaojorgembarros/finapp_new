-- Income acknowledgements record that a person already handled one observed
-- income pattern. They are not a financial source of truth.
-- Planned income stays on profiles.income_fixed_cents and
-- profiles.income_variable_avg_cents. income_cents remains their sum.
--
-- Decision identity, produced by the client and stored verbatim:
--   merchant:v1:income:{accountId|none}:{normalizedMerchant}
-- The merchant segment may contain spaces and colons (salario:empresa alpha).
-- Amount, confidence, occurrence count and dates are not part of the key.

create table if not exists public.financial_income_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  pattern_key text not null check (
    char_length(trim(pattern_key)) between 1 and 240
    and pattern_key ~ '^merchant:v1:income:[^:]+:.+$'
  ),
  target_field text not null check (target_field in ('income_fixed_cents', 'income_variable_avg_cents')),
  decision text not null check (decision in ('incorporated', 'declined')),
  suggested_cents bigint not null check (suggested_cents >= 0 and suggested_cents <= 1000000000),
  profile_cents_before bigint not null check (profile_cents_before >= 0 and profile_cents_before <= 1000000000),
  profile_cents_after bigint,
  account_id text check (account_id is null or char_length(trim(account_id)) between 1 and 80),
  normalized_merchant text not null check (char_length(trim(normalized_merchant)) between 1 and 160),
  behavior_type text not null check (behavior_type in ('fixed_recurring_income', 'variable_recurring_income')),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (household_id, user_id, pattern_key),
  check (
    (
      decision = 'declined'
      and profile_cents_after is null
    )
    or (
      decision = 'incorporated'
      and profile_cents_after is not null
      and profile_cents_after >= 0
      and profile_cents_after <= 1000000000
    )
  ),
  check (
    (target_field = 'income_fixed_cents' and behavior_type = 'fixed_recurring_income')
    or (target_field = 'income_variable_avg_cents' and behavior_type = 'variable_recurring_income')
  )
);

create index if not exists financial_income_acknowledgements_user_household_idx
  on public.financial_income_acknowledgements (user_id, household_id);

alter table public.financial_income_acknowledgements enable row level security;

revoke all on table public.financial_income_acknowledgements from public, anon, authenticated;
grant select on table public.financial_income_acknowledgements to authenticated;

drop policy if exists financial_income_acknowledgements_select_own on public.financial_income_acknowledgements;
create policy financial_income_acknowledgements_select_own
  on public.financial_income_acknowledgements
  for select using (user_id = auth.uid() and public.is_member(household_id));

drop policy if exists financial_income_acknowledgements_insert_own on public.financial_income_acknowledgements;
drop policy if exists financial_income_acknowledgements_update_own on public.financial_income_acknowledgements;
drop policy if exists financial_income_acknowledgements_delete_own on public.financial_income_acknowledgements;

create or replace function public.acknowledge_income_pattern(
  p_household_id uuid,
  p_pattern_key text,
  p_target_field text,
  p_decision text,
  p_suggested_cents bigint,
  p_desired_total_cents bigint,
  p_expected_current_cents bigint,
  p_account_id text,
  p_normalized_merchant text,
  p_behavior_type text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  max_cents constant bigint := 1000000000;
  stable_key text := trim(coalesce(p_pattern_key, ''));
  merchant text := trim(coalesce(p_normalized_merchant, ''));
  account_ref text := nullif(trim(coalesce(p_account_id, '')), '');
  fixed_cents bigint;
  variable_cents bigint;
  current_cents bigint;
  existing public.financial_income_acknowledgements%rowtype;
begin
  if uid is null then
    raise exception using errcode = '42501', message = 'Você precisa estar autenticado.';
  end if;
  if not public.is_member(p_household_id) then
    raise exception using errcode = '42501', message = 'Você não tem acesso a este planejamento.';
  end if;
  if stable_key !~ '^merchant:v1:income:[^:]+:.+$' or char_length(stable_key) > 240 then
    raise exception using errcode = '22023', message = 'A identificação da renda é inválida.';
  end if;
  if p_target_field is null or p_target_field not in ('income_fixed_cents', 'income_variable_avg_cents') then
    raise exception using errcode = '22023', message = 'O campo de renda informado é inválido.';
  end if;
  if p_decision is null or p_decision not in ('incorporated', 'declined') then
    raise exception using errcode = '22023', message = 'A decisão informada é inválida.';
  end if;
  if p_behavior_type is null or p_behavior_type not in ('fixed_recurring_income', 'variable_recurring_income') then
    raise exception using errcode = '22023', message = 'Este padrão de renda não pode entrar no planejamento.';
  end if;
  if (p_target_field = 'income_fixed_cents' and p_behavior_type <> 'fixed_recurring_income')
    or (p_target_field = 'income_variable_avg_cents' and p_behavior_type <> 'variable_recurring_income') then
    raise exception using errcode = '22023', message = 'O tipo de renda não corresponde ao campo escolhido.';
  end if;
  if merchant = '' or char_length(merchant) > 160 then
    raise exception using errcode = '22023', message = 'O pagador informado é inválido.';
  end if;
  if account_ref is not null and char_length(account_ref) > 80 then
    raise exception using errcode = '22023', message = 'A conta informada é inválida.';
  end if;
  if p_suggested_cents is null or p_suggested_cents < 0 or p_suggested_cents > max_cents then
    raise exception using errcode = '22023', message = 'O valor observado é inválido.';
  end if;
  if p_expected_current_cents is null or p_expected_current_cents < 0 or p_expected_current_cents > max_cents then
    raise exception using errcode = '22023', message = 'A renda atual informada é inválida.';
  end if;
  if p_decision = 'incorporated'
    and (p_desired_total_cents is null or p_desired_total_cents < 0 or p_desired_total_cents > max_cents) then
    raise exception using errcode = '22023', message = 'O novo total de renda é inválido.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    p_household_id::text || ':income:' || uid::text || ':' || stable_key,
    0
  ));

  select income_fixed_cents, income_variable_avg_cents
  into fixed_cents, variable_cents
  from public.profiles
  where user_id = uid
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Seu perfil ainda não está pronto.';
  end if;

  current_cents := case
    when p_target_field = 'income_fixed_cents' then fixed_cents
    else variable_cents
  end;

  select acknowledgement.*
  into existing
  from public.financial_income_acknowledgements as acknowledgement
  where acknowledgement.household_id = p_household_id
    and acknowledgement.user_id = uid
    and acknowledgement.pattern_key = stable_key
  for update;

  if p_decision = 'incorporated'
    and existing.id is not null
    and existing.decision = 'incorporated'
    and existing.target_field = p_target_field
    and existing.profile_cents_after = p_desired_total_cents
    and current_cents = p_desired_total_cents then
    return to_jsonb(existing);
  end if;

  if p_decision = 'declined'
    and existing.id is not null
    and existing.decision = 'declined'
    and existing.target_field = p_target_field
    and current_cents = p_expected_current_cents then
    return to_jsonb(existing);
  end if;

  if current_cents is distinct from p_expected_current_cents then
    raise exception using errcode = '40001', message = 'Renda alterada em outro lugar. Atualize os valores e tente novamente.';
  end if;

  if p_decision = 'incorporated' then
    update public.profiles
    set
      income_fixed_cents = case
        when p_target_field = 'income_fixed_cents' then p_desired_total_cents
        else income_fixed_cents
      end,
      income_variable_avg_cents = case
        when p_target_field = 'income_variable_avg_cents' then p_desired_total_cents
        else income_variable_avg_cents
      end,
      income_cents = case
        when p_target_field = 'income_fixed_cents' then p_desired_total_cents + income_variable_avg_cents
        else income_fixed_cents + p_desired_total_cents
      end,
      updated_at = now()
    where user_id = uid
    returning income_fixed_cents, income_variable_avg_cents
    into fixed_cents, variable_cents;
  end if;

  insert into public.financial_income_acknowledgements (
    household_id,
    user_id,
    pattern_key,
    target_field,
    decision,
    suggested_cents,
    profile_cents_before,
    profile_cents_after,
    account_id,
    normalized_merchant,
    behavior_type,
    created_by,
    updated_at
  ) values (
    p_household_id,
    uid,
    stable_key,
    p_target_field,
    p_decision,
    p_suggested_cents,
    current_cents,
    case when p_decision = 'incorporated' then p_desired_total_cents else null end,
    account_ref,
    merchant,
    p_behavior_type,
    uid,
    now()
  )
  on conflict (household_id, user_id, pattern_key) do update set
    target_field = excluded.target_field,
    decision = excluded.decision,
    suggested_cents = excluded.suggested_cents,
    profile_cents_before = excluded.profile_cents_before,
    profile_cents_after = excluded.profile_cents_after,
    account_id = excluded.account_id,
    normalized_merchant = excluded.normalized_merchant,
    behavior_type = excluded.behavior_type,
    updated_at = now()
  returning * into existing;

  return to_jsonb(existing);
end;
$$;

revoke all on function public.acknowledge_income_pattern(uuid, text, text, text, bigint, bigint, bigint, text, text, text) from public, anon;
grant execute on function public.acknowledge_income_pattern(uuid, text, text, text, bigint, bigint, bigint, text, text, text) to authenticated;

notify pgrst, 'reload schema';
