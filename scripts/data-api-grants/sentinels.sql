-- Run only in the disposable database, inside a rolled-back transaction.
create table public.grants_unexposed_sentinel(id bigint);
create sequence public.grants_unexposed_sentinel_seq;
do $$
begin
  if exists (
    select 1
    from unnest(array['anon','authenticated','service_role']) r(role)
    cross join (values
      ('public.grants_unexposed_sentinel', 'r'::"char"),
      ('public.grants_unexposed_sentinel_seq', 's'::"char")
    ) o(name, kind)
    cross join lateral aclexplode(acldefault(o.kind, 'postgres'::regrole)) p
    where case when o.kind = 's'
      then has_sequence_privilege(r.role, o.name, p.privilege_type)
      else has_table_privilege(r.role, o.name, p.privilege_type)
    end
  ) then
    raise exception 'Unexpected default access on an ungranted sentinel';
  end if;
end;
$$;
