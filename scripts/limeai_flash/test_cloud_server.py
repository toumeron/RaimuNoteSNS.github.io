import json
import threading
import unittest
import urllib.request
import urllib.error
from flash_cloud_server import Jobs,conversation,server_for

ID='a21ffbc0-785d-4589-8815-3b24313ed434'
CONTENTS=[{'role':'user','parts':[{'text':'【システム命令: 日本語で短く。】'}]},
          {'role':'user','parts':[{'text':'挨拶して'}]}]

class CloudTests(unittest.TestCase):
    def test_conversation_preserves_complete_instructions(self):
        history,instructions=conversation(CONTENTS)
        self.assertEqual(history,[{'role':'user','content':'挨拶して'}])
        self.assertIn('日本語で短く',instructions)

    def test_rejects_nontext_and_assistant_final_turn(self):
        for contents in [[{'role':'user','parts':[{'inlineData':'not allowed'}]}],
                         [{'role':'model','parts':[{'text':'答え'}]}]]:
            with self.assertRaises(ValueError):conversation(contents)

    def test_result_is_never_replaced_by_late_cancelled_generation(self):
        entered=threading.Event();finish=threading.Event()
        def infer(*_):entered.set();finish.wait(2);return '遅れて届いた答え'
        jobs=Jobs(infer)
        jobs.submit(ID,CONTENTS);self.assertTrue(entered.wait(2))
        jobs.status(ID,cancel=True);finish.set();jobs.queue.join()
        self.assertEqual(jobs.status(ID),{'status':'cancelled'})
        self.assertNotIn('instructions',jobs.rows[ID]);self.assertNotIn('history',jobs.rows[ID])

    def test_expired_job_is_unreadable(self):
        now=[1000.0];jobs=Jobs(lambda *_:'答え',clock=lambda:now[0])
        jobs.submit(ID,CONTENTS);jobs.queue.join();now[0]+=901
        with self.assertRaises(KeyError):jobs.status(ID)

    def test_queue_is_bounded_and_duplicate_submission_is_idempotent(self):
        entered=threading.Event();finish=threading.Event()
        def infer(*_):entered.set();finish.wait(2);return '答え'
        jobs=Jobs(infer,capacity=1);jobs.submit(ID,CONTENTS);self.assertTrue(entered.wait(2))
        self.assertEqual(jobs.submit(ID,CONTENTS),{'status':'running'})
        with self.assertRaises(OverflowError):jobs.submit('e3ecb3b9-6e54-464e-8d68-fdb668032ba4',CONTENTS)
        finish.set();jobs.queue.join()

    def test_http_authentication_and_actual_async_delivery(self):
        jobs=Jobs(lambda *_:'こんにちは。');key='local-unit-test-credential-not-for-deployment'
        server=server_for(jobs,key,('127.0.0.1',0));thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                urllib.request.urlopen(url+'/v1/jobs/'+ID)
            self.assertEqual(error.exception.code,401)
            request=urllib.request.Request(url+'/v1/jobs',data=json.dumps({'id':ID,'contents':CONTENTS}).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
            with urllib.request.urlopen(request) as response:self.assertEqual(response.status,202)
            jobs.queue.join()
            with urllib.request.urlopen(urllib.request.Request(url+'/v1/jobs/'+ID,headers={'Authorization':'Bearer '+key})) as response:
                self.assertEqual(json.load(response),{'status':'done','answer':'こんにちは。'})
        finally:server.shutdown();server.server_close();thread.join(2)

if __name__=='__main__':unittest.main()
