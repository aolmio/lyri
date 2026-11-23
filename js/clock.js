export class Clock {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.base = 0;
    this.start = 0;
    this.playing = false;
  }

  get position() {
    return this.playing ? this.base + (this.now() - this.start) / 1000 : this.base;
  }

  play() {
    if (this.playing) return;
    this.start = this.now();
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.base = this.position;
    this.playing = false;
  }

  stop() {
    this.playing = false;
    this.base = 0;
  }

  seek(t) {
    this.base = Math.max(0, Number(t) || 0);
    this.start = this.now();
  }

  nudge(d) {
    this.seek(this.position + d);
  }
}
