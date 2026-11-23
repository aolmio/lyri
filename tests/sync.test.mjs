import test from 'node:test';
import assert from 'node:assert/strict';
import { Clock } from '../js/clock.js';
import {
  fmtClock, hasTimes, buildTimeline, activeIndex, endTime, nextTarget, firstTarget,
  stampLine, restoreStamp, adjustLine, shiftAll, clearAll, toLrc, safeName
} from '../js/lrc.js';
import { parseLrc } from '../js/lyrics.js';

function fake() {
  let t = 0;
  return { now: () => t, advance: ms => { t += ms; } };
}

test('clock plays, pauses and stops', () => {
  const f = fake();
  const c = new Clock(f.now);
  assert.equal(c.position, 0);
  c.play();
  f.advance(2500);
  assert.equal(c.position, 2.5);
  c.pause();
  f.advance(5000);
  assert.equal(c.position, 2.5);
  c.play();
  f.advance(1000);
  assert.equal(c.position, 3.5);
  c.stop();
  assert.equal(c.position, 0);
  assert.equal(c.playing, false);
});

test('clock seeks and nudges while playing and paused', () => {
  const f = fake();
  const c = new Clock(f.now);
  c.play();
  f.advance(1000);
  c.seek(30);
  f.advance(500);
  assert.equal(c.position, 30.5);
  c.nudge(-0.5);
  assert.equal(c.position, 30);
  c.pause();
  c.nudge(2);
  assert.equal(c.position, 32);
  c.seek(-4);
  assert.equal(c.position, 0);
});

test('fmtClock formats minutes, seconds and fractions', () => {
  assert.equal(fmtClock(0), '00:00.0');
  assert.equal(fmtClock(65.34, 2), '01:05.34');
  assert.equal(fmtClock(0.29, 2), '00:00.29');
  assert.equal(fmtClock(599.99, 0), '09:59');
  assert.equal(fmtClock(-3), '00:00.0');
});

const LINES = () => [
  { text: 'one', t: 1 },
  { text: 'two', t: 4.5 },
  { text: '' },
  { text: 'three', t: 9 },
  { text: 'four' }
];

test('timeline and active line lookup', () => {
  const lines = LINES();
  const tl = buildTimeline(lines);
  assert.deepEqual(tl.map(x => x.i), [0, 1, 3]);
  assert.equal(activeIndex(tl, 0), -1);
  assert.equal(activeIndex(tl, 1), 0);
  assert.equal(activeIndex(tl, 4.49), 0);
  assert.equal(activeIndex(tl, 4.5), 1);
  assert.equal(activeIndex(tl, 100), 3);
  assert.equal(endTime(lines), 9);
  assert.equal(hasTimes(lines), true);
  assert.equal(hasTimes([{ text: 'a' }]), false);
  assert.equal(activeIndex([], 5), -1);
});

test('out of order stamps still resolve by time', () => {
  const lines = [{ text: 'a', t: 10 }, { text: 'b', t: 2 }];
  assert.equal(activeIndex(buildTimeline(lines), 3), 1);
  assert.equal(activeIndex(buildTimeline(lines), 11), 0);
});

test('tap targets skip blank lines', () => {
  const lines = LINES();
  assert.equal(firstTarget(lines), 4);
  assert.equal(nextTarget(lines, 1), 3);
  assert.equal(nextTarget(lines, 4), -1);
  clearAll(lines);
  assert.equal(firstTarget(lines), 0);
});

test('stamping, undoing, adjusting and shifting lines', () => {
  const lines = [{ text: 'a' }, { text: 'b', t: 5 }];
  const prevA = stampLine(lines, 0, 1.2345);
  assert.equal(prevA, undefined);
  assert.equal(lines[0].t, 1.23);
  const prevB = stampLine(lines, 1, 6);
  assert.equal(prevB, 5);
  restoreStamp(lines, 1, prevB);
  assert.equal(lines[1].t, 5);
  restoreStamp(lines, 0, prevA);
  assert.equal('t' in lines[0], false);
  assert.equal(adjustLine(lines, 0, 0.1), false);
  assert.equal(adjustLine(lines, 1, -0.1), true);
  assert.equal(lines[1].t, 4.9);
  shiftAll(lines, -10);
  assert.equal(lines[1].t, 0);
  assert.equal(stampLine(lines, 0, -3), undefined);
  assert.equal(lines[0].t, 0);
});

test('lrc export parses back with the same times and stanza gaps', () => {
  const song = { title: 'Demo', artist: 'Nobody', lines: LINES() };
  const lrc = toLrc(song);
  assert.match(lrc, /^\[ti:Demo\]\n\[ar:Nobody\]\n\[00:01\.00\]one\n\[00:04\.50\]two\n\[00:04\.51\]\n\[00:09\.00\]three\nfour\n$/);
  const back = parseLrc(lrc);
  assert.deepEqual(back.map(l => l.text), ['one', 'two', '', 'three']);
  assert.deepEqual(back.filter(l => l.text).map(l => l.t), [1, 4.5, 9]);
});

test('safe file names drop illegal characters', () => {
  assert.equal(safeName({ artist: 'A/B', title: 'C:D?' }), 'A B - C D');
  assert.equal(safeName({ lines: [] }), 'lyrics');
});
