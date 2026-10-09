-- Local smoke for manual contribution reconciliation.
-- Does not touch a remote project.

do $$
declare
  user_a uuid := '4c3c0001-0001-4001-8001-0000000000c1';
  user_b uuid := '4c3c0002-0002-4002-8002-0000000000c2';
  house_a uuid;
  house_b uuid;
  goal_a uuid;
  goal_b uuid;
  ref date;
  month_start date;
  cycle_end date;
  open_cycle_key text;
  manual_full uuid;
  manual_partial uuid;
  manual_reversed uuid;
  manual_other uuid;
  known_id uuid;
  surplus_id uuid;
  closure_id uuid;
  position jsonb;
  review jsonb;
  outside jsonb;
  progress bigint;
  original_amount bigint;
  effective_amount bigint;
  seen_kind text;
  tx_before integer;
  tx_after integer;
  review_count integer;
begin
  delete from auth.users where id in (user_a, user_b);
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token
  ) values
    ('00000000-0000-0000-0000-000000000000', user_a, 'authenticated', 'authenticated',
     '4c3c-a@example.invalid', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), ''),
    ('00000000-0000-0000-0000-000000000000', user_b, 'authenticated', 'authenticated',
     '4c3c-b@example.invalid', crypt('password', gen_salt('bf')), now(),
     '{"provider":"email","providers":["email"]}', '{}', now(), now(), '');

  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  house_a := public.create_household('4C3C Casa A', 'individual');
  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  house_b := public.create_household('4C3C Casa B', 'individual');
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);

  insert into public.goals (household_id, title, target_cents, desired_date, created_by)
  values (house_a, '4C3C Sonho', 1000000, null, user_a)
  returning id into goal_a;
  insert into public.goals (household_id, title, target_cents, desired_date, created_by)
  values (house_b, '4C3C Outra', 1000000, null, user_b)
  returning id into goal_b;
  insert into public.financial_settings (household_id, cycle_mode, reserve_cents, updated_by)
  values (house_a, 'calendar', 0, user_a);

  ref := public.known_cash_reference_date();
  month_start := date_trunc('month', ref)::date;
  cycle_end := (month_start + interval '1 month')::date;
  open_cycle_key := 'calendar:' || to_char(month_start, 'YYYY-MM');
  insert into public.statement_imports (
    household_id, created_by, file_hash, file_name, bank_id, transaction_count,
    final_balance_cents, balance_confidence, period_start, period_end
  ) values (
    house_a, user_a, encode(digest('4c3c-valid', 'sha256'), 'hex'), '4c3c-valid.csv', 'inter', 1,
    2000000, 'confirmed', month_start, ref
  );

  execute 'set local role authenticated';
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by
  ) values (house_a, goal_a, 500000, ref, user_a)
  returning id into manual_full;
  execute 'reset role';

  select entry.amount_cents, entry.effective_amount_cents, entry.source_kind
  into original_amount, effective_amount, seen_kind
  from public.goal_contribution_entries entry
  where entry.id = manual_full;
  progress := public.goal_progress_cents(house_a, goal_a);
  if original_amount <> 500000 or effective_amount is not null or seen_kind <> 'manual_unverified' or progress <> 500000 then
    raise exception '1 manual progress before review failed: % % % %', original_amount, effective_amount, seen_kind, progress;
  end if;

  position := public.get_allocatable_cash_position(house_a);
  if not (position->'blockReasons' ? 'ambiguous_goal_contributions') or (position->>'canAllocate')::boolean then
    raise exception '22 blocker missing before review: %', position->'blockReasons';
  end if;

  begin
    perform public.reconcile_manual_contribution(house_a, manual_full, 'still_in_accounts', 500001, '4c3c1001-0001-4001-8001-0000000000c1');
    raise exception '7 over-original was accepted';
  exception when others then
    if sqlerrm not like '%goal_contribution:amount_exceeds_original%' then raise; end if;
  end;

  review := public.reconcile_manual_contribution(house_a, manual_full, 'still_in_accounts', 300000, '4c3c1001-0001-4001-8001-0000000000c1');
  select entry.amount_cents, entry.effective_amount_cents, entry.source_kind
  into original_amount, effective_amount, seen_kind
  from public.goal_contribution_entries entry where entry.id = manual_full;
  progress := public.goal_progress_cents(house_a, goal_a);
  position := public.get_allocatable_cash_position(house_a);
  if seen_kind <> 'account_reserved' or original_amount <> 500000 or effective_amount <> 300000 or progress <> 300000 then
    raise exception '2/3/5/15 partial reserve failed';
  end if;
  if (position->>'canAllocate')::boolean is not true
     or (position->>'earmarkedCents')::bigint <> 300000
     or (position->>'availableToOrganizeCents')::bigint <> 1700000 then
    raise exception '4 full reserve did not reduce available: %', position;
  end if;

  review := public.reconcile_manual_contribution(house_a, manual_full, 'still_in_accounts', 300000, '4c3c1001-0001-4001-8001-0000000000c1');
  select count(*) into review_count from public.goal_contribution_reconciliations where contribution_id = manual_full;
  if (review->>'idempotentReplay')::boolean is not true or review_count <> 1 then
    raise exception '16 replay failed';
  end if;
  begin
    perform public.reconcile_manual_contribution(house_a, manual_full, 'still_in_accounts', 400000, '4c3c1001-0001-4001-8001-0000000000c1');
    raise exception '17 conflict was accepted';
  exception when others then
    if sqlerrm not like '%goal_contribution:request_conflict%' then raise; end if;
  end;
  begin
    perform public.reconcile_manual_contribution(house_a, manual_full, 'no_longer_saved', null, '4c3c1002-0002-4002-8002-0000000000c1');
    raise exception '18 second decision was accepted';
  exception when others then
    if sqlerrm not like '%goal_contribution:already_reconciled%' then raise; end if;
  end;

  execute 'set local role authenticated';
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by
  ) values (house_a, goal_a, 200000, ref, user_a)
  returning id into manual_partial;
  execute 'reset role';
  position := public.get_allocatable_cash_position(house_a);
  if not (position->'blockReasons' ? 'ambiguous_goal_contributions') then
    raise exception '22 blocker disappeared while a manual row remained';
  end if;
  review := public.reconcile_manual_contribution(house_a, manual_partial, 'saved_outside', 150000, '4c3c1003-0003-4003-8003-0000000000c1');
  select entry.amount_cents, entry.effective_amount_cents, entry.source_kind
  into original_amount, effective_amount, seen_kind
  from public.goal_contribution_entries entry where entry.id = manual_partial;
  progress := public.goal_progress_cents(house_a, goal_a);
  position := public.get_allocatable_cash_position(house_a);
  if seen_kind <> 'saved_outside' or original_amount <> 200000 or effective_amount <> 150000 or progress <> 450000 then
    raise exception '8/9/11 outside partial failed: % % %', seen_kind, progress, effective_amount;
  end if;
  if (position->>'earmarkedCents')::bigint <> 300000
     or (position->>'availableToOrganizeCents')::bigint <> 1700000
     or (position->>'canAllocate')::boolean is not true then
    raise exception '10/23 outside changed available or left the blocker: %', position;
  end if;

  execute 'set local role authenticated';
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by
  ) values (house_a, goal_a, 100000, ref, user_a)
  returning id into manual_reversed;
  execute 'reset role';
  begin
    perform public.reconcile_manual_contribution(house_a, manual_reversed, 'no_longer_saved', 100000, '4c3c1004-0004-4004-8004-0000000000c1');
    raise exception 'positive reverse was accepted';
  exception when others then
    if sqlerrm not like '%goal_contribution:invalid_amount%' then raise; end if;
  end;
  review := public.reconcile_manual_contribution(house_a, manual_reversed, 'no_longer_saved', null, '4c3c1004-0004-4004-8004-0000000000c1');
  select entry.amount_cents, entry.effective_amount_cents, entry.source_kind
  into original_amount, effective_amount, seen_kind
  from public.goal_contribution_entries entry where entry.id = manual_reversed;
  progress := public.goal_progress_cents(house_a, goal_a);
  position := public.get_allocatable_cash_position(house_a);
  if seen_kind <> 'reversed' or original_amount <> 100000 or effective_amount is not null or progress <> 450000 then
    raise exception '12/13/15 reverse failed';
  end if;
  if (position->>'availableToOrganizeCents')::bigint <> 1700000
     or (position->'blockReasons' ? 'ambiguous_goal_contributions') then
    raise exception '14/23 reverse changed cash or left a blocker: %', position;
  end if;
  if (review->>'goalRemainingCents')::bigint <> 550000 then
    raise exception '24 remaining ignored the effective amount: %', review->>'goalRemainingCents';
  end if;

  perform set_config('request.jwt.claim.sub', user_b::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by
  ) values (house_b, goal_b, 100000, ref, user_b)
  returning id into manual_other;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', user_a::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', user_a, 'role', 'authenticated')::text, true);
  begin
    perform public.reconcile_manual_contribution(house_a, manual_other, 'saved_outside', 100000, '4c3c1005-0005-4005-8005-0000000000c1');
    raise exception '19 other household was accepted';
  exception when others then
    if sqlerrm not like '%goal_contribution:not_found%' then raise; end if;
  end;

  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by, source_kind
  ) values (house_a, goal_a, 10000, ref, user_a, 'known_cash')
  returning id into known_id;
  begin
    perform public.reconcile_manual_contribution(house_a, known_id, 'still_in_accounts', 10000, '4c3c1006-0006-4006-8006-0000000000c1');
    raise exception '20 known cash reconcile was accepted';
  exception when others then
    if sqlerrm not like '%goal_contribution:not_manual%' then raise; end if;
  end;

  insert into public.cycle_closures (
    household_id, cycle_key, mode, cycle_start, cycle_end, net_cents, allocated_cents, updated_by
  ) values (house_a, open_cycle_key, 'month', month_start, cycle_end, 0, 0, user_a)
  returning id into closure_id;
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by, cycle_key, cycle_closure_id, source_kind
  ) values (house_a, goal_a, 10000, ref, user_a, open_cycle_key, closure_id, 'cycle_surplus')
  returning id into surplus_id;
  begin
    perform public.reconcile_manual_contribution(house_a, surplus_id, 'still_in_accounts', 10000, '4c3c1007-0007-4007-8007-0000000000c1');
    raise exception '21 cycle surplus reconcile was accepted';
  exception when others then
    if sqlerrm not like '%goal_contribution:not_manual%' then raise; end if;
  end;

  begin
    perform public.allocate_cycle_surplus(house_a, goal_a, open_cycle_key, month_start, cycle_end, 300000, ref, null);
    raise exception '26 cycle surplus unexpectedly succeeded';
  exception when others then
    if sqlerrm like '%falta para concluir%' then
      raise exception '26 cycle surplus used the raw amount';
    end if;
    if sqlerrm not like '%sobra segura%' then raise; end if;
  end;

  perform public.allocate_known_cash_to_goal(house_a, goal_a, 300000, '4c3c1008-0008-4008-8008-0000000000c1');
  progress := public.goal_progress_cents(house_a, goal_a);
  if progress <> 770000 then
    raise exception '25 known cash ignored effective progress: %', progress;
  end if;

  select count(*) into tx_before from public.transactions where household_id = house_a;
  outside := public.add_saved_outside_goal_contribution(house_a, goal_a, 20000, ref, null, '4c3c1009-0009-4009-8009-0000000000c1');
  select count(*) into tx_after from public.transactions where household_id = house_a;
  progress := public.goal_progress_cents(house_a, goal_a);
  position := public.get_allocatable_cash_position(house_a);
  if tx_after <> tx_before or progress <> 790000 or outside->>'sourceKind' <> 'saved_outside' then
    raise exception '27/28 direct outside savings failed';
  end if;
  if (position->>'availableToOrganizeCents')::bigint <> 1380000 then
    raise exception '28 outside savings changed available: %', position->>'availableToOrganizeCents';
  end if;
  outside := public.add_saved_outside_goal_contribution(house_a, goal_a, 20000, ref, null, '4c3c1009-0009-4009-8009-0000000000c1');
  select count(*) into review_count from public.goal_contribution_entries where household_id = house_a and source_kind = 'saved_outside';
  if (outside->>'idempotentReplay')::boolean is not true or review_count <> 2 then
    raise exception '29 outside replay failed: %', review_count;
  end if;

  execute 'set local role authenticated';
  begin
    update public.goal_contribution_entries set amount_cents = amount_cents - 1 where id = manual_full;
    execute 'reset role';
    raise exception '30 reserved update was allowed';
  exception when others then
    execute 'reset role';
    if sqlerrm not like '%goal_contribution:reconciled_locked%' then raise; end if;
  end;
  begin
    execute 'set local role authenticated';
    delete from public.goal_contribution_entries where id = manual_partial;
    execute 'reset role';
    raise exception '30 outside delete was allowed';
  exception when others then
    execute 'reset role';
    if sqlerrm not like '%goal_contribution:reconciled_delete_forbidden%' then raise; end if;
  end;
  begin
    execute 'set local role authenticated';
    insert into public.goal_contribution_entries (
      household_id, goal_id, amount_cents, contributed_on, created_by, source_kind, effective_amount_cents
    ) values (house_a, goal_a, 1000, ref, user_a, 'saved_outside', 1000);
    execute 'reset role';
    raise exception '30 direct outside insert was allowed';
  exception when others then
    execute 'reset role';
    if sqlerrm not like '%goal_contribution:direct_kind_forbidden%' then raise; end if;
  end;
  execute 'set local role authenticated';
  insert into public.goal_contribution_entries (
    household_id, goal_id, amount_cents, contributed_on, created_by
  ) values (house_a, goal_a, 1000, ref, user_a)
  returning id into manual_other;
  begin
    update public.goal_contribution_entries set amount_cents = 500 where id = manual_other;
    execute 'reset role';
    raise exception '30 manual update was allowed';
  exception when others then
    execute 'reset role';
    if sqlerrm not like '%goal_contribution:manual_locked%' then raise; end if;
  end;
  begin
    execute 'set local role authenticated';
    delete from public.goal_contribution_entries where id = manual_other;
    execute 'reset role';
    raise exception '30 manual delete was allowed';
  exception when others then
    execute 'reset role';
    if sqlerrm not like '%goal_contribution:manual_delete_forbidden%' then raise; end if;
  end;

  delete from auth.users where id in (user_a, user_b);
end $$;
