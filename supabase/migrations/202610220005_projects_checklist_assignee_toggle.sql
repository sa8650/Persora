-- Projects: let assigned people check off checklist items from the field view.
--
-- * The project owner and the field creator keep full control over checklist
--   items (title, assignee, completion), exactly as before.
-- * The field's assignee and a checklist item's own assignee may now change
--   ONLY the `completed` flag. Adding, deleting, renaming, re-assigning and
--   reordering items is still limited to the owner and field creator.
-- * After every subtask update the field's stored progress is recomputed from
--   its checklist (completed / total × 100, 0 when empty) so the saved value
--   matches what the Projects UI derives (fields marked Completed keep the
--   existing 100% rule from persora__project_field_apply).
--
-- Safe to re-run: the function is replaced in place and existing grants are
-- restated explicitly.

create or replace function public.persora_project_subtask_update(p_user uuid, p_subtask uuid, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_task public.project_subtasks;
  v_field public.project_fields;
  v_access record;
  v_assignee uuid;
  v_total integer;
  v_done integer;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Enter valid subtask details.' using errcode = 'P0400';
  end if;
  select * into v_task from public.project_subtasks t where t.id = p_subtask for update;
  if not found then raise exception 'That subtask is not available.' using errcode = 'P0404'; end if;
  select * into v_field from public.project_fields f where f.id = v_task.field_id;
  if not found then raise exception 'That field is not available.' using errcode = 'P0404'; end if;
  -- Raises P0404 for anyone who is not the owner or a member of the project.
  select * into v_access from public.persora__project_access(p_user, v_field.project_id);

  if not (v_access.is_owner or v_field.creator_id = p_user) then
    if not (p_payload ? 'completed') or (p_payload - 'completed') <> '{}'::jsonb then
      raise exception 'Only the project owner or the member who created this field can change its subtasks or attachments.' using errcode = 'P0403';
    end if;
    if not (v_field.assignee_id is not distinct from p_user or v_task.assignee_id is not distinct from p_user) then
      raise exception 'Only the people assigned to this field or checklist item can check it off.' using errcode = 'P0403';
    end if;
  end if;

  if p_payload ? 'title' then
    if char_length(trim(coalesce(p_payload->>'title', ''))) not between 1 and 240 then raise exception 'Enter a subtask between 1 and 240 characters.' using errcode = 'P0400'; end if;
    v_task.title := trim(p_payload->>'title');
  end if;
  if p_payload ? 'assignee_id' then
    v_assignee := nullif(p_payload->>'assignee_id', '')::uuid;
    perform public.persora__project_validate_assignee(v_task.project_id, v_assignee);
    v_task.assignee_id := v_assignee;
  end if;
  if p_payload ? 'completed' then
    if p_payload->>'completed' not in ('true', 'false') then raise exception 'Choose a valid subtask status.' using errcode = 'P0400'; end if;
    v_task.completed := (p_payload->>'completed')::boolean;
  end if;

  update public.project_subtasks set title = v_task.title, assignee_id = v_task.assignee_id, completed = v_task.completed, updated_at = now(), updated_by = p_user
  where id = p_subtask returning * into v_task;

  select count(*), count(*) filter (where t.completed) into v_total, v_done
  from public.project_subtasks t where t.field_id = v_task.field_id;
  update public.project_fields
  set progress = case when v_field.status = 'completed' then 100 when v_total = 0 then 0 else round(v_done * 100.0 / v_total)::integer end,
      updated_at = now(), updated_by = p_user
  where id = v_task.field_id;
  return to_jsonb(v_task);
end;
$function$;

revoke all on function public.persora_project_subtask_update(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.persora_project_subtask_update(uuid, uuid, jsonb) to service_role;
