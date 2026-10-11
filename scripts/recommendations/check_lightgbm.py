"""Synthetic regression check only; never export this fixture to production storage."""
import json
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path
from train import train

random.seed(42)
names = ['interest','recent_interest','author_affinity','follow','freshness','quality','seen_penalty','spam_penalty','self_penalty','baseline','has_image','native','bluesky','misskey','text_length']
rows = []
for group in range(160):
    at = (datetime(2026, 10, 1, tzinfo=timezone.utc) + timedelta(hours=group)).isoformat()
    for item in range(8):
        features = [random.random() for _ in names]
        rows.append({'qid': f'fixture-{group:04}', 'features': features, 'label': 2 if features[0] > .5 else 0, 'at': at})
model, message = train({'featureNames': names, 'rows': rows})
assert model is not None, message
Path('/private/tmp/lime-ranker-fixture.json').write_text(json.dumps(model))
print('Synthetic fixture only: learning, holdout validation and compact-tree parity passed')
print(message)
# Uniform labels must skip training and must never replace the current model.
for row in rows:
    row['label'] = 0
assert train({'featureNames': names, 'rows': rows})[0] is None
print('Insufficient useful labels preserve the current model')
