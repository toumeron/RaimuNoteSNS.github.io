# Daily recommendation training

DB migrations, function deployment, Secrets and the daily workflow are activated separately from the Pages frontend release.

## Setup

1. Apply `supabase/migrations/20261011210000_recommendation_training.sql`, followed by `20261011220000_recommendation_actions.sql`, to the target DB.
2. Generate a random `RECOMMENDATION_TRAINING_SECRET` and register the same value in Supabase function Secrets and GitHub Actions repository Secrets. Register the existing public `SUPABASE_ANON_KEY` in GitHub Actions Secrets. Never put service-role credentials in the frontend or repository.
3. Deploy `recommendation-ranker` (`verify_jwt=false` is intentional: normal requests verify their user JWT inside the handler; export/upload require the dedicated training secret).
4. Enable `VITE_RECOMMENDATION_RANKER_ENABLED=true` in the frontend build environment only after the DB/function are ready. The default is disabled to avoid requests to an undeployed service.
5. Activate the workflow on the default branch only with explicit authorization. For backend-only activation, temporarily disable the Pages workflow and commit only the training workflow/scripts through the GitHub API with `[skip ci]`; verify no Pages run was created and restore the Pages workflow to its original state. Do not push the local application changes to main.
6. After collecting enough observations, run the workflow manually once. Then it is scheduled daily at 04:23 JST; GitHub schedules may be delayed.

## Data and model

Only items genuinely visible for 1.5 seconds, or explicitly engaged with, contribute samples. Previously unseen posts are never assumed to be negatives. Only candidates with a saved pre-action feature vector can be logged. Native, Bluesky and Misskey posts share the same feature schema. Successful likes, reposts, bookmarks and explicit “not interested” feedback are recorded separately per observed post. Relevance labels are: not interested = 0, impression without an active positive action = 1, like = 2, repost = 3, bookmark = 4. Explicit dismissal takes precedence; otherwise the strongest active signal wins. Removing a positive action clears only that signal, retaining other actions. These initial weights are product heuristics, not Twitter’s proprietary weights.

The existing private `profile_private_settings` row retains up to 2,000 bounded observations per account, pruned to 30 days on writes. Other settings, original likes, bookmarks, notifications and posts are untouched. Export includes only numeric features, random request group IDs, labels and timestamps, with a 30-day filter. Account IDs, handles, post text, image URLs and full post snapshots are not exported. Observations mature after 24 hours so users have time to interact. Displayed candidate counts/provider indicators are potential bias sources; NDCG is an offline gate, not proof of live user benefit.

LightGBM `LGBMRanker(objective='lambdarank')` learns in groups of candidates from one ranking request. At least 30 mixed-label groups are required. The final 20% of groups form a chronological holdout; overlapping groups are excluded from training. Publication requires NDCG@10 to beat the current baseline score feature by more than 0.001. Model complexity is fixed before validation. No synthetic samples are used in production training.

Only compact numeric tree weights and aggregate validation metrics are saved to the private `recommendation-models/ranker.json` object. Training data is not stored in GitHub artifacts, commits, caches or logs. The server evaluates those trees without a Python/LightGBM runtime. Existing eligibility, dismissed-item filtering and diversity selection stay in place. A failed or missing model, no improvement, insufficient samples, timeout or stale model uses the current rules. The client waits at most 1.5 seconds for the optional server ranking and backs off five minutes after failure; the model cache lasts five minutes and expires after seven days.

## Checks

```sh
python -m unittest discover -s scripts/recommendations -p 'test_*.py'
node scripts/recommendations/test-migration.mjs
npx vitest run src/lib/recommendationModel.test.ts
```

Dependencies are pinned in `requirements.txt`. Use a temporary virtual environment for local training tests. No paid runner or service is provisioned; standard GitHub-hosted runners are free for public repositories. Private repositories depend on the account's remaining included minutes. The job has a 15-minute timeout and one run per day.
