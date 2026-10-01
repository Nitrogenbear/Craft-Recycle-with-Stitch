// Row builders shared by CSV export and Google Sheets sync.
import { daysBetween, fmtDuration, hoursDecimal, jobMs, startOfWeekISO } from './util.js';

export function cell(job, col) {
  const ms = jobMs(job);
  switch (col) {
    case 'Job #': return job.ticket;
    case 'Client': return job.client.name;
    case 'Phone': return job.client.phone;
    case 'Email': return job.client.email;
    case 'Start Date': return job.startDate;
    case 'Due Date': return job.dueDate;
    case 'End Date': return job.finishedDate || '';
    case 'Service Type': return job.service;
    case 'Garments': return job.garments.length;
    case 'Description': return job.description;
    case 'Time Spent': return fmtDuration(ms, false);
    case 'Hours (decimal)': return hoursDecimal(ms);
    case 'Cost': return job.price === '' || job.price == null ? '' : Number(job.price);
    case 'Notes': return [job.instructions, ...job.contactLog.map((c) => c.note)].filter(Boolean).join(' | ');
    default: return '';
  }
}

export const jobRows = (jobs, columns) => [columns, ...jobs.map((j) => columns.map((c) => cell(j, c)))];

export function toCSV(rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(',')).join('\r\n');
}

export function timeLogRows(jobs, fromISO, toISO) {
  const rows = [['Job #', 'Client', 'Service Type', 'Garment', 'Date', 'Start', 'End', 'Duration', 'Hours (decimal)', 'Manual entry']];
  for (const j of jobs) {
    for (const g of j.garments) {
      for (const l of g.logs) {
        const day = l.date;
        if ((fromISO && day < fromISO) || (toISO && day > toISO)) continue;
        rows.push([
          j.ticket, j.client.name, j.service, g.label, day,
          l.start ? new Date(l.start).toLocaleTimeString('en-GB') : '',
          l.end ? new Date(l.end).toLocaleTimeString('en-GB') : '',
          fmtDuration(l.ms), hoursDecimal(l.ms), l.manual ? 'Yes' : '',
        ]);
      }
    }
  }
  return rows;
}

// Weekly or monthly summary of completed jobs
export function summaryRows(jobs, period = 'week') {
  const groups = new Map();
  for (const j of jobs) {
    if (j.status !== 'Completed' || !j.finishedDate) continue;
    const key = period === 'week' ? startOfWeekISO(j.finishedDate) : j.finishedDate.slice(0, 7);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(j);
  }
  const rows = [[period === 'week' ? 'Week starting' : 'Month', 'Jobs completed', 'Garments', 'Hours worked', 'Revenue (£)', 'Avg turnaround (days)']];
  [...groups.keys()].sort().reverse().forEach((k) => {
    const g = groups.get(k);
    const hours = g.reduce((s, j) => s + hoursDecimal(jobMs(j)), 0);
    const revenue = g.reduce((s, j) => s + (Number(j.price) || 0), 0);
    rows.push([k, g.length, g.reduce((s, j) => s + j.garments.length, 0), Math.round(hours * 100) / 100, revenue, avgTurnaround(g)]);
  });
  return rows;
}

export function avgTurnaround(jobs) {
  const done = jobs.filter((j) => j.finishedDate && j.startDate);
  if (!done.length) return '';
  const avg = done.reduce((s, j) => s + daysBetween(j.startDate, j.finishedDate), 0) / done.length;
  return Math.round(avg * 10) / 10;
}
