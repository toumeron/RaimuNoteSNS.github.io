import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from release_check import require_release


class ReleaseTests(unittest.TestCase):
    def test_failing_or_unreviewed_candidate_cannot_start_production(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            for ready,review in [(False,True),(True,True),(False,False),('true',False)]:
                (root/'model-validation.json').write_text(json.dumps({'production_ready':ready,'review_required':review}))
                with self.assertRaises(ValueError):require_release(root)

    def test_only_the_reviewed_adapter_can_be_deployed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            adapter=root/'adapters/limeai-flash/adapters.safetensors'
            adapter.parent.mkdir(parents=True)
            adapter.write_bytes(b'unit test fixture, not model weights')
            (root/'model-validation.json').write_text(json.dumps({
                'production_ready':True,'review_required':False,
                'adapter_sha256':hashlib.sha256(adapter.read_bytes()).hexdigest()}))
            require_release(root)
            adapter.write_bytes(b'a different fixture')
            with self.assertRaises(ValueError):require_release(root)


if __name__=='__main__':unittest.main()
