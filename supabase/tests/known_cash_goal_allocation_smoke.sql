-- Local smoke for known-cash allocation.
-- Run against the local database after the migration is applied.
-- Does not touch a remote project.

do $$
declare
  user_a uuid := '55555555-5555-5555-5555-555555555555';
  user_b uuid := '66666666-6666-6666-6666-666666666666';
  house_a uuid;
  house_b uuid;
  goal_a uuid;
  goal_small uuid;
  goal_b uuid;
  ref date;
  month_start date;
  position jsonb;
  allocation jsonb;
  replay jsonb;
  contribution_count integer;
  request_count integer;
  transaction_before integer;
  transaction_after integer;
  seen_source_kind text;
  closure_id uuid;
  manual_contribution_id uuid;
  surplus_contribution_id uuid;
  known_contribution_id uuid;
  bill_id uuid;
  payment_tx uuid;
  open_cycle_key text;
  known_cash bigint;
  available bigint;
begin
  delete from auth.users where id in (user_a, user_b);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
  ) values
    ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated',
     'cash-a@example.com', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), ''),
    ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
     'cash-b@example.com', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), '');

  insert into public.profiles (user_id, income_cents, income_fixed_cents, income_variable_avg_cents)
  values
    (user_a, 9000000, 7000000, 2000000),
    (user_b, 100, 100, 0);

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  house_a := public.create_household('Casa Caixa A', 'individual');

  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  house_b := public.create_household('Casa Caixa B', 'individual');

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  insert into public.goals (household_id, title, target_cents, desired_date, created_by)
  values (house_a, 'Viagem', 5000000, null, user_a)
  returning id into goal_a;
  insert into public.goals (household_id, title, target_cents, desired_date, created_by)
  values (house_a, 'Pequeno', 50000, null, user_a)
  returning id into goal_small;
  insert into public.goals (household_id, title, target_cents, desired_date, created_by)
  values (house_b, 'Outra casa', 5000000, null, user_b)
  returning id into goal_b;

  insert into public.financial_settings (household_id, cycle_mode, reserve_cents, updated_by)
  values (house_a, 'calendar', 0, user_a);

  ref := public.known_cash_reference_date();
  month_start := date_trunc('month', ref)::date;

  position := public.get_allocatable_cash_position(house_a);
  if position->>'availableToOrganizeCents' is not null
     or not (position->'blockReasons' ? 'no_snapshot') then
    raise exception 'no snapshot should block allocation, got %', position;
  end if;
  begin
    perform public.allocate_known_cash_to_goal(house_a, goal_a, 100, '11111111-1111-1111-1111-111111111111');
    raise exception 'allocation without snapshot was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:no_snapshot%' then
        raise;
      end if;
  end;

  insert into public.statement_imports (
    household_id, created_by, file_hash, file_name, bank_id, transaction_count,
    final_balance_cents, balance_confidence, period_start, period_end, created_at
  ) values (
    house_a, user_a, encode(digest('stale', 'sha256'), 'hex'), 'stale.csv', 'inter', 1,
    1000000, 'confirmed', month_start - 40, month_start - 1, now()
  );
  position := public.get_allocatable_cash_position(house_a);
  if not (position->'blockReasons' ? 'stale_snapshot') or position->>'canAllocate' <> 'false' then
    raise exception 'stale snapshot should block, got %', position;
  end if;
  begin
    perform public.allocate_known_cash_to_goal(house_a, goal_a, 100, '22222222-2222-2222-2222-222222222222');
    raise exception 'stale allocation was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:stale_snapshot%' then
        raise;
      end if;
  end;

  delete from public.statement_imports where household_id = house_a;
  insert into public.statement_imports (
    household_id, created_by, file_hash, file_name, bank_id, transaction_count,
    final_balance_cents, balance_confidence, period_start, period_end, created_at
  ) values (
    house_a, user_a, encode(digest('boundary-stale', 'sha256'), 'hex'), 'boundary-stale.csv', 'inter', 1,
    1000000, 'confirmed', date '2026-09-01', date '2026-09-30', now()
  );
  position := public.allocatable_cash_position(house_a, date '2026-10-08');
  if not (position->'blockReasons' ? 'stale_snapshot')
     or (position->'dataQuality'->>'isStale')::boolean is not true then
    raise exception '2026-09-30 should be stale on 2026-10-08, got %', position;
  end if;

  delete from public.statement_imports where household_id = house_a;
  insert into public.statement_imports (
    household_id, created_by, file_hash, file_name, bank_id, transaction_count,
    final_balance_cents, balance_confidence, period_start, period_end, created_at
  ) values (
    house_a, user_a, encode(digest('boundary-fresh', 'sha256'), 'hex'), 'boundary-fresh.csv', 'inter', 1,
    1000000, 'confirmed', date '2026-10-01', date '2026-10-01', now()
  );
  position := public.allocatable_cash_position(house_a, date '2026-10-08');
  if position->'blockReasons' ? 'stale_snapshot'
     or (position->'dataQuality'->>'isStale')::boolean
     or (position->>'canAllocate')::boolean is not true then
    raise exception '2026-10-01 should not be stale on 2026-10-08, got %', position;
  end if;

  delete from public.statement_imports where household_id = house_a;
  insert into public.statement_imports (
    household_id, created_by, file_hash, file_name, bank_id, transaction_count,
    final_balance_cents, balance_confidence, period_start, period_end, created_at
  ) values (
    house_a, user_a, encode(digest('nubank', 'sha256'), 'hex'), 'nu.csv', 'nubank', 1,
    250000, 'confirmed', month_start, ref, now()
  );
  position := public.get_allocatable_cash_position(house_a);
  if not (position->'blockReasons' ? 'same_bank_risk') then
    raise exception 'shared bank id should block, got %', position;
  end if;

  delete from public.statement_imports where household_id = house_a;
  insert into public.statement_imports (
    household_id, created_by, file_hash, file_name, bank_id, transaction_count,
    final_balance_cents, balance_confidence, period_start, period_end, created_at
  ) values
    (house_a, user_a, encode(digest('mp-old', 'sha256'), 'hex'), 'mp-old.csv', 'mercado-pago', 1,
     100, 'confirmed', month_start - 70, month_start - 40, now() - interval '2 day'),
    (house_a, user_a, encode(digest('mp-new', 'sha256'), 'hex'), 'mp-new.csv', 'mercado-pago', 1,
     1327993, 'confirmed', month_start, ref, now() - interval '1 day'),
    (house_a, user_a, encode(digest('mp-tie-old', 'sha256'), 'hex'), 'mp-tie-old.csv', 'mercado-pago', 1,
     1, 'confirmed', month_start, ref, now() - interval '3 hour'),
    (house_a, user_a, encode(digest('mp-tie-new', 'sha256'), 'hex'), 'mp-tie-new.csv', 'mercado-pago', 1,
     1327993, 'confirmed', month_start, ref, now()),
    (house_a, user_a, encode(digest('inter', 'sha256'), 'hex'), 'inter.csv', 'inter', 1,
     250000, 'derived', month_start, ref, now()),
    (house_a, user_a, encode(digest('unavailable', 'sha256'), 'hex'), 'bad.csv', 'itau', 1,
     999999, 'unavailable', month_start, ref, now()),
    (house_a, user_a, encode(digest('null-balance', 'sha256'), 'hex'), 'empty.csv', 'caixa', 1,
     null, 'confirmed', month_start, ref, now());
  position := public.get_allocatable_cash_position(house_a);
  if (position->>'knownCashCents')::bigint <> 1577993 then
    raise exception 'latest snapshots should sum to 1577993, got %', position->>'knownCashCents';
  end if;
  if not (position->'blockReasons' ? 'missing_account_snapshot') then
    raise exception 'banks without a usable balance should block, got %', position->'blockReasons';
  end if;

  delete from public.statement_imports where household_id = house_a and bank_id in ('itau', 'caixa');
  if ref > month_start then
    update public.statement_imports
    set period_end = month_start
    where household_id = house_a and bank_id = 'inter';
    position := public.get_allocatable_cash_position(house_a);
    if not (position->'blockReasons' ? 'dates_differ') or (position->>'canAllocate')::boolean then
      raise exception 'different close dates should block, got %', position;
    end if;
    update public.statement_imports
    set period_end = ref
    where household_id = house_a and bank_id = 'inter';
  end if;

  position := public.get_allocatable_cash_position(house_a);
  if (position->>'knownCashCents')::bigint <> 1577993 or (position->>'canAllocate')::boolean is not true then
    raise exception 'two current banks should be allocatable, got %', position;
  end if;
  if (position->>'knownCashCents')::bigint = 7000000 then
    raise exception 'planned income increased known cash';
  end if;

  update public.financial_settings set reserve_cents = 200000 where household_id = house_a;
  position := public.get_allocatable_cash_position(house_a);
  if (position->>'reservePolicyCents')::bigint <> 200000
     or (position->>'availableToOrganizeCents')::bigint <> 1377993 then
    raise exception 'reserve should reduce the limit, got %', position;
  end if;

  insert into public.financial_commitments (
    household_id, created_by, kind, name, amount_cents, due_day, starts_on
  ) values (
    house_a, user_a, 'fixed_bill', 'Aluguel', 300000, 5, month_start - 40
  ) returning id into bill_id;
  position := public.get_allocatable_cash_position(house_a);
  if (position->>'pendingDueCents')::bigint <> 300000
     or (position->>'availableToOrganizeCents')::bigint <> 1077993 then
    raise exception 'current-cycle pending should reduce the limit, got %', position;
  end if;

  open_cycle_key := position->>'cycleKey';
  insert into public.transactions (
    household_id, type, amount_cents, occurred_on, created_by
  ) values (
    house_a, 'expense', 300000, ref, user_a
  ) returning id into payment_tx;
  insert into public.financial_commitment_payments (
    household_id, commitment_id, cycle_key, paid_cents, transaction_id, created_by
  ) values (
    house_a, bill_id, open_cycle_key, 300000, payment_tx, user_a
  );
  position := public.get_allocatable_cash_position(house_a);
  if (position->>'pendingDueCents')::bigint <> 0
     or (position->>'availableToOrganizeCents')::bigint <> 1377993 then
    raise exception 'paid commitment should not be subtracted again, got %', position;
  end if;

  delete from public.financial_commitment_payments as payment
  where payment.commitment_id = bill_id;
  update public.transactions set amount_cents = 100000 where id = payment_tx;
  insert into public.financial_commitment_payments (
    household_id, commitment_id, cycle_key, paid_cents, transaction_id, created_by
  ) values (
    house_a, bill_id, open_cycle_key, 100000, payment_tx, user_a
  );
  position := public.get_allocatable_cash_position(house_a);
  if (position->>'pendingDueCents')::bigint <> 200000
     or (position->>'availableToOrganizeCents')::bigint <> 1177993 then
    raise exception 'partial payment should leave the remainder, got %', position;
  end if;

  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by
  ) values (
    house_a, goal_a, 1000, ref, user_a
  ) returning id into manual_contribution_id;
  select entry.source_kind into seen_source_kind
  from public.goal_contribution_entries entry
  where entry.id = manual_contribution_id;
  if seen_source_kind <> 'manual_unverified' then
    raise exception 'manual contribution should stay unverified, got %', seen_source_kind;
  end if;
  begin
    execute 'set local role authenticated';
    update public.goal_contribution_entries
    set amount_cents = 1500
    where id = manual_contribution_id;
    execute 'reset role';
  exception
    when others then
      execute 'reset role';
      raise;
  end;
  select entry.amount_cents into contribution_count
  from public.goal_contribution_entries entry
  where entry.id = manual_contribution_id;
  if contribution_count <> 1500 then
    raise exception 'legacy manual amount update should remain allowed, got %', contribution_count;
  end if;
  begin
    execute 'set local role authenticated';
    update public.goal_contribution_entries
    set source_kind = 'known_cash'
    where id = manual_contribution_id;
    execute 'reset role';
    raise exception 'relabel to known_cash was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:direct_insert_forbidden%' then
        raise;
      end if;
  end;
  begin
    execute 'set local role authenticated';
    update public.goal_contribution_entries
    set source_kind = 'cycle_surplus'
    where id = manual_contribution_id;
    execute 'reset role';
    raise exception 'relabel to cycle_surplus was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:cycle_surplus_requires_closure%'
         and sqlerrm not like '%known_cash:direct_cycle_surplus_forbidden%' then
        raise;
      end if;
  end;
  position := public.get_allocatable_cash_position(house_a);
  if not (position->'blockReasons' ? 'ambiguous_goal_contributions')
     or position->>'availableToOrganizeCents' is not null then
    raise exception 'ambiguous contribution should fail closed, got %', position;
  end if;
  begin
    perform public.allocate_known_cash_to_goal(house_a, goal_a, 100, '33333333-3333-3333-3333-333333333333');
    raise exception 'ambiguous allocation was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:ambiguous_goal_contributions%' then
        raise;
      end if;
  end;
  begin
    execute 'set local role authenticated';
    delete from public.goal_contribution_entries where id = manual_contribution_id;
    execute 'reset role';
  exception
    when others then
      execute 'reset role';
      raise;
  end;
  if exists (
    select 1 from public.goal_contribution_entries where id = manual_contribution_id
  ) then
    raise exception 'legacy manual delete should remain allowed';
  end if;

  insert into public.cycle_closures (
    household_id, cycle_key, mode, cycle_start, cycle_end, net_cents, allocated_cents, updated_by
  ) values (
    house_a, open_cycle_key, 'month', month_start, (month_start + interval '1 month')::date,
    0, 100000, user_a
  ) returning id into closure_id;
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by, cycle_key, cycle_closure_id
  ) values (
    house_a, goal_a, 100000, ref, user_a, open_cycle_key, closure_id
  ) returning id into surplus_contribution_id;
  select entry.source_kind into seen_source_kind
  from public.goal_contribution_entries entry
  where entry.id = surplus_contribution_id;
  if seen_source_kind <> 'cycle_surplus' then
    raise exception 'closure-backed contribution should be cycle surplus, got %', seen_source_kind;
  end if;
  begin
    execute 'set local role authenticated';
    insert into public.goal_contribution_entries (
      household_id, goal_id, amount_cents, contributed_on, created_by,
      cycle_key, cycle_closure_id, source_kind
    ) values (
      house_a, goal_a, 100, ref, user_a, open_cycle_key, closure_id, 'cycle_surplus'
    );
    execute 'reset role';
    raise exception 'direct cycle_surplus insert was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:direct_cycle_surplus_forbidden%' then
        raise;
      end if;
  end;
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by
  ) values (
    house_a, goal_a, 1000, ref, user_a
  ) returning id into manual_contribution_id;
  begin
    execute 'set local role authenticated';
    update public.goal_contribution_entries
    set source_kind = 'cycle_surplus', cycle_key = open_cycle_key, cycle_closure_id = closure_id
    where id = manual_contribution_id;
    execute 'reset role';
    raise exception 'relabel through a closure was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:direct_cycle_surplus_forbidden%' then
        raise;
      end if;
  end;
  delete from public.goal_contribution_entries where id = manual_contribution_id;
  position := public.get_allocatable_cash_position(house_a);
  if (position->>'earmarkedCents')::bigint <> 100000
     or (position->>'availableToOrganizeCents')::bigint <> 1077993 then
    raise exception 'cycle surplus should count as an earmark, got %', position;
  end if;

  known_cash := (position->>'knownCashCents')::bigint;
  available := (position->>'availableToOrganizeCents')::bigint;
  if known_cash + 7000000 = available then
    raise exception 'planned income changed the allocatable amount';
  end if;

  begin
    perform public.allocate_known_cash_to_goal(house_a, goal_a, available + 1, '44444444-4444-4444-4444-444444444444');
    raise exception 'amount above available was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:insufficient_available_cash%' then
        raise;
      end if;
  end;
  begin
    perform public.allocate_known_cash_to_goal(house_a, goal_small, 60000, '55555555-5555-5555-5555-555555555555');
    raise exception 'amount above the goal remainder was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:amount_exceeds_goal_remaining%' then
        raise;
      end if;
  end;
  select count(*) into contribution_count
  from public.goal_contribution_entries
  where household_id = house_a and source_kind = 'known_cash';
  if contribution_count <> 0 then
    raise exception 'rejected allocations created a contribution';
  end if;

  select count(*) into transaction_before from public.transactions where household_id = house_a;
  allocation := public.allocate_known_cash_to_goal(
    house_a, goal_a, 200000, '66666666-6666-6666-6666-666666666666'
  );
  known_contribution_id := (allocation->>'contributionId')::uuid;
  select count(*) into transaction_after from public.transactions where household_id = house_a;
  select count(*) into contribution_count
  from public.goal_contribution_entries
  where household_id = house_a and source_kind = 'known_cash';
  if contribution_count <> 1 or transaction_after <> transaction_before then
    raise exception 'allocation should create one earmark and no transaction';
  end if;
  if allocation->>'sourceKind' <> 'known_cash'
     or (allocation->>'availableBeforeCents')::bigint <> available
     or (allocation->>'availableAfterCents')::bigint <> available - 200000
     or (allocation->>'idempotentReplay')::boolean then
    raise exception 'allocation result mismatch: %', allocation;
  end if;

  replay := public.allocate_known_cash_to_goal(
    house_a, goal_a, 200000, '66666666-6666-6666-6666-666666666666'
  );
  select count(*) into contribution_count
  from public.goal_contribution_entries
  where household_id = house_a and source_kind = 'known_cash';
  if contribution_count <> 1 or (replay->>'idempotentReplay')::boolean is not true then
    raise exception 'repeated request should replay, got %', replay;
  end if;
  begin
    perform public.allocate_known_cash_to_goal(
      house_a, goal_a, 100, '66666666-6666-6666-6666-666666666666'
    );
    raise exception 'conflicting request id was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:request_conflict%' then
        raise;
      end if;
  end;

  select count(*) into request_count
  from public.known_cash_allocation_requests request
  where request.household_id = house_a
    and request.request_id = '66666666-6666-6666-6666-666666666666';
  if request_count <> 1 then
    raise exception 'allocation should keep one idempotency row, got %', request_count;
  end if;
  begin
    execute 'set local role authenticated';
    update public.goal_contribution_entries
    set amount_cents = amount_cents + 1
    where id = known_contribution_id;
    execute 'reset role';
    raise exception 'known_cash amount update was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:trusted_earmark_locked%' then
        raise;
      end if;
  end;
  begin
    execute 'set local role authenticated';
    update public.goal_contribution_entries
    set amount_cents = amount_cents + 1
    where id = surplus_contribution_id;
    execute 'reset role';
    raise exception 'cycle_surplus amount update was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:trusted_earmark_locked%' then
        raise;
      end if;
  end;
  begin
    execute 'set local role authenticated';
    delete from public.goal_contribution_entries where id = known_contribution_id;
    execute 'reset role';
    raise exception 'known_cash delete was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:trusted_earmark_delete_forbidden%' then
        raise;
      end if;
  end;
  begin
    execute 'set local role authenticated';
    delete from public.goal_contribution_entries where id = surplus_contribution_id;
    execute 'reset role';
    raise exception 'cycle_surplus delete was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:trusted_earmark_delete_forbidden%' then
        raise;
      end if;
  end;
  if not exists (
    select 1 from public.goal_contribution_entries where id = known_contribution_id
  ) or not exists (
    select 1 from public.goal_contribution_entries where id = surplus_contribution_id
  ) then
    raise exception 'a trusted earmark disappeared';
  end if;
  begin
    delete from public.goal_contribution_entries where id = known_contribution_id;
    raise exception 'ledger-backed earmark delete was allowed';
  exception
    when foreign_key_violation then
      null;
  end;
  select count(*) into request_count
  from public.known_cash_allocation_requests request
  where request.household_id = house_a
    and request.request_id = '66666666-6666-6666-6666-666666666666';
  if request_count <> 1 or not exists (
    select 1 from public.goal_contribution_entries where id = known_contribution_id
  ) then
    raise exception 'the idempotency ledger or its earmark disappeared';
  end if;

  begin
    perform public.allocate_known_cash_to_goal(
      house_a, goal_a, available, '77777777-7777-7777-7777-777777777777'
    );
    raise exception 'second allocation reused the original available amount';
  exception
    when others then
      if sqlerrm not like '%known_cash:insufficient_available_cash%' then
        raise;
      end if;
  end;

  perform public.allocate_known_cash_to_goal(
    house_a, goal_small, 50000, '88888888-8888-8888-8888-888888888888'
  );
  begin
    perform public.allocate_known_cash_to_goal(
      house_a, goal_small, 1, '99999999-9999-9999-9999-999999999999'
    );
    raise exception 'completed goal accepted another allocation';
  exception
    when others then
      if sqlerrm not like '%known_cash:goal_completed%' then
        raise;
      end if;
  end;

  begin
    perform public.allocate_known_cash_to_goal(
      house_b, goal_b, 100, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );
    raise exception 'another household was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:unauthorized%' then
        raise;
      end if;
  end;
  begin
    perform public.allocate_known_cash_to_goal(
      house_a, goal_b, 100, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
    );
    raise exception 'another household goal was accepted';
  exception
    when others then
      if sqlerrm not like '%known_cash:goal_not_found%' then
        raise;
      end if;
  end;

  begin
    execute 'set local role authenticated';
    insert into public.goal_contribution_entries (
      household_id, goal_id, amount_cents, contributed_on, created_by, source_kind
    ) values (
      house_a, goal_a, 100, ref, user_a, 'known_cash'
    );
    execute 'reset role';
    raise exception 'direct known_cash insert was allowed';
  exception
    when others then
      execute 'reset role';
      if sqlerrm not like '%known_cash:direct_insert_forbidden%'
         and sqlerrm not like '%direct known_cash insert was allowed%' then
        raise;
      end if;
      if sqlerrm like '%direct known_cash insert was allowed%' then
        raise;
      end if;
  end;

  update public.financial_settings set reserve_cents = 0 where household_id = house_a;
  delete from public.financial_commitment_payments where household_id = house_a;
  delete from public.financial_commitments where household_id = house_a;
  insert into public.transactions (
    household_id, type, amount_cents, occurred_on, created_by
  ) values (
    house_a, 'income', 500000, ref, user_a
  );
  perform public.allocate_cycle_surplus(
    house_a,
    goal_a,
    'calendar:' || to_char(month_start, 'YYYY-MM'),
    month_start,
    (month_start + interval '1 month')::date,
    10000,
    ref,
    null
  );
  select entry.source_kind into seen_source_kind
  from public.goal_contribution_entries entry
  where entry.household_id = house_a
    and entry.amount_cents = 10000
  order by entry.created_at desc
  limit 1;
  if seen_source_kind <> 'cycle_surplus' then
    raise exception 'allocate_cycle_surplus should keep writing cycle surplus, got %', seen_source_kind;
  end if;

  delete from auth.users where id in (user_a, user_b);
end;
$$;
