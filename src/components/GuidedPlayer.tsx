import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Tone from 'tone';
import type { GestureTarget, MatchReport, Song, SongEvent } from '../lib/types';
import { DEGREE_LABELS } from '../lib/types';
import type { TrackingStatus } from '../lib/useHandTracking';
import { compareFrame, qualityLabel, targetNotes } from '../lib/match';
import { audioContextFromTone, GSVoice } from '../lib/gsVoice';
import { isThumbsUp, thumbsUpDebug, wristTilt } from '../lib/gesture';
import { NodDetector } from '../lib/nod';
import { Tracker, type TrackerBridge } from './Tracker';
import { DEGREE_FINGERS, HandShape, qualityFingers } from './HandShape';
import './Player.css';

const SECTION_BARS = 2;
const HOLD_MS = 350;
const ADVANCE_MS = 650;
const THUMB_HOLD_MS = 800;

const STATUS_LABEL: Record<TrackingStatus, string> = {
  idle: 'Waiting for camera…',
  requesting: 'Requesting camera…',
  'loading-model': 'Loading hand model…',
  ready: 'Camera ready',
  error: 'Camera error',
  'no-camera': 'No camera found',
};

interface SectionEvent {
  ev: SongEvent;
  index: number;
}

interface Section {
  barStart: number;
  barEnd: number;
  events: SectionEvent[];
}

type GuidedPhase = 'stepping' | 'section-done' | 'done';

interface StepRecord {
  skipped: boolean;
  ms: number;
}

function buildSections(song: Song): Section[] {
  const sections: Section[] = [];
  song.events.forEach((ev, index) => {
    const s = Math.floor((ev.bar - 1) / SECTION_BARS);
    let section = sections[s];
    if (!section) {
      section = {
        barStart: s * SECTION_BARS + 1,
        barEnd: ev.bar,
        events: [],
      };
      sections[s] = section;
    }
    section.barEnd = Math.max(section.barEnd, ev.bar);
    section.events.push({ ev, index });
  });
  return sections;
}

function reportSig(r: MatchReport | null): string {
  return r ? `${r.degree}${r.world}${r.quality}${r.octave}` : '';
}

/**
 * Live wrist-tilt gauge. The needle FOLLOWS the mirrored camera view (lean
 * left → needle left), so for the left hand "major" sits on the left end and
 * "minor" on the right — matching the guide caption. `want` shades the half
 * the current chord needs; the needle turns mint once inside it.
 */
function TiltGauge({
  value,
  want,
  endLabels,
}: {
  value: number;
  want: 'major' | 'minor' | null;
  endLabels: [string, string] | null;
}) {
  const inZone = want ? (want === 'major' ? value >= 0 : value < 0) : false;
  return (
    <div className="tilt-gauge">
      {endLabels && <span className="tilt-word">{endLabels[0]}</span>}
      <span className="tilt-track">
        <i className={`half l${want === 'major' ? ' want' : ''}`} />
        <i className={`half r${want === 'minor' ? ' want' : ''}`} />
        <i className="tilt-deadzone" />
        <i
          className={`tilt-needle${want ? (inZone ? ' good' : ' off') : ''}`}
          style={{ left: `${50 - value * 50}%` }}
        />
      </span>
      {endLabels && <span className="tilt-word">{endLabels[1]}</span>}
    </div>
  );
}


