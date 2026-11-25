import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createReport,csv,display,hasChartData,type MetricValue} from '../src/report.ts';
const catalog = JSON.parse(readFileSync(new URL('../src/catalog.json',import.meta.url),'utf8'));
const metric = (metric_id: string, period: number, value: number | null): MetricValue =>
  ({metric_id,period,value,source:'Test evidence',remarks:'',updated_at:''});

test('missing, explicit zero, partial and selected month', () => {
  const report = createReport(catalog.metrics,[metric('programmes',1,0),metric('programmes',2,null),metric('programmes',3,7)]);
  assert.deepEqual(report.result('programmes',0),{value:7,known:2,expected:12});
  assert.deepEqual(report.result('programmes',1),{value:0,known:1,expected:1});
  assert.deepEqual(report.result('programmes',2),{value:null,known:0,expected:1});
  assert.equal(display(catalog.metrics[0],0),'0');
  assert.equal(display(catalog.metrics[0],null),'—');
});

test('snapshots use December and December data does not leak across reports', () => {
  for (const id of ['active_volunteers','eco_points']) {
    assert.equal(createReport(catalog.metrics,[metric(id,11,5)]).result(id,0).value,null);
    const newYear = createReport(catalog.metrics,[metric(id,1,11),metric(id,12,0)]);
    assert.equal(newYear.result(id,0).value,0);
    assert.equal(newYear.result(id,1).value,11);
    assert.equal(newYear.result(id,11).value,null);
  }
});

test('annual values, explicit No, people counts and decimal derived quantities', () => {
  const report = createReport(catalog.metrics,[
    metric('advocacy_reach',0,11),metric('channel_0_used',0,0),metric('beneficiary_people',1,2),metric('beneficiary_people',12,3),
    metric('recycle_0',1,1.25),metric('recycle_1',2,2.5),metric('volunteer_age_0_male',1,4),metric('volunteer_age_1_male',12,5),
  ]);
  assert.equal(report.result('advocacy_reach',5).value,11);
  const flag = catalog.metrics.find((entry: {id: string}) => entry.id === 'channel_0_used');
  assert.equal(display(flag,report.result(flag.id,5).value),'No');
  assert.equal(report.result('beneficiary_people',0).value,5);
  assert.deepEqual(report.result('recyclables_collected',0),{value:3.75,known:2,expected:72});
  assert.equal(report.result('volunteer_male',0).value,9);
  assert.equal(report.result('volunteer_male',12).value,5);
  assert.equal(report.result('volunteer_age_0_female_pct',1).value,null);
  const decimals = createReport(catalog.metrics,[metric('recycle_0',1,0.1),metric('recycle_1',1,0.2)]);
  assert.equal(decimals.result('recyclables_collected',1).value,0.3);
});

test('critical workbook coordinates and unique IDs', () => {
  assert.equal(new Set(catalog.metrics.map((m: {id: string}) => m.id)).size,catalog.metrics.length);
  const lookup = Object.fromEntries(catalog.metrics.map((m: {id: string}) => [m.id,m]));
  assert.equal(lookup.eco_points.cells[11],'P49');
  assert.equal(lookup.active_volunteers.output,'C9');
  assert.equal(lookup.outreach_age_4.cells[11],'O28');
  assert.equal(lookup.volunteer_age_4_female.cells[11],'AD25');
  assert.equal(lookup.channel_8_reach.cells[11],'AE22');
  assert.equal(lookup.channel_8_used.cells[0],'C22');
  assert.equal(lookup.recyclables_collected.output,'C54');
});

test('CSV keeps blanks and zero distinct and protects spreadsheet cells', () => {
  assert.equal(csv([[null,0,'=1+1','  @SUM(A1)','\ttext','a"b','＋1']]),
    '\uFEFF"","0","\'=1+1","\'  @SUM(A1)","\'\ttext","a""b","\'＋1"');
});

test('the chart empty state gives way to real observations, including zero', () => {
  const report = createReport(catalog.metrics,[]);
  assert.equal(hasChartData(Array.from({length:12},(_,i) => report.result('programmes',i+1).value)),false);
  assert.equal(hasChartData([null,0,null]),true);
});

