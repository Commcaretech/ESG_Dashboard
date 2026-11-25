export type Metric = {
  id: string; section: string; group: string; label: string; unit: string;
  type: string; rule: string; cells: string[]; output: string; reference?: string | null;
  source?: string; note?: string; depends?: string[] | null;
};
export type RecordDefinition = {
  id: string; section: string; label: string; range: string;
  fields: string[]; types: string[]; limit: number;
  cells: string[][]; fixed_context?: Record<string, Record<string, string | undefined>>;
};
export type Provenance = {source: string; remarks: string; updated_at: string};
export type MetricValue = Provenance & {metric_id: string; period: number; value: number | null};
export type Narrative = Provenance & {record_type: string; slot: number; fields: (string | null)[]};
export type Result = {value: number | null; known: number; expected: number};
export const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const allMonths = months.map((_, i) => i + 1);
export const key = (id: string, period: number) => id + ':' + period;
const sum = (numbers: number[]) => numbers.reduce((total, number) => total.plus(number), new Decimal(0)).toNumber();

export function createReport(metrics: Metric[], input: MetricValue[]) {
  const specs = new Map(metrics.map(m => [m.id, m]));
  const values = new Map(input.map(row => [key(row.metric_id, row.period), row]));
  const cache = new Map<string, Result>();

  function result(id: string, period: number): Result {
    const cacheKey = key(id, period);
    const prior = cache.get(cacheKey);
    if (prior) return prior;
    const metric = specs.get(id);
    if (!metric) throw new Error('Unknown metric definition');
    let stat: Result;
    if (metric.depends) {
      const parts = metric.depends.map(dependency => result(dependency, period));
      const known = parts.reduce((acc, part) => acc + part.known, 0);
      const expected = parts.reduce((acc, part) => acc + part.expected, 0);
      const [numerator, denominator] = parts;
      const value = metric.rule === 'ratio'
        ? known === expected && numerator.value !== null && denominator.value
          ? numerator.value / denominator.value * 100 : null
        : known ? sum(parts.map(part => part.value ?? 0)) : null;
      stat = {value, known, expected};
    } else {
      const periods = metric.rule === 'annual' ? [0] : period ? [period]
        : metric.rule === 'december' ? [12] : allMonths;
      const numbers = periods.map(p => values.get(key(id, p))?.value).filter((n): n is number => typeof n === 'number');
      stat = {value: numbers.length ? sum(numbers) : null, known: numbers.length, expected: periods.length};
    }
    cache.set(cacheKey, stat);
    return stat;
  }
  return {values, result};
}

export function display(metric: Metric, value: number | null) {
  if (value === null) return '—';
  if (metric.type === 'flag') return value === 1 ? 'Yes' : 'No';
  return value.toLocaleString('en-SG', {maximumFractionDigits: metric.unit === '%' ? 2 : 15}) + (metric.unit === '%' ? '%' : '');
}

export const hasChartData = (values: (number | null)[]) => values.some(value => value !== null);

export function csv(rows: (string | number | null)[][]) {
  return '\uFEFF' + rows.map(row => row.map(cell => {
    let value = String(cell ?? '');
    if (typeof cell === 'string' && (/^[\s\p{Cc}\p{Cf}]*[=+@\-＝＋＠－]/u.test(value) || /^[\t\r\n]/.test(value))) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
  }).join(',')).join('\r\n');
}

import Decimal from 'decimal.js-light';

