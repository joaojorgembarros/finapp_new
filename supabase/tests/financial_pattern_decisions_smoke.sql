-- Local smoke for financial_pattern_decisions.
-- Run after `npx supabase db reset --yes` against the local database.

do $$
declare
  user_a uuid := '11111111-1111-1111-1111-111111111111';
  user_b uuid := '22222222-2222-2222-2222-222222222222';
  house_a uuid;
  house_b uuid;
  commitment_a uuid;
  commitment_new uuid;
  commitment_other uuid;
  confirmed jsonb;
  confirmed_again jsonb;
  rejected jsonb;
  decision_count integer;
  anon_count integer;
  other_count integer;
  direct_write_failed boolean := false;
begin
  delete from auth.users where id in (user_a, user_b);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
  ) values
    ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated',
     'pattern-a@example.com', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), ''),
    ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
     'pattern-b@example.com', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), '');

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  house_a := public.create_household('Casa A', 'individual');

  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  house_b := public.create_household('Casa B', 'individual');

  insert into public.financial_commitments (
    household_id, created_by, kind, name, amount_cents, due_day, starts_on, active
  ) values (
    house_b, user_b, 'fixed_bill', 'Netflix', 4490, 5, '2026-08-01', true
  ) returning id into commitment_other;

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  begin
    execute 'set local role authenticated';
    insert into public.financial_pattern_decisions (
      household_id, pattern_key, direction, behavior_type, cadence, decision,
      linked_commitment_id, created_by
    ) values (
      house_a, 'merchant:v1:expense:nubank:spotify', 'expense', 'fixed_recurring_expense',
      'monthly', 'confirmed', commitment_other, user_a
    );
    execute 'reset role';
    raise exception 'direct write linked another household commitment';
  exception
    when insufficient_privilege then
      execute 'reset role';
      direct_write_failed := true;
    when others then
      execute 'reset role';
      if sqlerrm like '%direct write%' then
        raise;
      end if;
      direct_write_failed := true;
  end;
  if not direct_write_failed then
    raise exception 'authenticated direct insert was allowed';
  end if;

  begin
    insert into public.financial_pattern_decisions (
      household_id, pattern_key, direction, behavior_type, cadence, decision, created_by
    ) values (
      house_a, 'merchant:v1:expense:nubank:invalid-confirmed', 'expense', 'fixed_recurring_expense',
      'monthly', 'confirmed', user_a
    );
    raise exception 'confirmed without a commitment was allowed';
  exception
    when check_violation then
      null;
    when others then
      if sqlerrm not like '%confirmação precisa%' then
        raise;
      end if;
  end;

  insert into public.financial_commitments (
    household_id, created_by, kind, name, amount_cents, due_day, starts_on, active
  ) values (
    house_a, user_a, 'fixed_bill', 'Spotify', 2190, 8, '2026-08-01', true
  ) returning id into commitment_new;

  begin
    insert into public.financial_pattern_decisions (
      household_id, pattern_key, direction, behavior_type, cadence, decision,
      linked_commitment_id, created_by
    ) values (
      house_a, 'merchant:v1:expense:nubank:invalid-rejected', 'expense', 'fixed_recurring_expense',
      'monthly', 'rejected', commitment_new, user_a
    );
    raise exception 'rejected with a commitment was allowed';
  exception
    when check_violation then
      null;
    when others then
      if sqlerrm not like '%rejeição não pode%' then
        raise;
      end if;
  end;

  begin
    insert into public.financial_pattern_decisions (
      household_id, pattern_key, direction, behavior_type, cadence, decision,
      linked_commitment_id, created_by
    ) values (
      house_a, 'merchant:v1:expense:nubank:cross-link', 'expense', 'fixed_recurring_expense',
      'monthly', 'confirmed', commitment_other, user_a
    );
    raise exception 'trigger allowed a cross-household confirmed decision';
  exception
    when others then
      if sqlerrm not like '%não pertence a esta casa%' then
        raise;
      end if;
  end;

  confirmed := public.confirm_financial_pattern(
    house_a,
    'merchant:v1:expense:nubank:netflix',
    'Netflix',
    4490,
    5,
    null,
    'netflix',
    'expense',
    'fixed_recurring_expense',
    'monthly',
    4490,
    5,
    95,
    '2026-08-05',
    '2026-10-05',
    3
  );
  if coalesce(confirmed->>'id', '') = '' then
    raise exception 'confirm creating a commitment did not return a row';
  end if;
  commitment_a := (confirmed->>'id')::uuid;

  confirmed_again := public.confirm_financial_pattern(
    house_a,
    'merchant:v1:expense:nubank:netflix',
    'Netflix',
    4590,
    6,
    null,
    'netflix',
    'expense',
    'fixed_recurring_expense',
    'monthly',
    4590,
    6,
    95,
    '2026-08-05',
    '2026-10-05',
    4
  );
  if (confirmed_again->>'id')::uuid <> commitment_a then
    raise exception 'confirming twice created a duplicate commitment';
  end if;
  select count(*) into decision_count
  from public.financial_commitments
  where household_id = house_a and name = 'Netflix' and active = true;
  if decision_count <> 1 then
    raise exception 'confirm twice duplicated Netflix commitments: %', decision_count;
  end if;

  begin
    perform public.reject_financial_pattern(house_a, 'merchant:v1:expense:nubank:netflix');
    raise exception 'reject overwrote a confirmed Netflix decision';
  exception
    when others then
      if sqlerrm not like '%já faz parte do planejamento%' then
        raise;
      end if;
  end;

  confirmed := public.confirm_financial_pattern(
    house_a,
    'merchant:v1:expense:inter:cemig',
    'Cemig',
    21000,
    10,
    commitment_a,
    'cemig',
    'expense',
    'variable_recurring_expense',
    'monthly',
    21000,
    10,
    80,
    '2026-08-10',
    '2026-10-09',
    3
  );
  if (confirmed->>'id')::uuid <> commitment_a then
    raise exception 'confirm linking an existing commitment did not reuse it';
  end if;

  begin
    perform public.confirm_financial_pattern(
      house_a,
      'merchant:v1:expense:nubank:spotify',
      'Spotify',
      2190,
      8,
      commitment_other,
      'spotify',
      'expense',
      'fixed_recurring_expense',
      'monthly'
    );
    raise exception 'linked a commitment from another household';
  exception
    when others then
      if sqlerrm not like '%não pertence a esta casa%' then
        raise;
      end if;
  end;

  rejected := public.reject_financial_pattern(
    house_a,
    'merchant:v1:expense:nubank:ifood',
    'ifood',
    'expense',
    'variable_recurring_expense',
    'monthly',
    8900,
    12,
    75,
    '2026-08-12',
    '2026-10-12',
    3
  );
  if rejected->>'decision' <> 'rejected' then
    raise exception 'reject did not persist rejected';
  end if;
  if rejected->>'linked_commitment_id' is not null then
    raise exception 'reject created a commitment link';
  end if;

  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into other_count
  from public.financial_pattern_decisions
  where household_id = house_a;
  execute 'reset role';
  if other_count <> 0 then
    raise exception 'other household read local decisions via RLS bypass; count=%', other_count;
  end if;

  begin
    perform public.confirm_financial_pattern(
      house_a,
      'merchant:v1:expense:nubank:disney',
      'Disney',
      2790,
      3
    );
    raise exception 'other household confirmed into house A';
  exception
    when others then
      if sqlerrm not like '%não tem acesso%' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    execute 'set local role anon';
    select count(*) into anon_count from public.financial_pattern_decisions;
    execute 'reset role';
    if anon_count <> 0 then
      raise exception 'anon read pattern decisions; count=%', anon_count;
    end if;
  exception
    when insufficient_privilege then
      execute 'reset role';
      anon_count := -1;
  end;

  begin
    perform public.confirm_financial_pattern(
      house_a,
      'merchant:v1:expense:nubank:hbo',
      'HBO',
      1990,
      2
    );
    raise exception 'anon confirmed a pattern';
  exception
    when others then
      if sqlerrm not like '%autenticado%' and sqlerrm not like '%não tem acesso%' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  update public.financial_commitments
  set active = false, archived_at = now()
  where id = commitment_a;

  confirmed := public.confirm_financial_pattern(
    house_a,
    'merchant:v1:expense:nubank:netflix',
    'Netflix',
    4490,
    5,
    null,
    'netflix',
    'expense',
    'fixed_recurring_expense',
    'monthly',
    4490,
    5,
    95,
    '2026-08-05',
    '2026-10-05',
    3
  );
  if (confirmed->>'id')::uuid = commitment_a then
    raise exception 'confirm reused an archived commitment';
  end if;
  if coalesce(confirmed->>'active', '') <> 'true' then
    raise exception 'confirm after archive did not return an active commitment';
  end if;

  delete from public.financial_commitments where id = (confirmed->>'id')::uuid;
  select count(*) into decision_count
  from public.financial_pattern_decisions
  where household_id = house_a
    and pattern_key = 'merchant:v1:expense:nubank:netflix';
  if decision_count <> 0 then
    raise exception 'deleting the linked commitment did not cascade the confirmed decision';
  end if;

  raise notice 'financial_pattern_decisions smoke passed house_a=% house_b=%', house_a, house_b;
end;
$$;
