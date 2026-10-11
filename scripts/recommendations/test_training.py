import unittest
from train import prepare_groups, compact

class TrainingTests(unittest.TestCase):
    def test_groups_do_not_use_unseen_or_single_label_requests(self):
        rows = [{'qid': 'a', 'label': 0, 'at': '2026-10-01'}, {'qid': 'a', 'label': 2, 'at': '2026-10-01'},
                {'qid': 'b', 'label': 0, 'at': '2026-10-02'}, {'qid': 'c', 'label': 0, 'at': '2026-10-03'},
                {'qid': 'c', 'label': 0, 'at': '2026-10-03'}]
        self.assertEqual([group[1] for group in prepare_groups(rows)], ['a'])

    def test_groups_include_reposts_bookmarks_and_explicit_disinterest(self):
        rows = [{'qid': 'signals', 'label': label, 'at': '2026-10-01'} for label in [0, 1, 2, 3, 4]]
        groups = prepare_groups(rows)
        self.assertEqual([item['label'] for item in groups[0][2]], [0, 1, 2, 3, 4])

    def test_tree_export_discards_training_only_metadata(self):
        node = {'split_feature': 1, 'threshold': .2, 'default_left': True, 'decision_type': '<=',
                'left_child': {'leaf_value': -.3, 'leaf_count': 9}, 'right_child': {'leaf_value': .5, 'leaf_count': 8},
                'internal_count': 17}
        output = compact(node)
        self.assertNotIn('internal_count', output)
        self.assertEqual(output['left_child'], {'leaf_value': -.3})
        with self.assertRaises(ValueError):
            compact(dict(node, decision_type='=='))

if __name__ == '__main__':
    unittest.main()
