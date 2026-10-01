import { useState } from 'react';
import { Modal, useApp } from '../ui.jsx';
import { fmtDateTime, fmtDuration, garmentMs, jobMs, waNumber } from '../util.js';

const QUICK_NOTES = ['Left voicemail', 'Sent text', 'Sent WhatsApp', 'Emailed', 'Spoke — collecting soon', 'No answer'];

export default function ContactPanel({ jobId, garmentId, onClose }) {
  const { state, actions } = useApp();
  const job = state.jobs.find((j) => j.id === jobId);
  const [note, setNote] = useState('');
  const [copied, setCopied] = useState('');
  if (!job) return null;

  const garment = job.garments.find((g) => g.id === garmentId);
  const allDone = job.garments.every((g) => g.done);
  const remaining = job.garments.filter((g) => !g.done).length;
  const first = job.client.name.split(' ')[0];
  const message = `Hi ${first}, your ${job.service.toLowerCase()} job (${job.ticket}) is ready to collect from Craft, Recycle with Stitch. Let me know when suits you. Thanks, Carla`;

  const copy = async (text, what) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = Object.assign(document.createElement('textarea'), { value: text });
      document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
    }
    setCopied(what);
    setTimeout(() => setCopied(''), 1500);
  };
  const log = (text) => {
    actions.addContactNote(job.id, text);
    setNote('');
    actions.toast('Contact note saved');
  };

  return (
    <Modal title={garment ? `${garment.label} complete` : `Contact ${job.client.name}`} onClose={onClose}>
      {garment && (
        <div className="garment-summary">
          <div>
            <div className="muted small">Time on this garment</div>
            <div className="big mono">{fmtDuration(garmentMs(garment))}</div>
            <div className="muted small">{garment.logs.length} session{garment.logs.length === 1 ? '' : 's'}</div>
          </div>
          <div>
            <div className="muted small">Job total</div>
            <div className="big mono">{fmtDuration(jobMs(job))}</div>
            <div className="muted small">{allDone ? 'All garments done' : `${remaining} garment${remaining > 1 ? 's' : ''} left`}</div>
          </div>
        </div>
      )}

      <div className="contact-hero">
        <div className="contact-name">{job.client.name} <span className="muted">{job.ticket}</span></div>
        <div className="contact-phone">
          <a href={`tel:${job.client.phone}`}>{job.client.phone}</a>
          <button className="btn small" onClick={() => copy(job.client.phone, 'phone')}>{copied === 'phone' ? '✓ Copied' : 'Copy'}</button>
        </div>
        {job.client.email && (
          <div className="contact-email">
            <a href={`mailto:${job.client.email}`}>{job.client.email}</a>
            <button className="btn small" onClick={() => copy(job.client.email, 'email')}>{copied === 'email' ? '✓ Copied' : 'Copy'}</button>
          </div>
        )}
        <div className="best-time">
          🕐 Best time to contact: <strong>{job.client.bestTime || 'not recorded'}</strong>
        </div>
      </div>

      <div className="contact-actions">
        <a className="btn primary" href={`tel:${job.client.phone}`}>📞 Call</a>
        <a className="btn" href={`sms:${job.client.phone}?&body=${encodeURIComponent(message)}`}>💬 Text</a>
        <a className="btn" href={`https://wa.me/${waNumber(job.client.phone)}?text=${encodeURIComponent(message)}`} target="_blank" rel="noreferrer">WhatsApp</a>
        {job.client.email && (
          <a className="btn" href={`mailto:${job.client.email}?subject=${encodeURIComponent(`Your order ${job.ticket} is ready`)}&body=${encodeURIComponent(message)}`}>✉ Email</a>
        )}
        <button className="btn ghost" onClick={() => copy(message, 'msg')}>{copied === 'msg' ? '✓ Message copied' : 'Copy message'}</button>
      </div>

      <div className="note-box">
        <div className="field-label">Log a quick note</div>
        <div className="quick-dates">
          {QUICK_NOTES.map((n) => <button key={n} className="chip" onClick={() => log(n)}>{n}</button>)}
        </div>
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); log(note); }}>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Other note…" />
          <button className="btn" disabled={!note.trim()}>Save</button>
        </form>
        {job.contactLog.length > 0 && (
          <ul className="contact-log">
            {[...job.contactLog].reverse().slice(0, 4).map((c) => <li key={c.id}><span className="muted small">{fmtDateTime(c.at)}</span> {c.note}</li>)}
          </ul>
        )}
      </div>

      <div className="form-actions">
        {allDone && job.status !== 'Ready for Pickup' && job.status !== 'Completed' && (
          <button className="btn primary" onClick={() => actions.setStatus(job.id, 'Ready for Pickup')}>Mark job ready for pickup</button>
        )}
        {job.status === 'Ready for Pickup' && (
          <button className="btn primary" onClick={() => { actions.setStatus(job.id, 'Completed'); onClose(); }}>✓ Collected — complete job</button>
        )}
        <button className="btn" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
