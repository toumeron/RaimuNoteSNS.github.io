"""Train privately on observed feature vectors. Publish only a validated tree model."""
import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from itertools import groupby
from pathlib import Path


def request(action, **payload):
    url = os.environ['SUPABASE_URL'].rstrip('/') + '/functions/v1/recommendation-ranker'
    req = urllib.request.Request(url, data=json.dumps({'action': action, **payload}).encode(), headers={
        'Content-Type': 'application/json', 'apikey': os.environ['SUPABASE_ANON_KEY'],
        'x-recommendation-training-secret': os.environ['RECOMMENDATION_TRAINING_SECRET'],
    })
    with urllib.request.urlopen(req, timeout=120) as response:
        return json.load(response)


def prepare_groups(rows):
    groups = []
    for qid, records in groupby(sorted(rows, key=lambda row: row['qid']), key=lambda row: row['qid']):
        # One candidate per group, with its original pre-engagement feature vector.
        items = list(records)
        if len(items) >= 2 and len({item['label'] for item in items}) > 1:
            groups.append((max(item['at'] for item in items), qid, items))
    return sorted(groups)


def compact(node):
    if 'leaf_value' in node:
        return {'leaf_value': node['leaf_value']}
    if node['decision_type'] != '<=':
        raise ValueError('Only numeric splits are supported by server inference')
    return {key: node[key] for key in ('split_feature', 'threshold', 'default_left', 'decision_type')} | {
        'left_child': compact(node['left_child']), 'right_child': compact(node['right_child'])}


def ndcg(groups, predict):
    import numpy as np
    from sklearn.metrics import ndcg_score
    # Avoid an arbitrary tie order when the old scoring rule ties candidates.
    return float(np.mean([ndcg_score([[2 ** item['label'] - 1 for item in items]], [predict(items)], k=10)
                          for _, _, items in groups]))


def train(dataset):
    import numpy as np
    import lightgbm as lgb
    groups = prepare_groups(dataset['rows'])
    if len(groups) < 30:
        return None, 'Insufficient mature ranking groups (need at least 30)'
    # Time holdout by whole ranking request: no candidate/request leaks into training.
    cut = max(1, int(len(groups) * .8))
    training, validation = groups[:cut], groups[cut:]
    cutoff = min(item['at'] for _, _, items in validation for item in items)
    training = [group for group in training if max(item['at'] for item in group[2]) < cutoff]
    if len(training) < 20 or len(validation) < 5:
        return None, 'Insufficient independent time holdout'
    def arrays(part):
        return (np.array([item['features'] for _, _, items in part for item in items]),
                np.array([item['label'] for _, _, items in part for item in items]),
                [len(items) for _, _, items in part])
    x, y, sizes = arrays(training)
    # Fix complexity in advance; the publication holdout is not used for tuning.
    ranker = lgb.LGBMRanker(objective='lambdarank', n_estimators=80, num_leaves=15, max_depth=6,
                           learning_rate=.05, min_child_samples=20, reg_lambda=1,
                           label_gain=[0, 1, 3, 7, 15], random_state=42, n_jobs=2, verbosity=-1, deterministic=True, force_col_wise=True)
    ranker.fit(x, y, group=sizes, feature_name=dataset['featureNames'])
    baseline_index = dataset['featureNames'].index('baseline')
    baseline = ndcg(validation, lambda items: [item['features'][baseline_index] for item in items])
    learned = ndcg(validation, lambda items: ranker.booster_.predict(np.array([item['features'] for item in items])))
    if learned <= baseline + .001:
        return None, 'Holdout did not improve; keeping current model/baseline'
    model = {'version': 1, 'featureNames': dataset['featureNames'], 'trainedAt': datetime.now(timezone.utc).isoformat(),
             'trees': [compact(tree['tree_structure']) for tree in ranker.booster_.dump_model()['tree_info']],
             'metrics': {'baselineNdcg': baseline, 'modelNdcg': learned, 'validationGroups': len(validation)}}
    # Cross-check the compact tree interpreter against LightGBM predictions.
    def predict_tree(node, row):
        while 'leaf_value' not in node:
            node = node['left_child'] if row[node['split_feature']] <= node['threshold'] else node['right_child']
        return node['leaf_value']
    check = arrays(validation)[0][:100]
    assert np.allclose([sum(predict_tree(tree, row) for tree in model['trees']) for row in check], ranker.booster_.predict(check), atol=1e-8)
    return model, f'Holdout NDCG@10: {baseline:.4f} -> {learned:.4f}; groups={len(validation)}'


def main():
    dataset = request('export')
    model, message = train(dataset)
    print(message)  # No user IDs, text, samples or tokens in logs/artifacts.
    if model is None:
        return
    output = Path(os.environ.get('RUNNER_TEMP', '/tmp')) / 'limenote-ranker.json'
    output.write_text(json.dumps(model, separators=(',', ':')))
    request('upload', model=model)
    print('Validated model saved to private storage')


if __name__ == '__main__':
    main()
