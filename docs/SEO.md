# Search discovery

Vibe Racing serves public standings and racer profiles as server-rendered HTML. Metadata, canonical
URLs and social preview images use `VIBERACING_PUBLIC_ORIGIN`, which must be the public HTTPS origin
in production.

## Indexing policy

- `/robots.txt` allows crawling and points to `/sitemap.xml`.
- The sitemap contains the homepage and up to 49,999 public profiles, ordered by handle. A profile
  is public only while it has retained usage or an active installation, matching the profile route.
  Split the sitemap before reaching 50,000 URLs; profiles beyond this limit are still discoverable
  through leaderboard pagination.
- The sitemap is generated at request time so removed profiles do not remain in a cached list. It
  omits `lastmod` because a request timestamp would not describe a content change.
- Week, month and year pages use normalized canonical URLs. Pagination retains its page number;
  tracking parameters, invalid filters, `page=1` and the default `period=week` alias are omitted.
- Valid custom date ranges use `noindex, follow` to avoid indexing arbitrary filter combinations.
- Dashboard, connection, API and health routes send `X-Robots-Tag: noindex, nofollow`. Dashboard and
  connection pages also have robots metadata. They remain crawlable so search engines can see these
  directives; authentication still protects private data.
- Social cards use the local `/og` PNG endpoint, without third-party image or font requests.

## Connect Google Search Console

The official Railway origin includes the maintainer's public HTML verification token. Other origins
do not inherit that ownership proof; they use the optional environment variable below.

1. Sign in to [Google Search Console](https://search.google.com/search-console).
2. Add a **URL-prefix** property for `https://viberacing.up.railway.app/` (or the deployment's
   configured origin). A Railway subdomain does not give ownership of the `railway.app` DNS zone.
3. Select **HTML tag** verification. Set `VIBERACING_GOOGLE_SITE_VERIFICATION` on the web service to
   the supplied tag's `content` value, then deploy. Do not include the whole HTML tag.
4. Verify that the live homepage contains the supplied `google-site-verification` meta tag and click
   **Verify** in Search Console. Keep the variable after verification.
5. Submit `https://viberacing.up.railway.app/sitemap.xml` in **Sitemaps**. Use **URL inspection**
   for the homepage, test the live URL and request indexing.
6. Use **Page indexing**, **Performance** and **Core Web Vitals** for actual coverage, queries,
   impressions and field performance. Deployment and sitemap submission do not guarantee indexing or
   ranking; do not treat an empty `site:` search as a complete index report.

The same sitemap can be submitted to other search engines' webmaster tools. Do not add fake ratings,
keyword stuffing, automated backlink submissions or fabricated update timestamps.
