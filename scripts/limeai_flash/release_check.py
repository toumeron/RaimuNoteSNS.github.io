"""Keep a known failing development adapter out of the production server."""
import hashlib
import json
from pathlib import Path


def require_release(root=None):
    root=Path(root) if root is not None else Path(__file__).resolve().parent
    metadata=json.loads((root/'model-validation.json').read_text())
    if metadata.get('production_ready') is not True or metadata.get('review_required') is not False:
        raise ValueError('LimeAI-Flash is a development candidate. Complete remote evaluation and review before deployment.')
    adapter=root/'adapters/limeai-flash/adapters.safetensors'
    with adapter.open('rb') as file:
        actual=hashlib.file_digest(file,'sha256').hexdigest()
    if actual!=metadata.get('adapter_sha256'):
        raise ValueError('The reviewed adapter does not match the deployment adapter.')


if __name__=='__main__':
    require_release()
