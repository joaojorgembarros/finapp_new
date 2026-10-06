-- Local smoke for financial_income_acknowledgements.
-- Run after `npx supabase db reset --yes` against the local database.

do $$
declare
  user_a uuid := '33333333-3333-3333-3333-333333333333';
  user_b uuid := '44444444-4444-4444-4444-444444444444';
  house_a uuid;
  house_b uuid;
  fixed_key text := 'merchant:v1:income:nubank:salario:empresa alpha';
  variable_key text := 'merchant:v1:income:nubank:empresa beta';
  result jsonb;
  fixed_cents bigint;
  variable_cents bigint;
  legacy_cents bigint;
  decision_count integer;
  anon_failed boolean := false;
  direct_failed boolean := false;
  other_fixed bigint;
begin
  delete from auth.users where id in (user_a, user_b);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
  ) values
    ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated',
     'income-a@example.com', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), ''),
    ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
     'income-b@example.com', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), '');

  insert into public.profiles (user_id, income_cents, income_fixed_cents, income_variable_avg_cents)
  values
    (user_a, 0, 0, 0),
    (user_b, 900000, 700000, 200000);

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  house_a := public.create_household('Casa Renda A', 'individual');

  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  house_b := public.create_household('Casa Renda B', 'individual');

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  begin
    execute 'set local role authenticated';
    insert into public.financial_income_acknowledgements (
      household_id, user_id, pattern_key, target_field, decision, suggested_cents,
      profile_cents_before, normalized_merchant, behavior_type, created_by
    ) values (
      house_a, user_a, fixed_key, 'income_fixed_cents', 'declined', 480000,
      0, 'salario:empresa alpha', 'fixed_recurring_income', user_a
    );
    execute 'reset role';
    raise exception 'direct acknowledgement insert was allowed';
  exception
    when insufficient_privilege then
      execute 'reset role';
      direct_failed := true;
    when others then
      execute 'reset role';
      if sqlerrm like '%direct acknowledgement%' then
        raise;
      end if;
      direct_failed := true;
  end;
  if not direct_failed then
    raise exception 'authenticated direct insert was allowed';
  end if;

  begin
    execute 'set local role anon';
    perform public.acknowledge_income_pattern(
      house_a, fixed_key, 'income_fixed_cents', 'incorporated',
      480000, 480000, 0, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    execute 'reset role';
    raise exception 'anon acknowledge was allowed';
  exception
    when insufficient_privilege then
      execute 'reset role';
      anon_failed := true;
    when others then
      execute 'reset role';
      if sqlerrm like '%anon acknowledge%' then
        raise;
      end if;
      anon_failed := true;
  end;
  if not anon_failed then
    raise exception 'anon was able to call acknowledge_income_pattern';
  end if;

  result := public.acknowledge_income_pattern(
    house_a, fixed_key, 'income_fixed_cents', 'incorporated',
    480000, 480000, 0, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
  );
  if result->>'decision' <> 'incorporated' or (result->>'profile_cents_before')::bigint <> 0
    or (result->>'profile_cents_after')::bigint <> 480000 then
    raise exception 'zero fixed income was not incorporated absolutely';
  end if;
  select income_fixed_cents, income_variable_avg_cents, income_cents
  into fixed_cents, variable_cents, legacy_cents
  from public.profiles where user_id = user_a;
  if fixed_cents <> 480000 or variable_cents <> 0 or legacy_cents <> 480000 then
    raise exception 'fixed incorporation did not keep the mirror and the other field';
  end if;

  result := public.acknowledge_income_pattern(
    house_a, fixed_key, 'income_fixed_cents', 'incorporated',
    480000, 480000, 0, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
  );
  select income_fixed_cents into fixed_cents from public.profiles where user_id = user_a;
  if fixed_cents <> 480000 or (result->>'profile_cents_after')::bigint <> 480000 then
    raise exception 'repeating the same incorporation changed the total';
  end if;
  select count(*) into decision_count
  from public.financial_income_acknowledgements as acknowledgement
  where acknowledgement.household_id = house_a
    and acknowledgement.user_id = user_a
    and acknowledgement.pattern_key = fixed_key;
  if decision_count <> 1 then
    raise exception 'repeated incorporation created another acknowledgement';
  end if;

  begin
    perform public.acknowledge_income_pattern(
      house_a, variable_key, 'income_variable_avg_cents', 'incorporated',
      460000, 460000, 100, 'nubank', 'empresa beta', 'variable_recurring_income'
    );
    raise exception 'stale expected current was accepted';
  exception
    when others then
      if sqlerrm not like '%Renda alterada em outro lugar%' then
        raise;
      end if;
  end;
  select income_variable_avg_cents into variable_cents from public.profiles where user_id = user_a;
  if variable_cents <> 0 then
    raise exception 'stale expected current changed variable income';
  end if;

  result := public.acknowledge_income_pattern(
    house_a, variable_key, 'income_variable_avg_cents', 'incorporated',
    460000, 460000, 0, 'nubank', 'empresa beta', 'variable_recurring_income'
  );
  select income_fixed_cents, income_variable_avg_cents, income_cents
  into fixed_cents, variable_cents, legacy_cents
  from public.profiles where user_id = user_a;
  if variable_cents <> 460000 or fixed_cents <> 480000 or legacy_cents <> 940000 then
    raise exception 'variable incorporation disturbed fixed income or the mirror';
  end if;

  update public.profiles
  set income_fixed_cents = 800000, income_cents = 800000 + income_variable_avg_cents
  where user_id = user_a;

  begin
    perform public.acknowledge_income_pattern(
      house_a, fixed_key, 'income_fixed_cents', 'incorporated',
      520000, 520000, 480000, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    raise exception 'manual profile edit was overwritten';
  exception
    when others then
      if sqlerrm not like '%Renda alterada em outro lugar%' then
        raise;
      end if;
  end;
  select income_fixed_cents into fixed_cents from public.profiles where user_id = user_a;
  if fixed_cents <> 800000 then
    raise exception 'concurrent manual edit did not survive';
  end if;

  result := public.acknowledge_income_pattern(
    house_a, 'merchant:v1:income:nubank:empresa gama', 'income_fixed_cents', 'incorporated',
    620000, 1280000, 800000, 'nubank', 'empresa gama', 'fixed_recurring_income'
  );
  select income_fixed_cents, income_variable_avg_cents into fixed_cents, variable_cents
  from public.profiles where user_id = user_a;
  if fixed_cents <> 1280000 or variable_cents <> 460000 or (result->>'profile_cents_before')::bigint <> 800000 then
    raise exception 'absolute sum did not replace the fixed total once';
  end if;

  result := public.acknowledge_income_pattern(
    house_a, 'merchant:v1:income:inter:empresa delta', 'income_fixed_cents', 'declined',
    120000, 1280000, 1280000, 'inter', 'empresa delta', 'fixed_recurring_income'
  );
  if result->>'profile_cents_after' is not null or result->>'decision' <> 'declined' then
    raise exception 'decline stored an applied total';
  end if;
  select income_fixed_cents into fixed_cents from public.profiles where user_id = user_a;
  if fixed_cents <> 1280000 then
    raise exception 'decline changed the profile';
  end if;

  result := public.acknowledge_income_pattern(
    house_a, 'merchant:v1:income:inter:empresa delta', 'income_fixed_cents', 'incorporated',
    120000, 120000, 1280000, 'inter', 'empresa delta', 'fixed_recurring_income'
  );
  select income_fixed_cents into fixed_cents from public.profiles where user_id = user_a;
  if result->>'decision' <> 'incorporated' or fixed_cents <> 120000 then
    raise exception 'declined acknowledgement did not become incorporated';
  end if;

  begin
    perform public.acknowledge_income_pattern(
      house_a, fixed_key, 'income_variable_avg_cents', 'incorporated',
      480000, 480000, 460000, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    raise exception 'incompatible behavior was accepted';
  exception
    when others then
      if sqlerrm not like '%não corresponde ao campo%' then
        raise;
      end if;
  end;

  begin
    perform public.acknowledge_income_pattern(
      house_a, fixed_key, 'income_cents', 'incorporated',
      480000, 480000, 120000, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    raise exception 'invalid target field was accepted';
  exception
    when others then
      if sqlerrm not like '%campo de renda informado é inválido%' then
        raise;
      end if;
  end;

  begin
    perform public.acknowledge_income_pattern(
      house_a, fixed_key, 'income_fixed_cents', 'incorporated',
      -1, 100, 120000, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    raise exception 'negative suggested cents was accepted';
  exception
    when others then
      if sqlerrm not like '%valor observado é inválido%' then
        raise;
      end if;
  end;

  begin
    perform public.acknowledge_income_pattern(
      house_a, fixed_key, 'income_fixed_cents', 'incorporated',
      100, 1000000001, 120000, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    raise exception 'total above the ceiling was accepted';
  exception
    when others then
      if sqlerrm not like '%novo total de renda é inválido%' then
        raise;
      end if;
  end;

  begin
    perform public.acknowledge_income_pattern(
      house_b, fixed_key, 'income_fixed_cents', 'incorporated',
      480000, 480000, 120000, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    raise exception 'cross-household acknowledge was accepted';
  exception
    when others then
      if sqlerrm not like '%não tem acesso%' then
        raise;
      end if;
  end;

  select income_fixed_cents into other_fixed from public.profiles where user_id = user_b;
  if other_fixed <> 700000 then
    raise exception 'another user profile was changed';
  end if;

  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '{}', true);
  begin
    perform public.acknowledge_income_pattern(
      house_a, fixed_key, 'income_fixed_cents', 'incorporated',
      480000, 480000, 120000, 'nubank', 'salario:empresa alpha', 'fixed_recurring_income'
    );
    raise exception 'missing user was accepted';
  exception
    when others then
      if sqlerrm not like '%autenticado%' and sqlerrm not like '%invalid input syntax%' then
        raise;
      end if;
  end;

  raise notice 'financial_income_acknowledgements smoke passed house_a=%', house_a;
end;
$$;
