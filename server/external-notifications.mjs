// Node 24+, run on one permanent server; no polling or scheduled job.
import {createClient} from '@supabase/supabase-js';
import {startExternalNotificationListener} from './external-notification-listener.mjs';
const root=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!root||!key)throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set on the server');
const db=createClient(root,key,{auth:{persistSession:false,autoRefreshToken:false}});
const stop=await startExternalNotificationListener({db});
process.on('SIGTERM',()=>void stop().then(()=>process.exit(0)));
process.on('SIGINT',()=>void stop().then(()=>process.exit(0)));
