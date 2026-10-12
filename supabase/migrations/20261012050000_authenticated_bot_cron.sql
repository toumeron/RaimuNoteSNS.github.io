begin;
-- Hosted pg_net grants are owned by supabase_admin and cannot be revoked
-- by postgres. Keep net outside the Data API exposed schemas; Vault does not
-- hide decrypted request headers from trusted direct-database login roles.
-- Configure only the existing Bot job, preserving its timing and active state.
-- Provision the same dedicated secret in Vault and Edge Secrets beforehand.
do $$
declare bot_job record; endpoint text;
begin
 select jobid,command into bot_job from cron.job where jobname='bot-auto-post-v2';
 if bot_job.jobid is null then return;end if;
 if (select count(*) from vault.secrets where name='bot_cron_secret')<>1 then
  raise exception 'Provision the dedicated Bot cron secret before updating the existing job';
 end if;
 endpoint:=substring(bot_job.command from 'https://[a-z0-9]+\.supabase\.co/functions/v1/post-bot');
 if endpoint is null then raise exception 'Unexpected existing Bot endpoint';end if;
 perform cron.alter_job(bot_job.jobid,command:=format($job$
 select net.http_post(
  url:=%L,
  body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','x-bot-secret',
   (select decrypted_secret from vault.decrypted_secrets where name='bot_cron_secret')),
  timeout_milliseconds:=30000
 );
 $job$,endpoint));
end$$;
commit;
