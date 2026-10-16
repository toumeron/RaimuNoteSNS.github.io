# Daily recommendation training

## Public image catalog

`node scripts/recommendations/build-catalog.mjs` fetches public creator feeds and
creator-linked twitter media, then runs the pinned q8 CLIP vision model on a
Node.js CPU. It never uses post text to decide an image's subject, and never
uploads account likes, follows, feedback or tokens. The client retains the same
visual topic, positive/negative similarity, creator diversity and seen-post
<<<<<<< HEAD
checks. Browser model loading is unnecessary when the catalog contains enough
eligible candidates; unmatched history images and catalog misses still use the
existing inference path.
=======
checks. The production build includes a verified public fallback catalog so opening a
feed does not wait for the remote catalog or an image-model download. Personal
history images hydrate after the first cards render; catalog misses retain the
bounded inference path.
>>>>>>> 374490cc (“update23”)

The generated local file `public/recommendations/catalog.json` is ignored by Git
and detected by Vite at startup. Restart Vite after generating it for the first
time. The public-only GitHub Actions workflow prepares a fresh artifact hourly
and stores it on `generated/recommendations`, separate from `main` and Pages.
It requires no cloud inference API or separate server. Failed collection,
insufficient provider/creator diversity and stale artifacts fail closed. The
<<<<<<< HEAD
frontend build uses `VITE_RECOMMENDATION_CATALOG_URL`; catalog entries expire
after two hours. `RECOMMENDATION_CATALOG_FEEDS` and
=======
frontend build uses `VITE_RECOMMENDATION_CATALOG_URL` for asynchronous refresh;
fresh remote artifacts expire after two hours. A verified build fallback remains
available for at most seven days, and failures never overwrite it with an empty
result. Local Vite startup detects the artifact automatically. `RECOMMENDATION_CATALOG_FEEDS` and
>>>>>>> 374490cc (“update23”)
`RECOMMENDATION_CATALOG_AUTHORS` are optional public source configuration;
defaults cover the existing artwork feeds and creators' own linked accounts.

The workflow and frontend changes require an explicitly authorized publication
before they affect the hosted application. No workflow, branch or deployment is
created by merely editing these files locally. Cold-browser tests must record
the catalog HTTP read separately from its server-side preparation; a local file
measurement is not evidence of remote CDN or authenticated-profile latency.

DB migrations, function deployment, Secrets and the daily workflow are activated separately from the Pages frontend release.

## Setup

1. Apply `supabase/migrations/20261011210000_recommendation_training.sql`, followed by `20261011220000_recommendation_actions.sql`, to the target DB.
2. Generate a random `RECOMMENDATION_TRAINING_SECRET` and register the same value in Supabase function Secrets and GitHub Actions repository Secrets. Register the existing public `SUPABASE_ANON_KEY` in GitHub Actions Secrets. Never put service-role credentials in the frontend or repository.
3. Deploy `recommendation-ranker` (`verify_jwt=false` is intentional: normal requests verify their user JWT inside the handler; export/upload require the dedicated training secret).
4. Enable `VITE_RECOMMENDATION_RANKER_ENABLED=true` in the frontend build environment only after the DB/function are ready. The default is disabled to avoid requests to an undeployed service.
5. Enable the daily training workflow on the default branch. Configure frontend deployment and model training as separate workflows.
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
