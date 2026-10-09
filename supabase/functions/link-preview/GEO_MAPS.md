LimeMaps external positions now use Flickr's official public-photo API, not text, URL, place-name, profile, or city-centre inference. The `map-geo-pins` response has schema `geo-v1`; clients reject older inferred pin responses. Legacy `map-pins` returns no inferred positions after this function is deployed.

Set `FLICKR_API_KEY` as an Edge Function secret, then deploy `link-preview`. Do not store the API key in Vite environment variables or the client bundle. No key is currently configured locally. No paid X API is used.

Official docs:
- https://www.flickr.com/services/developer/ (API is free)
- https://www.flickr.com/services/developer/api/ (application key required)
- https://www.flickr.com/services/api/flickr.photos.search.html (bbox, geo, pagination, 4,000-result query cap)

The first stage forwards only ID, source, timestamp, and provider-supplied geographic coordinates. Photo titles, author details, and images are not forwarded until the marker is selected. Details use `flickr.photos.getInfo`, check public visibility again, and link to the original Flickr photo. Posted locations may be GPS or user-selected geotags; neither is invented by LimeMaps.

Geographic searches use 250 results per page, all available pages automatically, and a historical upload range starting at Unix timestamp 1 to avoid the default 12-hour cutoff. Search windows with more than 4,000 results are recursively split by upload time. Flickr's remaining per-query cap may still apply if over 4,000 photos occupy the same one-second upload interval; do not claim every public photo worldwide is obtainable.

No database migration, polling job, dummy photos, or browser automation is required.
