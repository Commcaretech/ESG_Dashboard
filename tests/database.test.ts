import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PGlite} from '@electric-sql/pglite';

test('migrations, report access, database validation and audit', async () => {
  const db = new PGlite();
  const editor = '00000000-0000-4000-8000-000000000001';
  const viewer = '00000000-0000-4000-8000-000000000002';
  const unapproved = '00000000-0000-4000-8000-000000000003';
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      grant usage on schema auth to anon, authenticated;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
      $$;
      insert into auth.users values ('${editor}'),('${viewer}'),('${unapproved}');
    `);
    const files = ['202611250001_esghub_phase1.sql','202611250002_fy2026_catalog.sql'];
    for (const file of files) await db.exec(readFileSync(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    const catalog = JSON.parse(readFileSync(new URL('../src/catalog.json',import.meta.url),'utf8'));
    assert.deepEqual((await db.query('select definition from public.metric_definitions order by metric_id')).rows.map((r: {definition: unknown}) => r.definition),
      [...catalog.metrics].sort((a,b) => a.id < b.id ? -1 : 1));
    assert.deepEqual((await db.query('select definition from public.narrative_definitions order by record_type')).rows.map((r: {definition: unknown}) => r.definition),
      [...catalog.records].sort((a,b) => a.id < b.id ? -1 : 1));
    await db.exec(`insert into public.user_profiles values ('${editor}','editor'),('${viewer}','viewer')`);
    const read = 'select * from public.metric_values';
    const add = (id: string, period: number, value: number | null, source = 'Test evidence') =>
      `insert into public.metric_values(year,catalog_version,scope,metric_id,period,value,source)
        values (2026,1,'community_care','${id}',${period},${value ?? 'null'},'${source}')`;
    const role = async (uid: string) => db.exec(`set role authenticated; set request.jwt.claim.sub = '${uid}';`);
    await db.exec('set role anon');
    await assert.rejects(db.query(read), /permission denied/);
    await role(unapproved);
    assert.equal((await db.query('select * from public.reporting_years')).rows.length,0);
    await assert.rejects(db.exec(add('programmes',1,1)), /Editor permission required|row-level security/);
    await role(editor);
    await db.exec(add('programmes',1,0));
    await db.exec(add('programmes',2,null,''));
    await db.exec(add('volunteer_hours',1,1.25));
    await db.exec(add('channel_0_used',0,0));
    await assert.rejects(db.exec(add('programmes',1,1)), /duplicate key/);
    for (const input of [
      add('programmes',3,1.25),add('programmes',3,-1),add('programmes',3,0,''),
      add('channel_0_used',0,2),add('channel_1_used',1,1),add('recyclables_total',1,1),add('active_volunteers',0,5),
    ]) await assert.rejects(db.exec(input), /violates check|invalid/);
    await db.exec(`insert into public.narrative_records (year,catalog_version,scope,record_type,slot,fields)
      values (2026,1,'community_care','list_1',1,'["12.5",null]')`);
    await assert.rejects(db.exec(`update public.narrative_records set fields='["12.5","changed"]'`), /Fixed workbook field/);
    await assert.rejects(db.exec(`update public.narrative_records set fields='["-10",null]'`), /Invalid field/);
    await assert.rejects(db.exec(`update public.user_profiles set role='editor'`), /permission denied/);
    await assert.rejects(db.exec('select * from public.change_audit'), /permission denied/);
    await role(viewer);
    assert.equal((await db.query(read)).rows.length,4);
    await assert.rejects(db.exec(add('programmes',4,0)), /Editor permission required|row-level security/);
    assert.equal((await db.query('update public.metric_values set value=9 returning value')).rows.length,0);
    await role(unapproved);
    assert.equal((await db.query(read)).rows.length,0);
    await db.exec('reset role');
    const audit = await db.query('select actor from public.change_audit where table_name = $1',['metric_values']);
    assert.equal(audit.rows.length,4);
    assert.ok(audit.rows.every((row: {actor: string}) => row.actor === editor));
  } finally {await db.close();}
});

