// Geometry is in raw image coordinates, not mirrored display coordinates.
const PALM = [0, 5, 9, 13, 17];
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function describeHand(landmarks, width, height) {
  if (!Array.isArray(landmarks) || landmarks.length !== 21 || width <= 0 || height <= 0) return null;
  if (landmarks.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const pixels = landmarks.map(p => ({x: p.x * width, y: p.y * height}));
  const center = PALM.reduce((v, i) => ({x: v.x + pixels[i].x / PALM.length, y: v.y + pixels[i].y / PALM.length}), {x: 0, y: 0});
  const palmWidth = distance(pixels[5], pixels[17]);
  if (palmWidth < 5 || center.x < 0 || center.x > width || center.y < 0 || center.y > height) return null;
  return {center, palmWidth, nearEdge: landmarks.some(p => p.x < .025 || p.x > .975 || p.y < .025 || p.y > .975)};
}

export class MotionTracker {
  constructor(options = {}) {
    this.options = {enterSpeed: 1.0, exitSpeed: .55, minMotionMs: 350, settleMs: 300, maxGapMs: 300, smoothingMs: 100, ...options};
    this.tracks = new Map();
    this.nextId = 1;
    this.lastTime = null;
    this.absentStart = null;
  }
  configure(options) { Object.assign(this.options, options); }
  finishTrack(track, time, reason) {
    const start = track.motionStart;
    track.motionStart = null;
    track.quietStart = null;
    track.isMoving = false;
    if (start === null || time - start < this.options.minMotionMs) return null;
    return {type: 'hand_movement', track_id: track.id, start_ms: start, end_ms: time, duration_ms: time - start, peak_speed_palm_widths_s: track.peakSpeed, end_reason: reason};
  }
  update(items, time, width, height) {
    if (!Number.isFinite(time)) throw new TypeError('time must be milliseconds');
    if (this.lastTime !== null && time <= this.lastTime) return {hands: [], events: [], ignored: true};
    this.lastTime = time;
    const events = [];
    const detections = items.map(item => ({...item, geometry: describeHand(item.landmarks, width, height)})).filter(item => item.geometry);
    for (const track of this.tracks.values()) {
      if (time - track.lastSeen > this.options.maxGapMs) {
        const event = this.finishTrack(track, track.lastSeen, 'tracking_gap');
        if (event) events.push(event);
        this.tracks.delete(track.id);
      }
    }
    // At most two hands: test both assignments, rather than assuming model order is stable.
    const old = [...this.tracks.values()];
    const assigned = new Map();
    const candidates = [];
    for (let i = 0; i < detections.length; i++) {
      for (const track of old) {
        const separation = distance(detections[i].geometry.center, track.center);
        const limit = Math.max(width * .18, track.palmWidth * 4);
        if (separation < limit) candidates.push({i, track, separation});
      }
    }
    if (detections.length === 2 && old.length === 2) {
      const choices = [[old[0], old[1]], [old[1], old[0]]].map(pair => {
        const matches = pair.map((track, i) => candidates.find(c => c.i === i && c.track.id === track.id));
        return {matches, cost: matches.every(Boolean) ? matches.reduce((v, c) => v + c.separation, 0) : Infinity};
      }).sort((a, b) => a.cost - b.cost);
      if (Number.isFinite(choices[0].cost)) choices[0].matches.forEach(match => assigned.set(match.i, match.track));
    }
    if (!assigned.size) {
      const used = new Set();
      for (const candidate of candidates.sort((a, b) => a.separation - b.separation)) {
        if (!assigned.has(candidate.i) && !used.has(candidate.track.id)) {
          assigned.set(candidate.i, candidate.track);
          used.add(candidate.track.id);
        }
      }
    }
    const visible = [];
    for (let i = 0; i < detections.length; i++) {
      const item = detections[i];
      let track = assigned.get(i);
      let speed = null;
      if (!track) {
        track = {id: this.nextId++, center: {...item.geometry.center}, palmWidth: item.geometry.palmWidth, lastSeen: time, motionStart: null, quietStart: null, isMoving: false, peakSpeed: 0, trail: []};
        this.tracks.set(track.id, track);
      } else {
        const elapsed = time - track.lastSeen;
        const alpha = 1 - Math.exp(-elapsed / this.options.smoothingMs);
        const smoothed = {x: track.center.x + alpha * (item.geometry.center.x - track.center.x), y: track.center.y + alpha * (item.geometry.center.y - track.center.y)};
        const palmWidth = (track.palmWidth + item.geometry.palmWidth) / 2;
        speed = distance(smoothed, track.center) / palmWidth / (elapsed / 1000);
        track.center = smoothed;
        track.palmWidth = item.geometry.palmWidth;
        if (speed >= this.options.enterSpeed) {
          if (track.motionStart === null) { track.motionStart = time; track.peakSpeed = speed; }
          track.quietStart = null;
          track.peakSpeed = Math.max(track.peakSpeed, speed);
          if (time - track.motionStart >= this.options.minMotionMs) track.isMoving = true;
        } else if (track.motionStart !== null && speed <= this.options.exitSpeed) {
          if (track.quietStart === null) track.quietStart = time;
          if (time - track.quietStart >= this.options.settleMs) {
            const event = this.finishTrack(track, track.quietStart, 'settled');
            if (event) events.push(event);
          }
        } else if (track.motionStart !== null) {
          track.quietStart = null;
          track.peakSpeed = Math.max(track.peakSpeed, speed);
        }
      }
      track.lastSeen = time;
      track.trail.push({x: track.center.x, y: track.center.y, t: time});
      track.trail = track.trail.filter(p => time - p.t < 2000);
      visible.push({id: track.id, label: item.label, labelScore: item.labelScore, landmarks: item.landmarks, center: {...track.center}, palmWidth: track.palmWidth, speed, moving: track.isMoving, nearEdge: item.geometry.nearEdge, trail: [...track.trail]});
    }
    if (!visible.length && this.absentStart === null) this.absentStart = time;
    if (visible.length && this.absentStart !== null) {
      if (time - this.absentStart >= this.options.maxGapMs) events.push({type: 'hands_unobserved', start_ms: this.absentStart, end_ms: time, duration_ms: time - this.absentStart, reason: 'not_detected_not_proof_of_no_activity'});
      this.absentStart = null;
    }
    return {hands: visible, events, ignored: false};
  }
  flush(time) {
    const events = [];
    for (const track of this.tracks.values()) {
      const event = this.finishTrack(track, Math.min(time, track.lastSeen), 'session_end');
      if (event) events.push(event);
    }
    if (this.absentStart !== null && time - this.absentStart >= this.options.maxGapMs) events.push({type: 'hands_unobserved', start_ms: this.absentStart, end_ms: time, duration_ms: time - this.absentStart, reason: 'not_detected_not_proof_of_no_activity'});
    this.absentStart = null;
    return events;
  }
}

export function toCsv(rows, columns) {
  const quote = value => {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + [columns.map(quote).join(','), ...rows.map(row => columns.map(key => quote(row[key])).join(','))].join('\r\n');
}
