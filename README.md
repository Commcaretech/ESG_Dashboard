# ESGHub

ESGHub is the private FY2026 reporting workspace for Tzu Chi Singapore Community Care. It covers the six assigned workbook tabs and a reporting overview. Approved HQ staff can review coverage, trace figures and export CSV. Editors can enter verified aggregate figures and annual reporting records.

## Set up Supabase

1. Create a dedicated Supabase project in an organisation-approved account and region. Keep the Data API enabled for the `public` schema. Keep `esghub_private` outside the exposed schemas.
2. In **SQL Editor**, run [202611250001_esghub_phase1.sql](supabase/migrations/202611250001_esghub_phase1.sql) first, then [202611250002_fy2026_catalog.sql](supabase/migrations/202611250002_fy2026_catalog.sql). The first creates the schema, row-level security, server-stamped provenance and audit trail. The second populates the FY2026 definitions. Confirm that `reporting_years` contains FY2026 and that `metric_values` and `narrative_records` are empty. For a CLI-managed project, link the dedicated project and use `supabase db push` as an alternative. Apply each migration once.
3. In **Authentication**, enable the email/password provider and email confirmations. Disable public sign-ups and anonymous sign-ins. Under **URL Configuration**, set **Site URL** to the approved Render HTTPS address once assigned. Add the exact production URL and `http://localhost:5173/` to **Redirect URLs** where needed. For a local-only test project, set Site URL to `http://localhost:5173/` before sending invitations. Start the app before opening invitation links. Configure an approved SMTP provider and verify delivery before inviting staff.
4. Open **Authentication → Users → Add user → Send invitation**. Copy the invited user's UUID from the Users page. In SQL Editor, grant the required role. Substitute the UUID and use either `viewer` or `editor`.

   ```sql
   insert into public.user_profiles (user_id, role)
   values ('PASTE-INVITED-USER-UUID'::uuid, 'viewer')
   on conflict (user_id) do update set role = excluded.role;
   ```

5. Staff open the link to set a password and sign in with their work email. Remove the user's corresponding `user_profiles` row to revoke ESGHub access on subsequent requests. Use Supabase Auth administration to disable the Auth account if needed. Database administrators can review role and reporting changes in `public.change_audit`.
6. From the project Connect dialog or settings, copy the **Project URL** and **Publishable key** beginning with `sb_publishable_`. Keep database credentials and secret/service-role keys out of Vite, the browser and Git.

[Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration) · [Inviting users](https://supabase.com/docs/guides/auth/users)

## Run locally

Install Node.js 24. From the repository root on Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm.cmd ci
```

Replace the placeholders in `.env.local` with the project URL and publishable key, then start Vite.

```powershell
npm.cmd run dev -- --strictPort
```

Open `http://localhost:5173/`. On macOS or Linux use `cp` and `npm`. Restart Vite after environment changes.

```powershell
npm.cmd run lint
npm.cmd test
npm.cmd run build
npm.cmd run preview
```

The database suite runs the actual migrations in local PostgreSQL via PGlite with stand-ins for the Supabase Auth functions. Verify Auth emails and real Data API access in your own Supabase staging project before launch.

## Deploy to Render

1. Push the source and lockfile to an approved private Git repository. Keep credentials, the workbook, CSV exports and reporting records outside Git. The root `dashboard.html` and `metric-catalog.json` are retained starter references. Deploy `dist` only.
2. In Render, choose **New → Blueprint** and connect the repository with [render.yaml](render.yaml). Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. For manual setup, choose **New → Static Site**, use Node 24.19.0 and build command `npm ci && npm run build`, and set publish directory to `dist`. Render serves the built files directly, so a start command is unnecessary. Rebuild after changing either variable.
3. Add the Render HTTPS address to Supabase **Site URL** and **Redirect URLs**. The site shell is accessible by URL. Authentication and database RLS protect reporting data. If the organisation requires network restrictions on the site shell, configure Render access restrictions under a supported plan before rollout.
4. In staging, test invitation acceptance, password reset and sign out. As an editor, enter a test-only zero and blank in separate months and check coverage and CSV after reloading. Confirm a viewer can read and cannot write. Confirm an authenticated user without a profile has no report access. Repeat the core staff flow on a phone. Use a separate production project for approved real data.

[Render Blueprint reference](https://render.com/docs/blueprint-spec) · [Render Static Sites](https://render.com/tutorials/web-service-vs-static-site/static-sites)

## Staff workflow

- Choose a financial year and **Full year** or a month. Annual inputs and records remain visible with an annual label. Only FY2026 is configured initially.
- Choose a month to enter monthly data. Select **Enter** or **Edit**, give the aggregate and its source, then save. Use zero only when confirmed. Clear a value to mark it unavailable and add remarks if appropriate. Reloading the browser requires signing in again because sessions are kept in memory.
- Use **Annual records** for reporting details, highlights, material topics, partnership and stakeholder lists, and sign-off. Record approval only after it occurs. Keep member names, IDs and individual records out of ESGHub. The workbook separately has fields for the names of staff who sign off.
- **Export CSV** exports the current section or all sections from **Overview**. A full-year CSV includes monthly inputs and provenance for summed fields, December provenance for snapshots, and annual records. Treat downloads as internal reporting data.

## Workbook mapping

The application catalog is [src/catalog.json](src/catalog.json). The second migration seeds those same definitions, including exact editable and result cells, units, source or remarks cells where applicable, calculation rules and scope.

- Full-year totals sum available inputs and show **Partial** when coverage is incomplete. With no inputs, the value is blank. Volunteer percentages require complete inputs and a non-zero denominator.
- Community Care C49 and Volunteers C9 use December. Volunteers Q9 also sums the months, but C9 is the FY reporting field. Volunteer gender and age rollups follow their separate monthly sum formulas.
- Community Care C12 and its gender and age fields sum monthly people counts. These counts cannot establish an annual distinct total. Outreach and beneficiary headcount are separate measures.
- Community Care row 20 is an unlabelled mixed-measure subtotal across outreach and beneficiary series. It is excluded pending clarification. Rows 54 and 64 show the same recyclable quantity in their respective sections.
- Knowledge Sharing & Advocacy C14:C22 stores Yes/No independently of reach and touchpoints. The workbook contained no verified reporting figures in the mapped inputs. Guidance, examples, numbering and cached formula zeroes are excluded from data. Use blank values with remarks in ESGHub. Confirm formal Excel submission conventions with HQ.

## Future data sources

- Confirm centre IDs, reporting boundaries and how any distinct counts will be calculated. The database currently uses a single `community_care` scope.
- Obtain approved aggregate extracts and confirm programme completion, reporting dates, deduplication and the definition of each measure. Verify which volunteers fall outside VMS coverage. Confirm how to measure publicity reach separately from participation or beneficiary figures.
- Review authorised sample exports and actual schemas before connecting any source system. Stable metric IDs, year/scope/period keys and provenance support later integrations. Aggregate upload, source-system adapters and original XLSX export belong to later phases.
