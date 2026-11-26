import {useEffect, useMemo, useState, type FormEvent} from 'react';
import type {ReportingClient} from './neon';
import {Brand} from './Brand';
import catalog from './catalog.json';
import {allMonths, createReport, csv, display, hasChartData, key, months, type Metric, type MetricValue, type Narrative, type Provenance, type RecordDefinition, type Result} from './report';

const metrics: Metric[] = catalog.metrics;
const definitions: RecordDefinition[] = catalog.records;
const bySection = new Map(catalog.sections.map(section => [section, metrics.filter(metric => metric.section === section)]));
const overviewIds = ['programmes', 'outreach', 'beneficiary_attendance', 'beneficiary_people', 'active_volunteers', 'volunteer_hours'];
const overviewLabels: Record<string, string> = {
  beneficiary_attendance: 'Beneficiaries supported (headcount)',
  beneficiary_people: 'Beneficiaries supported (monthly people counts)',
};
type Year = {year: number; catalog_version: number};
type Report = {year: number; values: MetricValue[]; narratives: Narrative[]};
type Edit = {metric: Metric; period: number} | {definition: RecordDefinition; slot: number};

async function loadReport(client: ReportingClient, year: number): Promise<Report> {
  async function rows<T>(table: string, columns: string, id: string, period: string) {
    const result: T[] = [];
    const size = 500;
    for (let offset = 0;; offset += size) {
      const {data, error} = await client.from(table).select(columns).eq('year', year)
        .eq('scope', catalog.scope).order(id).order(period).range(offset, offset + size - 1);
      if (error) throw error;
      result.push(...((data ?? []) as T[]));
      if ((data?.length ?? 0) < size) return result;
    }
  }
  const [values, narratives] = await Promise.all([
    rows<MetricValue>('metric_values','metric_id,period,value,source,remarks,updated_at','metric_id','period'),
    rows<Narrative>('narrative_records','record_type,slot,fields,source,remarks,updated_at','record_type','slot'),
  ]);
  return {year, values, narratives};
}

