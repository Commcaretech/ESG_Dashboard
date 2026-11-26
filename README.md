# ESGHub

ESGHub is the private FY2026 reporting workspace for Tzu Chi Singapore Community Care. It covers the six assigned workbook tabs and a reporting overview. Approved HQ staff can review coverage, trace figures and export CSV. Editors can enter verified aggregate figures and annual reporting records.


## Set up Neon

1. In the Neon Console, create or select a dedicated project. Choose a branch and database for staging. Under **Postgres database → Data API**, enable the Data API with **Managed Better Auth**. Leave **Grant public schema access** unchecked. ESGHub's migration grants the required permissions. Keep the exposed schemas limited to `public`.
2. In the Neon **SQL Editor**, select the same branch and database. Run [202611260001_esghub_phase1.sql](neon/migrations/202611260001_esghub_phase1.sql) first and [202611260002_fy2026_catalog.sql](neon/migrations/202611260002_fy2026_catalog.sql) second. Apply each once to a fresh destination. Confirm FY2026 exists and the reporting tables are empty. Under **Data API**, select **Refresh schema cache** after both migrations.
3. In **Better Auth**, enable **Sign-in with Email**. Configure an approved email provider for password reset links and enable **Revoke sessions on password reset**. Add the exact Render HTTPS origin to the trusted domains. Enable localhost access only on the development branch for `http://localhost:5173`.
4. Provision staff through Neon Auth administration. Use the Console if it exposes user creation, or use the documented branch Auth **Create user** operation in the Neon management API. Grant ESGHub access only after confirming the staff member's work email and Neon user ID. Give staff the ESGHub URL and have them use **Forgot password?** to set their own password via email. The deployed app has no registration form. Even if someone creates a Neon Auth account through the provider, it gives them no reporting access.
5. Run the following as a database administrator, substituting the approved work email and the appropriate role (`viewer` or `editor`). Check that the statement returns the intended ID. Neon Auth admin status does not grant ESGHub access.

   ```sql
   insert into public.user_profiles (user_id, role)
   select id::text, 'viewer'
   from neon_auth."user"
   where lower(email) = lower('approved.staff@example.org')
   on conflict (user_id) do update set role = excluded.role
   returning user_id, role;
   ```

6. To revoke reporting access, remove that user's row from `public.user_profiles`. RLS applies on subsequent requests. Database administrators can review role and reporting changes in `public.change_audit`.
7. Copy the **Auth Base URL** from Better Auth and the **Data API URL** from Data API. These are HTTPS endpoints for the browser. Use the same branch and database for both. Keep Postgres connection strings, Neon API keys and database credentials out of Vite variables and Git.

[Neon Data API setup](https://neon.com/docs/data-api/get-started) · [Neon Auth administration](https://neon.com/docs/auth/guides/manage-auth-api) · [Neon Auth production checklist](https://neon.com/docs/auth/production-checklist)

### If the schema migration says the Neon Data API prerequisites are missing

Click **ROLLBACK** in SQL Editor if it shows a failed transaction. In the Data API page, verify that the API is enabled with Managed Better Auth for the same branch and database selected in SQL Editor. Then run this check in SQL Editor:

```sql
select current_database() as database_name,
       to_regrole('authenticated') is not null as authenticated_role_exists,
       to_regrole('anonymous') is not null as anonymous_role_exists,
       to_regprocedure('auth.user_id()') is not null as request_identity_exists;
```

All three checks should return `true`. If any return `false`, confirm the branch and database in both pages before retrying. Neon provisions these roles and the request identity function through the Data API. Once the checks pass, rerun the schema migration, then the FY2026 catalogue migration.

## Run locally

If sign-in or password reset shows **Invalid origin**, check the branch connected to `VITE_NEON_AUTH_URL`. On a Neon development branch, enable **Allow Localhost** under **Settings → Better Auth**, then open ESGHub at `http://localhost:5173/`. For Render, add the exact HTTPS origin under **Better Auth → Configuration → Domains**, with no trailing slash. [Neon trusted domains](https://neon.com/docs/auth/guides/configure-domains)

Install Node.js 24. From the repository root on Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
npm.cmd ci
```

Replace the placeholders in `.env.local` with the Neon Auth Base URL and Data API URL, then start Vite.

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

The database suite runs the actual migrations in local PostgreSQL via PGlite with a stand-in for the Neon request identity function. Verify Auth emails and the Data API on your Neon staging branch before launch.


## Deploy to Render

1. Push the source and lockfile to an approved private Git repository. Keep credentials, the workbook, CSV exports and reporting records outside Git. Deploy `dist` only.
2. In Render, choose **New → Blueprint** and connect the repository with [render.yaml](render.yaml). Set both `VITE_NEON_AUTH_URL` and `VITE_NEON_DATA_API_URL`. For manual setup, create a **Static Site**, use Node 24.19.0, build with `npm ci && npm run build` and publish `dist`. Remove the old Supabase build variables if replacing a service. Render serves the build directly. Rebuild after changing either URL.
3. Add the actual Render origin to the trusted domains for the matching Neon branch. Verify sign-in, session renewal, sign-out and reset email on that origin. Test with a viewer, an editor and an authenticated account with no staff profile. Confirm that the browser works with the organisation's browser policies before rollout. The site shell is accessible by URL, and RLS gates report data.

[Render Static Sites](https://render.com/tutorials/web-service-vs-static-site/static-sites)

## Switching an existing Supabase deployment

The legacy SQL files under `supabase/migrations` remain as a reference for the source database. Apply the Neon migrations only on the destination. If the old Supabase database has saved reports, back it up and keep it available until a separate transfer is reconciled. This code change does not transfer live records. Preserve the reporting years, metric and narrative rows, source information, historical actor IDs and the audit trail when planning that transfer. Recreate staff accounts in Neon and assign roles against their new IDs. Supabase password hashes are incompatible with Neon managed Auth.

[Neon migration guide](https://neon.com/docs/auth/migrate/from-supabase)

## Staff workflow

- Choose a financial year and **Full year** or a month. Annual inputs and records remain visible with an annual label. Only FY2026 is configured initially.
- Choose a month to enter monthly data. Select **Enter** or **Edit**, give the aggregate and its source, then save. Use zero only when confirmed. Clear a value to mark it unavailable and add remarks if appropriate. Sign out when you finish on a shared browser.
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
