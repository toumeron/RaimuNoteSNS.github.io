// Legacy filename retained. Configures event delivery; never schedules jobs or publishes GitHub Pages.
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
const projectRef=(await readFile('supabase/.temp/project-ref','utf8')).trim();
if(!/^[a-z0-9]{20}$/.test(projectRef))throw new Error('Invalid linked project reference');
if(!process.argv.includes('--apply')){
 console.log('No changes made. Run with --apply only to configure backend secrets and remove legacy notification schedules. No periodic job is installed.');process.exit(0);
}
const directory=await mkdtemp(join(tmpdir(),'lime-notification-cron-'));
function run(args){const result=spawnSync('supabase',args,{encoding:'utf8'});if(result.status!==0)throw new Error(`Supabase ${args[0]} failed; secret-bearing command output suppressed`);}
try{
 const secret=randomBytes(32).toString('hex');
 const pushSecret=randomBytes(32).toString('hex');
 const envPath=join(directory,'secret.env');await writeFile(envPath,`EXTERNAL_NOTIFICATIONS_CRON_SECRET=${secret}\nPUSH_WEBHOOK_SECRET=${pushSecret}\n`,{mode:0o600});
 run(['secrets','set','--project-ref',projectRef,'--env-file',envPath]);
 const sql=`begin;
 do $$ declare secret_id uuid; begin
 select id into secret_id from vault.secrets where name='external_notifications_cron_secret';
 if secret_id is null then perform vault.create_secret('${secret}','external_notifications_cron_secret');
 else perform vault.update_secret(secret_id,'${secret}');end if;
 end $$;
 do $$ declare secret_id uuid; spec record;begin
 for spec in select * from (values ('notification_push_webhook_secret','${pushSecret}'),('notification_function_url','https://${projectRef}.supabase.co/functions/v1/send-push')) as settings(name,value) loop
 select id into secret_id from vault.secrets where name=spec.name;
 if secret_id is null then perform vault.create_secret(spec.value,spec.name);else perform vault.update_secret(secret_id,spec.value);end if;end loop;end $$;
 select cron.unschedule(jobid) from cron.job where jobname in ('lime-notification-expiry','lime-external-post-notifications');
 commit;`;
 const sqlPath=join(directory,'install.sql');await writeFile(sqlPath,sql,{mode:0o600});run(['db','query','--linked','--file',sqlPath]);
 console.log('Backend event-delivery secrets configured. Legacy notification schedules removed; no polling job installed.');
}finally{await rm(directory,{recursive:true,force:true});}