export function Dashboard({client, editor, signOut}: {client: ReportingClient; editor: boolean; signOut: () => void}) {
  const [page, setPage] = useState('Overview');
  const [year, setYear] = useState(2026);
  const [period, setPeriod] = useState(0);
  const [years, setYears] = useState<Year[]>();
  const [data, setData] = useState<Report>();
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState(false);
  const [edit, setEdit] = useState<Edit>();
  const [notice, setNotice] = useState('');
  const [metricSearch, setMetricSearch] = useState('');
  const report = useMemo(() => createReport(metrics, data?.values ?? []), [data]);
  const narrativeIndex = useMemo(() => new Map(data?.narratives.map(row => [key(row.record_type, row.slot),row])), [data]);
  const periodLabel = period ? months[period-1] : 'Full year';
  const canLoad = years?.some(y => y.year === year && y.catalog_version === catalog.version);

  useEffect(() => {
    let active = true;
    client.from('reporting_years').select('year,catalog_version').order('year').then(({data, error}) => {
      if (!active) return;
      if (error) setError(true);
      else setYears(data ?? []);
    }, () => {if (active) setError(true);});
    return () => {active = false;};
  }, [client, attempt]);

  useEffect(() => {
    if (!canLoad) return;
    let active = true;
    void loadReport(client, year).then(result => {if (active) setData(result);})
      .catch(() => {if (active) setError(true);});
    return () => {active = false;};
  }, [client, year, canLoad, attempt]);

  const visible = bySection.get(page) ?? [];
  const filtered = visible.filter(m => (m.label + ' ' + m.group + ' ' + m.unit).toLowerCase().includes(metricSearch.trim().toLowerCase()));
  function navigate(next: string) {
    setPage(next);
    setMetricSearch('');
    setNotice('');
  }
  function exportReport() {
    const rows: (string | number | null)[][] = [[
      'FY','Scope','Section','Field ID','Field','Period','Record slot','Value','Unit','Status','Available inputs','Expected inputs','Workbook cell','Source','Remarks',
    ]];
    for (const m of page === 'Overview' ? metrics : visible) {
      const result = report.result(m.id, period);
      const exactPeriod = m.rule === 'annual' ? 0 : period || (m.rule === 'december' ? 12 : 0);
      const detail = report.values.get(key(m.id, exactPeriod));
      const annualMetric = m.rule === 'annual';
      rows.push([year,catalog.scope,m.section,m.id,m.label,annualMetric ? 'Annual' : periodLabel,null,
        m.type === 'flag' && result.value !== null ? display(m,result.value) : result.value,
        m.unit,status(result),result.known,result.expected,reference(m,period),detail?.source ?? '',detail?.remarks ?? '']);
      if (!period && !annualMetric && !m.depends && m.rule !== 'december') {
        for (const month of allMonths) {
          const input = report.values.get(key(m.id,month));
          rows.push([year,catalog.scope,m.section,m.id,m.label,months[month-1],null,input?.value ?? null,m.unit,
            input?.value == null ? 'Blank' : 'Reported',input?.value == null ? 0 : 1,1,reference(m,month),input?.source ?? '',input?.remarks ?? '']);
        }
      }
    }
    for (const definition of definitions.filter(d => page === 'Overview' || d.section === page)) {
      const records = data?.narratives.filter(row => row.record_type === definition.id) ?? [];
      const slots = records.length ? records : [{slot: 1, fields: [], source: '', remarks: ''}];
      for (const record of slots) definition.fields.forEach((field,i) => {
        const value = record.fields[i] ?? null;
        rows.push([year,catalog.scope,definition.section,definition.id,definition.label + ' · ' + field,
          'Annual',record.slot,value,'',value === null ? 'Blank' : 'Reported',null,null,definition.cells[record.slot-1][i],record.source,record.remarks]);
      });
    }
    const blob = new Blob([csv(rows)], {type: 'text/csv;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'ESGHub-FY' + year + '-' + periodLabel.replaceAll(' ','-') + '.csv';
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
  }

  async function save(target: Edit, body: Record<string, unknown>, previous?: Provenance) {
    const metric = 'metric' in target;
    const table = metric ? 'metric_values' : 'narrative_records';
    const identifiers = metric ? {metric_id: target.metric.id, period: target.period}
      : {record_type: target.definition.id, slot: target.slot};
    const identity = {year,scope:catalog.scope,catalog_version:catalog.version,...identifiers};
    let response;
    if (previous) {
      response = await client.from(table).update(body).match(identity)
        .eq('updated_at',previous.updated_at).select('updated_at').maybeSingle();
    } else {
      response = await client.from(table).insert({...identity,...body}).select('updated_at').single();
    }
    if (response.error?.code === '23505' || (!response.error && !response.data)) {
      throw new Error('Another editor changed this entry. Close the form, reload the report and review the latest entry.');
    }
    if (response.error) throw new Error('The entry could not be saved. Check your access and the field values.');
    setEdit(undefined);
    setData(undefined);
    setNotice('Entry saved.');
    setAttempt(n => n+1);
  }

  const ready = data?.year === year && !error;
  return <>
    <header className="site-header"><Brand/><div className="header-actions"><span className="role">HQ {editor ? 'editor' : 'viewer'}</span><button onClick={signOut}>Sign out</button></div></header>
    <div className="layout">
      <nav aria-label="Reporting sections">
        {['Overview',...catalog.sections].map((section,i) =>
          <button key={section} className={page === section ? 'selected' : ''} aria-current={page === section ? 'page' : undefined}
            onClick={() => navigate(section)}><span aria-hidden="true">{['▦','◈','◇','◉','▥','◌','▤'][i]}</span>{section}</button>)}
      </nav>
      <main id="report">
        <section className="report-intro">
          <div><p className="eyebrow">FY{year} · Consolidated Community Care</p>
            <h1>{page === 'Overview' ? 'Reporting overview' : page}</h1>
            <p className="muted">{page === 'Overview' ? 'Review available ESG figures and identify gaps in the FY report.' : 'Review workbook fields and their supporting sources.'}</p></div>
          <button disabled={!ready} onClick={exportReport}>Export CSV</button>
        </section>
        <div className="toolbar">
          <label>Financial year<select value={year} onChange={event => {setYear(+event.target.value);setError(false);setNotice('');}}>
            {(years?.length ? years : [{year:2026}]).map(y => <option key={y.year} value={y.year}>FY{y.year}</option>)}
          </select></label>
          <label>Period<select value={period} onChange={event => setPeriod(+event.target.value)}>
            <option value={0}>Full year</option>{months.map((month,i) => <option key={month} value={i+1}>{month}</option>)}
          </select></label>
          <button className="link" onClick={() => {setData(undefined);setError(false);setAttempt(n => n+1);}}>Reload report</button>
        </div>
        {notice && <p className="notice" role="status">{notice}</p>}
        {error ? <p className="notice" role="alert">The report could not be loaded. Check your connection or try reloading.</p>
          : years && !canLoad ? <p className="notice">This financial year has no accessible reporting catalog.</p>
          : !ready ? <p role="status">Loading your report…</p>
          : page === 'Overview' ? <>
            <div className="kpis">{overviewIds.map(id => {
              const metric = metrics.find(m => m.id === id)!;
              const stat = report.result(id,period);
              return <article className="card kpi" key={id}><h2>{overviewLabels[id] ?? metric.label}</h2>
                <strong>{display(metric,stat.value)}</strong><small>{coverage(stat)}{!period && metric.rule === 'december' ? ' · December snapshot' : ''}</small></article>;
            })}</div>
            <div className="overview-grid">
              <Chart values={allMonths.map(month => report.result('programmes',month).value)} selected={period}/>
              <section className="card"><h2>Numeric reporting coverage</h2><p className="muted">Available inputs for {periodLabel.toLowerCase()}. Confirmed zero counts as available.</p>
                {catalog.sections.map(section => {
                  const stats = (bySection.get(section) ?? []).filter(m => !m.depends && m.type !== 'flag').map(m => report.result(m.id,period));
                  const known = stats.reduce((n,s) => n+s.known,0);
                  const expected = stats.reduce((n,s) => n+s.expected,0);
                  return <div className="coverage" key={section}>
                    <div><button className="link" onClick={() => navigate(section)}>{section}</button><small>{expected ? known + ' / ' + expected : 'Annual records'}</small></div>
                    {expected > 0 && <progress aria-label={section + ' numeric coverage'} value={known} max={expected}/>}
                  </div>;
                })}
              </section>
            </div>
          </> : <>
            {page === 'Volunteers' && <p className="notice">Include only non-Tzu Chi volunteers or volunteers outside VMS. The FY active volunteer figure uses December. Gender and age counts sum the months.</p>}
            {page === 'Community Care' && <p className="notice">FY “Number of people” figures sum monthly counts. Keep outreach, beneficiary headcount and monthly people counts separate.</p>}
            {editor && visible.some(m => m.rule !== 'annual' && !m.depends) && !period && <p className="muted">Select a month to enter monthly figures. Annual fields can be edited here.</p>}
            {visible.length > 0 && <label className="search">Find a metric<input type="search" value={metricSearch} onChange={event => setMetricSearch(event.target.value)}/></label>}
            {visible.length > 0 && !filtered.length && <p>No metrics match your search.</p>}
            {[...new Set(filtered.map(m => m.group))].map(group => <section className="card section-card" key={group}>
              <h2>{group}</h2><div className="table-wrap"><table><thead><tr>
                <th>Workbook field</th><th>Value</th><th>Coverage</th><th>Source and remarks</th>{editor && <th>Action</th>}
              </tr></thead><tbody>{filtered.filter(m => m.group === group).map(m => {
                const stat = report.result(m.id,period);
                const p = m.rule === 'annual' ? 0 : period || (m.rule === 'december' ? 12 : 0);
                const input = report.values.get(key(m.id,p));
                const monthlySources = !period && m.rule === 'sum' && !m.depends
                  ? allMonths.flatMap(month => {
                    const row = report.values.get(key(m.id,month));
                    return row ? [{month,row}] : [];
                  }) : [];
                return <tr key={m.id}><th scope="row">{m.label}<small>{m.unit} · {reference(m,period)}{m.rule === 'annual' ? ' · Annual' : m.rule === 'december' && !period ? ' · December snapshot' : ''}</small></th>
                  <td className="number">{display(m,stat.value)}</td><td>{coverage(stat)}</td>
                  <td>{m.depends ? 'Calculated from workbook inputs' : monthlySources.length ? <details><summary>Monthly sources</summary>
                    {monthlySources.map(({month,row}) => <p key={month}><strong>{months[month-1]}</strong> {row.source} {row.remarks}</p>)}</details>
                    : <>{input?.source || '—'}{input?.remarks && <small>{input.remarks}</small>}</>}</td>
                  {editor && <td>{!m.depends && (period > 0 || m.rule === 'annual') &&
                    <button aria-label={'Edit ' + m.label} onClick={() => setEdit({metric:m,period:p})}>{input ? 'Edit' : 'Enter'}</button>}</td>}
                </tr>;
              })}</tbody></table></div>
            </section>)}
            <section className="card section-card"><h2>Annual records</h2>
              {definitions.filter(d => d.section === page).map(definition => {
                const records = data?.narratives.filter(r => r.record_type === definition.id && (r.fields.some(v => v !== null) || r.source || r.remarks)) ?? [];
                const emptySlot = Array.from({length:definition.limit},(_,i) => i+1).find(slot => !records.some(r => r.slot === slot));
                return <details className="record" key={definition.id}>
                  <summary>{definition.label}<small>{records.length ? records.length + (records.length === 1 ? ' entry' : ' entries') : 'Blank'}</small></summary>
                  <p className="muted">{definition.section} · {definition.range}</p>
                  {records.map(row => <div className="record-entry" key={row.slot}>
                    <dl>{definition.fields.map((label,i) => <div key={label}><dt>{label}</dt><dd>{row.fields[i] ?? definition.fixed_context?.[row.slot]?.[i] ?? '—'}</dd></div>)}
                      <div><dt>Source</dt><dd>{row.source || '—'}</dd></div>
                      <div><dt>Remarks</dt><dd>{row.remarks || '—'}</dd></div></dl>
                    {editor && <button onClick={() => setEdit({definition,slot:row.slot})}>Edit entry</button>}
                  </div>)}
                  {editor && emptySlot && <button onClick={() => setEdit({definition,slot:emptySlot})}>{definition.limit === 1 ? 'Enter details' : 'Add entry'}</button>}
                </details>;
              })}
            </section>
          </>}
      </main>
    </div>
    {edit && <Editor target={edit} close={() => setEdit(undefined)} save={save}
      previous={'metric' in edit ? report.values.get(key(edit.metric.id,edit.period)) : narrativeIndex.get(key(edit.definition.id,edit.slot))}/>}
  </>;
}

function reference(metric: Metric, period: number) {
  return period && metric.rule !== 'annual' ? metric.cells[period-1] ?? 'Derived' : metric.output;
}
function status(stat: Result) {
  return stat.known === 0 ? 'Blank' : stat.known < stat.expected ? 'Partial' : stat.value === null ? 'Undefined' : 'Reported';
}
function coverage(stat: Result) {
  return status(stat) + ' · ' + stat.known + '/' + stat.expected;
}
function Chart({values,selected}: {values: (number | null)[];selected:number}) {
  const maximum = Math.max(1,...values.map(value => value ?? 0));
  return <section className="card"><h2>Community programmes by month</h2>
    {!hasChartData(values) ? <div className="empty-chart"><span aria-hidden="true">▥</span><p>Monthly programme figures will appear here when available.</p></div>
      : <div className="chart" role="list" aria-label="Full-year monthly programme counts">
        {values.map((value,i) => <div role="listitem" aria-label={months[i] + ': ' + (value ?? 'blank')} key={months[i]} className={selected === i+1 ? 'highlight' : ''}>
          <span>{value === null ? '—' : value.toLocaleString('en-SG')}</span><i className={value === null ? 'missing' : ''} style={{height:value === null ? 5 : Math.max(3,100*value/maximum)}}/><small>{months[i]}</small>
        </div>)}
      </div>}
  </section>;
}

function Editor({target, previous, close, save}: {target: Edit; previous?: MetricValue | Narrative; close: () => void;
  save: (target: Edit, body: Record<string, unknown>, previous?: Provenance) => Promise<void>}) {
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const m = 'metric' in target ? target.metric : undefined;
  const def = 'definition' in target ? target.definition : undefined;
  const metricValue = previous && 'value' in previous ? previous.value : null;
  const fields = previous && 'fields' in previous ? previous.fields : [];
  const fixedContext = 'slot' in target ? def?.fixed_context?.[target.slot] : undefined;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const source = String(values.get('source') ?? '').trim();
    const remarks = String(values.get('remarks') ?? '').trim();
    const raw = String(values.get('value') ?? '');
    const amount = raw === '' ? null : Number(raw);
    if (m && amount !== null && (!Number.isFinite(amount) || amount < 0 || amount > Number.MAX_SAFE_INTEGER || (m.type === 'count' && !Number.isInteger(amount)) || !source)) {
      setError('Enter a valid non-negative value and its source, or leave the value blank.');
      return;
    }
    const record = def?.fields.map((_,i) => String(values.get('field'+i) ?? '').trim() || null);
    if (def && record?.some((value,i) => value !== null &&
      (def.types[i] === 'count' ? !/^\d+$/.test(value) : def.types[i] === 'decimal' && !/^\d+(\.\d+)?$/.test(value)))) {
      setError('Enter a non-negative number using digits and a decimal point where applicable.');
      return;
    }
    setBusy(true);
    setError('');
    try {await save(target,m ? {value:amount,source,remarks} : {fields:record,source,remarks},previous);}
    catch (e) {setError(e instanceof Error ? e.message : 'The entry could not be saved.');}
    finally {setBusy(false);}
  }
  return <dialog ref={node => {if (node && !node.open) node.showModal();}} aria-labelledby="edit-title"
    onCancel={event => {event.preventDefault(); if (!busy) close();}}>
    <h2 id="edit-title">{m?.label ?? def?.label}</h2>
    <p className="muted">{'metric' in target ? (target.period ? months[target.period-1] : 'Annual') + ' · ' + m?.unit : 'Annual reporting record'} · {m ? reference(m,'period' in target ? target.period : 0) : def?.range}</p>
    <form onSubmit={submit}>
      {m && (m.type === 'flag' ? <label>Used? (Yes/No)<select name="value" defaultValue={metricValue ?? ''}><option value="">Blank</option><option value={1}>Yes</option><option value={0}>No</option></select></label>
        : <label>Value<input name="value" type="number" min={0} max={Number.MAX_SAFE_INTEGER} step={m.type === 'count' ? 1 : 'any'} defaultValue={metricValue ?? ''}/></label>)}
      {def?.fields.map((field,i) => fixedContext?.[i] ? <p key={field} className="notice">{fixedContext[i]}</p> : <label key={field}>{field}{def.types[i] === 'text' ?
        <textarea name={'field'+i} maxLength={5000} defaultValue={fields[i] ?? ''}/> :
        <input name={'field'+i} type={def.types[i] === 'date' ? 'date' : 'text'} inputMode={def.types[i] === 'decimal' ? 'decimal' : undefined} defaultValue={fields[i] ?? ''}/>}</label>)}
      <label>Source<input name="source" maxLength={500} defaultValue={previous?.source} placeholder={m?.source}/></label>
      <label>Remarks<textarea name="remarks" maxLength={2000} defaultValue={previous?.remarks}/></label>
      {m?.note && <p className="muted">{m.note}</p>}
      {error && <p role="alert" className="notice">{error}</p>}
      <div className="dialog-actions"><button type="button" disabled={busy} onClick={close}>Cancel</button><button className="primary" disabled={busy}>{busy ? 'Saving…' : 'Save entry'}</button></div>
    </form>
  </dialog>;
}