export default function GuidedPlayer({
  song,
  onExit,
  onStartTimed,
}: {
  song: Song;
  onExit: () => void;
  onStartTimed?: () => void;
}) {
  const sections = useMemo(() => buildSections(song), [song]);

  const [phase, setPhase] = useState<GuidedPhase>('stepping');
  const [sectionIdx, setSectionIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [justCompleted, setJustCompleted] = useState(false);
  const [volumePct, setVolumePct] = useState(0);
  const [records, setRecords] = useState<StepRecord[][]>([]);
  const [trackingStatus, setTrackingStatus] = useState<TrackingStatus>('idle');
  const [trackingError, setTrackingError] = useState<string | null>(null);
  const [thumbPct, setThumbPct] = useState(0);
  // Live wrist tilts for the guide gauges (left = major/minor aim, right = tone).
  const [tilts, setTilts] = useState({ left: 0, right: 0 });
  const [thumbDebug, setThumbDebug] = useState<string | null>(null); // TEMP

  const section = sections[sectionIdx];
  const current: SectionEvent | null = phase === 'stepping' ? section?.events[stepIdx] ?? null : null;
  const target: GestureTarget | null = current ? current.ev.target : null;

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const sectionIdxRef = useRef(sectionIdx);
  sectionIdxRef.current = sectionIdx;
  const stepIdxRef = useRef(stepIdx);
  stepIdxRef.current = stepIdx;
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const frameBridge = useRef<TrackerBridge>({ frameRef: null, videoRef: null, landmarksRef: null });
  const voiceRef = useRef<GSVoice | null>(null);
  const reportRef = useRef<MatchReport | null>(null);
  const targetRef = useRef<GestureTarget | null>(null);
  const holdSinceRef = useRef<number | null>(null);
  const thumbSinceRef = useRef<number | null>(null);
  const thumbPrevRef = useRef<{ x: number; y: number }[] | null>(null);
  const nodRef = useRef({ left: new NodDetector(), right: new NodDetector() });
  const nodLastTRef = useRef<number | null>(null);
  const advanceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stepStartedAtRef = useRef<number>(performance.now());
  const reportStateSigRef = useRef('');

  targetRef.current = target;

  // Audio voice, created on mount (mount is triggered by a user click).
  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await Tone.start();
      } catch {
        // audio stays muted; practice continues silently
      }
      if (mounted) {
        voiceRef.current = new GSVoice(audioContextFromTone(() => Tone.getContext()));
      }
    })();
    return () => {
      mounted = false;
      voiceRef.current?.dispose();
      voiceRef.current = null;
    };
  }, []);

  const recordStep = useCallback((skipped: boolean) => {
    const ms = performance.now() - stepStartedAtRef.current;
    setRecords((prev) => {
      const next = prev.map((r) => r.slice());
      const s = sectionIdxRef.current;
      if (!next[s]) next[s] = [];
      next[s][stepIdxRef.current] = { skipped, ms };
      return next;
    });
  }, []);

  const advance = useCallback(() => {
    const s = sectionIdxRef.current;
    const sec = sectionsRef.current[s];
    setJustCompleted(false);
    holdSinceRef.current = null;
    if (stepIdxRef.current + 1 < sec.events.length) {
      stepStartedAtRef.current = performance.now();
      setStepIdx(stepIdxRef.current + 1);
    } else {
      voiceRef.current?.stopAll();
      setPhase(s + 1 < sectionsRef.current.length ? 'section-done' : 'done');
    }
  }, []);

  const scheduleAdvance = useCallback(() => {
    if (advanceTimerRef.current) return;
    advanceTimerRef.current = setTimeout(() => {
      advanceTimerRef.current = null;
      advance();
    }, ADVANCE_MS);
  }, [advance]);

  const skip = useCallback(() => {
    if (phaseRef.current !== 'stepping') return;
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    recordStep(true);
    advance();
  }, [advance, recordStep]);

  // Thumbs-up during stepping: close out the section, counting the remaining
  // chords as skipped, and show the section-complete (or final done) screen.
  const skipRestOfSection = useCallback(() => {
    if (advanceTimerRef.current) {
      clearTimeout(advanceTimerRef.current);
      advanceTimerRef.current = null;
    }
    const s = sectionIdxRef.current;
    const total = sectionsRef.current[s].events.length;
    setRecords((prev) => {
      const next = prev.map((r) => r.slice());
      if (!next[s]) next[s] = [];
      for (let i = stepIdxRef.current; i < total; i++) next[s][i] = { skipped: true, ms: 0 };
      return next;
    });
    voiceRef.current?.stopAll();
    holdSinceRef.current = null;
    setPhase(s + 1 < sectionsRef.current.length ? 'section-done' : 'done');
  }, []);

  const repeatSection = useCallback(() => {
    voiceRef.current?.stopAll();
    holdSinceRef.current = null;
    stepStartedAtRef.current = performance.now();
    setStepIdx(0);
    setPhase('stepping');
  }, []);

  const nextSection = useCallback(() => {
    holdSinceRef.current = null;
    stepStartedAtRef.current = performance.now();
    setSectionIdx((i) => i + 1);
    setStepIdx(0);
    setPhase('stepping');
  }, []);

  const jumpToSection = useCallback((i: number) => {
    voiceRef.current?.stopAll();
    holdSinceRef.current = null;
    stepStartedAtRef.current = performance.now();
    setSectionIdx(i);
    setStepIdx(0);
    setPhase('stepping');
  }, []);

  // Live loop: match detection + instrument voice (sustained chord, wrist
  // volume, filter sweep) + hold-to-complete.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);

      // 👍 Thumbs-up = skip to the next section. Two gates:
      //  1. k-NN pose match (isThumbsUp — prototype-learned, both hands).
      //  2. STABILITY: the pose must be nearly motionless. A deliberate 👍 is
      //     held rock-steady; the false positives we chased were transient
      //     EMA-blended poses while MOVING between chord shapes — those never
      //     appear in static captures but can sit in the thumbs-up region for
      //     a slow transition. Movement resets the hold timer.
      const ph = phaseRef.current;
      if (ph === 'stepping' || ph === 'section-done') {
        // Either hand may flash the skip gesture.
        const hands = frameBridge.current.landmarksRef?.current;
        const firingHand = hands?.right && isThumbsUp(hands.right) ? hands.right
          : hands?.left && isThumbsUp(hands.left) ? hands.left
          : null;
        let stable = false;
        if (firingHand) {
          const span =
            Math.hypot(firingHand[9].x - firingHand[0].x, firingHand[9].y - firingHand[0].y) || 1e-6;
          const prev = thumbPrevRef.current;
          if (prev) {
            let move = 0;
            for (let i = 0; i < 21; i++)
              move += Math.hypot(firingHand[i].x - prev[i].x, firingHand[i].y - prev[i].y);
            move /= 21 * span;
            stable = move < 0.015; // <1.5% of hand span/frame = deliberate hold
          }
          thumbPrevRef.current = firingHand.map((p) => ({ x: p.x, y: p.y }));
        } else {
          thumbPrevRef.current = null;
        }
        const up = firingHand !== null && stable;
        if (up) {
          if (thumbSinceRef.current === null) thumbSinceRef.current = performance.now();
          const heldMs = performance.now() - thumbSinceRef.current;
          const pct = Math.min(100, Math.round((heldMs / THUMB_HOLD_MS) * 100));
          setThumbPct((p) => (p === pct ? p : pct));
          if (heldMs >= THUMB_HOLD_MS) {
            thumbSinceRef.current = null;
            setThumbPct(0);
            if (ph === 'stepping') skipRestOfSection();
            else nextSection();
          }
        } else if (thumbSinceRef.current !== null) {
          thumbSinceRef.current = null;
          setThumbPct(0);
        }
      }

      // Live tilt readouts for the guide gauges (quantized — re-render at
      // most ~50/side per second, only on change).
      const lmk = frameBridge.current.landmarksRef?.current;
      const ql = Math.round((lmk?.left ? wristTilt(lmk.left, 'Left') : 0) * 25) / 25;
      const qr = Math.round((lmk?.right ? wristTilt(lmk.right, 'Right') : 0) * 25) / 25;
      setTilts((p) => (p.left === ql && p.right === qr ? p : { left: ql, right: qr }));

      // Debug: live k-NN distance/votes for the on-screen readout (either hand).
      {
        const rl = lmk?.right ?? lmk?.left ?? null;
        const td = thumbsUpDebug(rl);
        setThumbDebug((prev) => {
          const next = td
            ? `${td.hit ? '🔥 ' : ''}dist ${td.dist.toFixed(2)} (cap 0.48) · votes ${td.votes}/3`
            : null;
          return prev === next ? prev : next;
        });
      }

      if (phaseRef.current !== 'stepping') {
        if (reportRef.current) reportRef.current = null;
        return;
      }
      const voice = voiceRef.current;
      const frame = frameBridge.current.frameRef?.current ?? null;
      const sec = sectionsRef.current[sectionIdxRef.current];
      const cur = sec?.events[stepIdxRef.current] ?? null;
      const tgt = cur ? cur.ev.target : null;
      const rep = tgt ? compareFrame(frame, tgt) : null;
      reportRef.current = rep;

      // Publish to React only when the visible state actually changes.
      const sig = reportSig(rep);
      if (sig !== reportStateSigRef.current) {
        reportStateSigRef.current = sig;
        setReport(rep);
      }
      const vol = frame?.right?.volume ?? 0;
      setVolumePct((prev) => (Math.abs(prev - vol * 100) > 2 ? Math.round(vol * 100) : prev));

      if (!voice) return;
      if (frame?.right) voice.updateFilterSweep(frame.right.tone);
      // Nod articulation (ours): forward flick re-attacks, backward chokes.
      {
        const now = performance.now();
        const dt = Math.min(0.1, (now - (nodLastTRef.current ?? now)) / 1000);
        nodLastTRef.current = now;
        const lmk = frameBridge.current.landmarksRef?.current;
        for (const hand of ['left', 'right'] as const) {
          const ev = nodRef.current[hand].update(lmk?.[hand] ?? null, now, dt);
          if (ev === 'forward') voice.articulate();
          else if (ev === 'backward') voice.choke();
        }
      }
      if (rep && rep.score >= 1 && cur) {
        voice.playNotes(targetNotes(cur.ev.target, cur.ev.chordName));
        voice.setVolume(frame?.right?.volume ?? 0.5);
        if (holdSinceRef.current === null) {
          holdSinceRef.current = performance.now();
        } else if (performance.now() - holdSinceRef.current >= HOLD_MS) {
          holdSinceRef.current = null;
          recordStep(false);
          setJustCompleted(true);
          scheduleAdvance();
        }
      } else {
        voice.setVolume(0);
        holdSinceRef.current = null;
      }
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      voiceRef.current?.stopAll();
    };
  }, [recordStep, scheduleAdvance, skipRestOfSection, nextSection]);

  // Escape exits guided practice.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') onExit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onExit]);

  const totalEvents = song.events.length;
  const allRecords = records.flat();
  const completedCount = allRecords.filter((r) => r && !r.skipped).length;
  const skippedCount = allRecords.filter((r) => r && r.skipped).length;
  const totalMs = allRecords.reduce((acc, r) => acc + (r?.ms ?? 0), 0);
  const sectionRecords = records[sectionIdx] ?? [];
  const degreeColor = target ? `var(--deg-${target.degree})` : 'var(--mint)';

  const chips = target
    ? ([
        ['DEG', DEGREE_LABELS[target.degree], report?.degree],
        ['WORLD', target.world, report?.world],
        ['QUAL', qualityLabel(target.world, target.quality), report?.quality],
        ['OCT', target.octave === 0 ? 'base' : '−1', report?.octave],
      ] as [string, string, boolean | undefined][])
    : [];

  return (
    <div className="player has-camera guided">
      <header className="player-header">
        <div>
          <h1 className="title">{song.title}</h1>
          <p className="meta">
            {song.artist} — {song.key} · {song.bpm} BPM · guided practice
          </p>
        </div>
        <span className="phase" data-phase="playing">
          Guided
        </span>
      </header>

      <Tracker
        bridge={frameBridge}
        onStatus={setTrackingStatus}
        onError={setTrackingError}
        reportRef={reportRef}
        targetRef={targetRef}
      />


      {phase === 'stepping' && current && target && (
        <div className="stage guided-stage">
          <section className={`guide${justCompleted ? ' complete' : ''}`}>
            <div className="guide-head">
              <span className="guide-chord">{current.ev.chordName}</span>
              <span className="guide-pos">
                Section {sectionIdx + 1}/{sections.length} · chord {stepIdx + 1}/
                {section.events.length}
              </span>
            </div>
            <div className="guide-hands">
              <div className="guide-hand">
                <HandShape
                  side="left"
                  fingers={DEGREE_FINGERS[target.degree]}
                  tiltDeg={target.world === 'minor' ? 18 : -18}
                  color={degreeColor}
                />
                <TiltGauge value={tilts.left} want={target.world} endLabels={['major', 'minor']} />
                <p className="hand-caption">
                  <strong>Left</strong> · {DEGREE_LABELS[target.degree]} · tilt{' '}
                  {target.world === 'minor' ? 'right' : 'left'} ({target.world})
                </p>
              </div>
              <div className="guide-hand">
                <HandShape
                  side="right"
                  fingers={qualityFingers(target.quality, target.octave !== 0)}
                  color="rgb(255, 107, 90)"
                />
                {/* Sign-flipped so the needle follows the right hand in the
                    mirror AND bright lands on the right end (their mapping:
                    wrist leaning screen-right = brighter). */}
                <TiltGauge value={-tilts.right} want={null} endLabels={['dark', 'bright']} />
                <p className="hand-caption">
                  <strong>Right</strong> · {qualityLabel(target.world, target.quality)} · thumb{' '}
                  {target.octave === 0 ? 'in (base)' : 'out (−8ve)'} · tone free
                </p>
              </div>
            </div>
            <div className="feedback guide-feedback">
              <div className="chips">
                {chips.map(([label, text, match]) => (
                  <div
                    key={label}
                    className={`chip ${match === undefined ? 'gray' : match ? 'ok' : 'no'}`}
                  >
                    <span className="chip-label">{label}</span>
                    <span className="chip-target">{text}</span>
                  </div>
                ))}
              </div>
              <div
                className="volume"
                role="meter"
                aria-label="Right hand volume"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={volumePct}
              >
                <div className="volume-fill" style={{ height: `${volumePct}%` }} />
              </div>
            </div>
            {trackingStatus !== 'ready' ? (
              <p className={`status ${trackingStatus}`}>
                {trackingStatus === 'no-camera'
                  ? 'No camera found — guided practice needs hand tracking.'
                  : trackingStatus === 'error'
                    ? `Camera error${trackingError ? `: ${trackingError}` : ''}`
                    : STATUS_LABEL[trackingStatus]}
              </p>
            ) : (
              <p className="guide-hint">Hold the shape until it clicks — take your time.</p>
            )}
            <div className="guide-actions">
              <button type="button" className="guide-skip" onClick={skip}>
                Skip this chord →
              </button>
              <span className={`thumb-hint${thumbPct > 0 ? ' active' : ''}`}>
                👍 hold to skip section (either hand)
                <span className="thumb-meter" aria-hidden="true">
                  <i style={{ width: `${thumbPct}%` }} />
                </span>
              </span>
            </div>
            {thumbDebug && (
              <p className="thumb-debug" aria-hidden="true">
                {thumbDebug}
              </p>
            )}
          </section>

          <div className="chart guided-chart">
            <div className="section-pills">
              {sections.map((s, i) => (
                <button
                  key={s.barStart}
                  type="button"
                  className={`section-pill${i === sectionIdx ? ' active' : ''}${
                    (records[i]?.length ?? 0) >= s.events.length ? ' done' : ''
                  }`}
                  onClick={() => jumpToSection(i)}
                >
                  {s.barStart}–{s.barEnd}
                </button>
              ))}
            </div>
            {section.events.map(({ ev, index }, i) => {
              const rec = sectionRecords[i];
              const cls = [
                'row',
                i === stepIdx ? 'active' : rec ? (rec.skipped ? 'skipped' : 'done') : 'future',
              ].join(' ');
              return (
                <div className={cls} data-ev={index} key={index}>
                  <span className="beat">
                    {ev.bar}.{ev.beat}
                  </span>
                  <span className="chord">{ev.chordName}</span>
                  <span className={`deg deg-${ev.target.degree}`}>
                    {DEGREE_LABELS[ev.target.degree]}
                  </span>
                  <span className={`world ${ev.target.world}`}>{ev.target.world}</span>
                  <span className="qual">{qualityLabel(ev.target.world, ev.target.quality)}</span>
                  <span className="oct">{ev.target.octave === 0 ? '·' : '−1'}</span>
                  <span className={`dot ${rec ? (rec.skipped ? 'miss' : 'hit') : ''}`} />
                </div>
              );
            })}
          </div>

          <div className="playbar">
            <button type="button" className="stop-btn" onClick={onExit}>
              Stop
            </button>
            <span className="position">
              Bars {section.barStart}–{section.barEnd}
            </span>
            <span className="stats">
              {completedCount}/{totalEvents} matched
              {skippedCount > 0 ? ` · ${skippedCount} skipped` : ''}
            </span>
          </div>
        </div>
      )}


      {phase === 'section-done' && (
        <section className="screen guided-screen">
          <h2>Section {sectionIdx + 1} complete</h2>
          <p className="lede">
            Bars {section.barStart}–{section.barEnd} ·{' '}
            {sectionRecords.filter((r) => r && !r.skipped).length}/{section.events.length} matched
            {sectionRecords.some((r) => r?.skipped)
              ? ` · ${sectionRecords.filter((r) => r?.skipped).length} skipped`
              : ''}
          </p>
          <div className="done-actions">
            <button type="button" className="start-btn section-next" onClick={nextSection}>
              Next section
            </button>
            <button type="button" className="back section-repeat" onClick={repeatSection}>
              Repeat this section
            </button>
          </div>
          <p className={`thumb-hint${thumbPct > 0 ? ' active' : ''}`}>
            👍 or hold a thumbs-up for the next section
            <span className="thumb-meter" aria-hidden="true">
              <i style={{ width: `${thumbPct}%` }} />
            </span>
          </p>
        </section>
      )}

      {phase === 'done' && (
        <section className="screen done">
          <h2>Guided practice complete</h2>
          <p className="lede">
            {song.title} — {completedCount}/{totalEvents} chords matched
            {skippedCount > 0 ? ` · ${skippedCount} skipped` : ''} ·{' '}
            {Math.round(totalMs / 1000)}s of hands-on time.
          </p>
          <div className="done-actions">
            {onStartTimed && (
              <button type="button" className="start-btn timed-offer" onClick={onStartTimed}>
                Try a timed run →
              </button>
            )}
            <button
              type="button"
              className="start-btn"
              onClick={() => {
                setRecords([]);
                setSectionIdx(0);
                setStepIdx(0);
                setPhase('stepping');
                stepStartedAtRef.current = performance.now();
              }}
            >
              Practice again
            </button>
            <button type="button" className="back" onClick={onExit}>
              Back to start
            </button>
            <a className="back" href="/">
              Back to songs
            </a>
          </div>
        </section>
      )}
    </div>
  );
}

