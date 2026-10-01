// Sample data so the app can be tried out before real jobs go in. Every item is tagged demo: true.
import { addDaysISO, todayISO, uid } from './util.js';

const MIN = 60000;

function garments(labels, minutesEach = [], doneUpTo = 0) {
  const now = Date.now();
  return labels.map((label, i) => {
    const mins = minutesEach[i] || 0;
    return {
      id: uid(), label, done: i < doneUpTo, completedAt: i < doneUpTo ? now - (labels.length - i) * 3600000 : null, runningSince: null,
      logs: mins ? [{ id: uid(), start: now - 86400000, end: now - 86400000 + mins * MIN, ms: mins * MIN, date: addDaysISO(todayISO(), -1) }] : [],
    };
  });
}

export function demoState(settings) {
  const t = todayISO();
  const d = (n) => addDaysISO(t, n);
  const mk = (n, o) => ({
    id: uid(), ticket: `CRS-${String(n).padStart(4, '0')}`, createdAt: Date.now() - n * 1000, finishedDate: null, collectedDate: null,
    instructions: '', contactLog: [], synced: false, demo: true, ...o,
  });
  const jobs = [
    mk(1, { client: { name: 'Priya Shah', phone: '07700 900123', email: 'priya@example.com', address: '12 Mill Lane', bestTime: 'After 5pm' },
      service: 'Alterations', description: 'Hem two pairs of jeans, taper legs', instructions: 'Customer prefers a narrow hem, keep original hem stitching',
      startDate: d(-6), dueDate: d(-1), status: 'In Progress', price: 28, garments: garments(['Blue jeans', 'Black jeans'], [42, 0], 1) }),
    mk(2, { client: { name: 'Tom Okafor', phone: '07700 900456', email: 'tom@example.com', address: '', bestTime: 'Weekday mornings' },
      service: 'Repairs', description: 'Replace broken zip on winter coat', startDate: d(-3), dueDate: d(1), status: 'New', price: 22, garments: garments(['Winter coat']) }),
    mk(3, { client: { name: 'Ellen Marsh', phone: '07700 900789', email: 'ellen@example.com', address: '4 Church Row', bestTime: 'Any time' },
      service: 'Made-to-Measure', description: 'Linen summer dress, A-line, mid-calf', startDate: d(-10), dueDate: d(9), status: 'In Progress', price: 140,
      garments: garments(['Dress'], [185]) }),
    mk(4, { client: { name: 'Sam Rivers', phone: '07700 900321', email: '', address: '', bestTime: 'Text first' },
      service: 'Upcycling', description: 'Tote bag from old denim jackets', startDate: d(-5), dueDate: d(0), status: 'Ready for Pickup', price: 35,
      finishedDate: d(-1), garments: garments(['Tote bag'], [95], 1) }),
    mk(5, { client: { name: 'Priya Shah', phone: '07700 900123', email: 'priya@example.com', address: '12 Mill Lane', bestTime: 'After 5pm' },
      service: 'Alterations', description: 'Take in waist on two skirts', startDate: d(-14), dueDate: d(-8), status: 'Completed', price: 24,
      finishedDate: d(-9), collectedDate: d(-8), garments: garments(['Grey skirt', 'Floral skirt'], [35, 28], 2) }),
  ];
  const tasks = [
    { id: uid(), title: 'Order 20cm brass zips', priority: 'High', due: t, jobId: jobs[1].id, done: false, createdAt: Date.now(), demo: true },
    { id: uid(), title: 'Book fitting with Ellen', priority: 'Medium', due: d(2), jobId: jobs[2].id, done: false, createdAt: Date.now(), demo: true },
    { id: uid(), title: 'Buy denim needles', priority: 'Low', due: '', jobId: '', done: false, createdAt: Date.now(), demo: true },
  ];
  return { version: 1, jobs, tasks, settings: { ...settings, nextTicket: Math.max(settings.nextTicket, 6) } };
}
