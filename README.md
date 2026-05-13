# curriculum-ingest

Single-operator webapp that extracts structured curriculum data from textbook PDFs and produces an exportable bundle for seeding a new LMS instance.

**Production:** https://ingest.mschool.com.tw

## Operator handbook

The full handbook lives as a living HTML document — easier to read than markdown, kept in source:

- **Local:** open [`public/docs.html`](./public/docs.html) in any browser.
- **Deployed:** https://ingest.mschool.com.tw/docs.html (also linked from the app header as "Docs").

It covers: phase 1 scope, stack, local dev, the auth model, the extraction pipeline, the review UI, export bundle, Coolify deployment (shared-Postgres + dedicated DB/role recipe), the AF&F Book 1 test plan, and phase 2 priorities.

## Quick start (local)

```bash
cp .env.example .env.local   # fill in DATABASE_URL, R2_*, ANTHROPIC_API_KEY, INGEST_PASSWORD
npm install
npm run db:push
npm run dev
```

Visit http://localhost:3000.
