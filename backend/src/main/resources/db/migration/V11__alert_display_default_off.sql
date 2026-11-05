-- 仅纠正系统默认种子（未人工改过的），改为默认不报警；管理员已保存的开关不动
UPDATE cfg_alert_display
SET payload = jsonb_set(COALESCE(payload, '{}'::jsonb), '{enabled}', 'false'::jsonb, true),
    updated_at = NOW(),
    updated_by = 'system-default-off'
WHERE id = 1
  AND (updated_by IS NULL OR updated_by LIKE 'system%')
  AND (payload IS NULL OR COALESCE((payload->>'enabled')::boolean, true) = true);
