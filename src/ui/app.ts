import { applyAction, type Action, type Intent } from '../core/actions';
import { advise, type Advice } from '../core/advisor';
import { forecastResolution, type ResolutionForecast } from '../core/forecast';
import { DIFFICULTIES, K_MANUAL, K_REC, R_BASE, SPECIES, type Difficulty } from '../core/config';
import { buildingCost, energyCapacity, producerOutput, salvageYield } from '../core/economy/formulas';
import { EventBus, type GameEvent } from '../core/events';
import { isTerminal } from '../core/phases';
import { deserialize, serialize } from '../core/save';
import {
  cleansePreview,
  forecast,
  pollutionBand,
  previewSprite,
  previewTool,
  summary,
  tileInfo,
  TOOLS,
  toolBasePrice,
  toolGroup,
  toolId,
  toolIntent,
  floraSprite,
  worldProgress,
  worldStage,
  type Tool,
  type WorldStage,
} from '../core/selectors';
import { createGame, type GameState } from '../core/state';
import { totalBatteryLevel } from '../core/systems/energy';
import { getLang, onLangChange, setLang, t, type Lang, type TranslationKey } from '../i18n';
import { EMIT_DELAY, FxLayer, sourcesFromState } from '../render/fx';
import { mixHex, paletteFor, shadeHex } from '../render/palette';
import { LENSES, Renderer, rangeFor, TILE, ZOOM, type Lens } from '../render/renderer';
import { spriteCanvas, spriteDataUrl } from '../render/sprites';
import { ACHIEVEMENTS, parseAchievements, unlockedBy, type AchievementId } from './achievements';
import { Audio } from './audio';
import { chartElement, chartModel } from './chart';
import { $, clear, h } from './dom';
import { icon, type IconName } from './icons';
import { Music } from './music';
import { parseRecords, recordGame, type RecordUpdate, type Records } from './records';
import {
  actionForCode,
  defaultSettings,
  KEY_ACTIONS,
  keyLabel,
  parseSettings,
  rebind,
  SCALES,
  DEFAULT_KEYS,
  type KeyAction,
  type Settings,
} from './settings';
import { readStore, removeStore, writeStore } from './storage';
import { applyTheme, THEMES } from './theme';

const SAVE_KEY = 'terra-revival:save';
const SETTINGS_KEY = 'terra-revival:settings';
const ACH_KEY = 'terra-revival:achievements';
const RECORDS_KEY = 'terra-revival:records';
const LOG_LIMIT = 60;
/** How long the turn-report chips stay next to the values (R-11.19). */
const DELTA_MS = 6000;
const STAGE_ORDER: Record<WorldStage, number> = { collapse: 0, transition: 1, revival: 2 };

/** Palette tool id for a suggested move (hint "Show me"). */
function toolIdOf(intent: Exclude<Intent, { kind: 'endTurn' }>): string {
  switch (intent.kind) {
    case 'build':
      return `build:${intent.building}`;
    case 'plant':
      return `plant:${intent.species}`;
    default:
      return intent.kind;
  }
}

interface TurnDelta {
  gold: number;
  energy: number;
  restored: number;
  pollution: number;
}

type LogKind = 'info' | 'good' | 'bad' | 'turn';
interface LogEntry {
  key: TranslationKey;
  params?: Record<string, string | number | { t: TranslationKey }>;
  kind: LogKind;
}

/** Log entries carry a shape as well as a color (R-13.2). */
const LOG_ICONS: Record<LogKind, IconName | null> = { info: null, good: 'check', bad: 'warn', turn: 'diamond' };

const ARROW_ICONS: Record<string, IconName> = { ArrowUp: 'arrowUp', ArrowDown: 'arrowDown', ArrowLeft: 'arrowLeft', ArrowRight: 'arrowRight' };

/** Left-to-right story strip on the title screen: industry → cleansing → clean energy → life. */
const TITLE_STRIP = ['stack', 'ruin', 'sealer', 'scrubber', 'solar', 'wind', 'grass', 'shrub', 'tree', 'tree'] as const;

/** Deterministic per-pixel noise for the title ground. */
function noise(x: number, y: number): number {
  let n = Math.imul(x * 374761393 + y * 668265263, 1274126177);
  n ^= n >>> 13;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function toolIcon(tool: Tool): string {
  switch (tool.kind) {
    case 'salvage':
      return 'salvage';
    case 'cleanup':
      return 'hand';
    case 'plant':
      return tool.species;
    case 'build':
      return tool.building;
    case 'upgrade':
      return 'up';
    case 'toggle':
      return 'toggle';
    case 'demolish':
      return 'remove';
  }
}

/** The browser application: store, dispatch, undo, autosave, bus wiring and all DOM views. */
export class App {
  private settings: Settings;
  private state: GameState | null = null;
  private undoStack: GameState[] = [];
  private bus = new EventBus();
  private audio: Audio;
  private renderer: Renderer | null = null;
  private achievements: Set<AchievementId>;
  private tool: number | null = null;
  private cursor = { x: 2, y: 5 };
  private log: LogEntry[] = [];
  private tx = 0;
  private tutorialStep = 0;
  private dirty = true;
  private listeningFor: KeyAction | null = null;
  private lastFocus: HTMLElement | null = null;
  private modalOpen = false;
  /** Particle layers over the map and the title art (R-11.7); fed by the bus only. */
  private fx: FxLayer | null = null;
  private titleFx: FxLayer | null = null;
  private music: Music;
  private records: Records;
  /** The game already folded into the records, so a redraw never counts it twice. */
  private recorded: { key: string; update: RecordUpdate } | null = null;
  /** Forecast of the coming resolution (R-13.14), refreshed on every state change. */
  private forecast: ResolutionForecast | null = null;
  private risk = new Set<number>();
  private lens: Lens = 'normal';
  /** The visible hint and the tile it points at (R-13.13). */
  private advice: Advice | null = null;
  private turnDelta: TurnDelta | null = null;
  private deltaTimer: ReturnType<typeof setTimeout> | null = null;
  private stage: WorldStage | null = null;

  constructor(private root: HTMLElement) {
    const prefersReduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const browserLang: Lang = (navigator.language ?? '').toLowerCase().startsWith('uz') ? 'uz' : 'en';
    this.settings = parseSettings(readStore(SETTINGS_KEY), defaultSettings(prefersReduced, browserLang));
    this.achievements = parseAchievements(readStore(ACH_KEY));
    this.records = parseRecords(readStore(RECORDS_KEY));
    setLang(this.settings.lang);
    this.audio = new Audio(this.bus);
    this.audio.enabled = this.settings.sound;
    this.music = new Music(() => this.audio.context);
    this.wireBus();
    onLangChange(() => this.renderAll());
    this.applySettings();
    document.addEventListener('keydown', (e) => this.onKey(e));
    // Browsers only allow sound after a user gesture.
    const unlock = () => {
      this.audio.unlock();
      this.music.start();
    };
    document.addEventListener('pointerdown', unlock, { once: true });
    document.addEventListener('keydown', unlock, { once: true });
    this.showTitle();
    this.loop();
  }

  // ───────────────────────── store ─────────────────────────

  private dispatch(intent: Intent): boolean {
    const s = this.state;
    if (!s) return false;
    const action = { ...intent, txId: `ui${Date.now().toString(36)}-${this.tx++}` } as Action;
    const { state: next, events } = applyAction(s, action);
    const changed = next !== s;
    if (changed) {
      if (intent.kind === 'endTurn') this.undoStack = [];
      else this.undoStack.push(s);
      this.state = next;
      this.save();
      // A hint describes the state it was given for; any change makes it stale.
      this.closeHint();
      if (intent.kind === 'endTurn') this.reportTurn(s, next);
      else this.clearTurnReport();
      this.refreshForecast();
    }
    this.bus.emitAll(events);
    this.dirty = true;
    if (changed) {
      this.syncFx();
      this.checkStage(true);
    }
    this.renderHud();
    this.renderTools();
    this.renderInspector();
    return changed;
  }

  private undo(): void {
    const prev = this.undoStack.pop();
    if (!prev || !this.state || isTerminal(this.state.phase)) return;
    this.state = prev;
    this.save();
    this.closeHint();
    this.refreshForecast();
    this.pushLog({ key: 'log.undo', kind: 'info' });
    this.dirty = true;
    this.syncFx();
    this.checkStage(false);
    this.renderHud();
    this.renderTools();
    this.renderInspector();
  }

  /** Exact forecast of the coming resolution (R-13.14) and the doomed-plant index for the map. */
  private refreshForecast(): void {
    const s = this.state;
    this.forecast = s ? forecastResolution(s) : null;
    this.risk = new Set((this.forecast?.withered ?? []).map((p) => p.y * (s?.width ?? 0) + p.x));
  }

  /** Turn report (R-11.19): what the resolution and the preparation changed. */
  private reportTurn(prev: GameState, next: GameState): void {
    this.clearTurnReport();
    if (isTerminal(next.phase)) return;
    const a = summary(prev);
    const b = summary(next);
    this.turnDelta = {
      gold: next.gold.balance - prev.gold.balance,
      energy: next.energy.current - prev.energy.current,
      restored: Math.round(b.ratio * 100) - Math.round(a.ratio * 100),
      pollution: Math.round(b.averagePollution) - Math.round(a.averagePollution),
    };
    this.deltaTimer = setTimeout(() => {
      this.turnDelta = null;
      this.renderHud();
    }, DELTA_MS);
  }

  private clearTurnReport(): void {
    if (this.deltaTimer !== null) clearTimeout(this.deltaTimer);
    this.deltaTimer = null;
    this.turnDelta = null;
  }

  /**
   * Follows the world stage (R-11.12): music mood always; a banner, chronicle entry and
   * announcement when `announce` is set and the stage moved forward.
   */
  private checkStage(announce: boolean): void {
    const s = this.state;
    if (!s) return;
    const stage = worldStage(worldProgress(s));
    const prev = this.stage;
    this.stage = stage;
    this.music.setMood(stage);
    if (!announce || prev === null || prev === stage) return;
    const name = { t: `stage.${stage}` as TranslationKey };
    if (STAGE_ORDER[stage] > STAGE_ORDER[prev]) {
      this.pushLog({ key: 'log.stage', params: { name }, kind: 'good' });
      this.announce(`${t(`stage.${stage}` as TranslationKey)}. ${t(`stage.${stage}.line` as TranslationKey)}`);
      this.showStageBanner(stage);
    } else this.pushLog({ key: 'log.stageBack', params: { name }, kind: 'bad' });
  }

  private showStageBanner(stage: WorldStage): void {
    const frame = document.getElementById('map-frame');
    if (!frame) return;
    frame.querySelector('.stage-banner')?.remove();
    const banner = h(
      'div',
      { class: `stage-banner stage-${stage}`, 'aria-hidden': 'true' },
      h('strong', {}, t(`stage.${stage}` as TranslationKey)),
      h('span', {}, t(`stage.${stage}.line` as TranslationKey)),
    );
    frame.append(banner);
    setTimeout(() => banner.remove(), 2800);
  }

  /** Ambient particles follow the world: pollen over restored land, smog over open stacks. */
  private syncFx(): void {
    if (this.fx && this.state) this.fx.setSources(sourcesFromState(this.state));
  }

  private save(): void {
    if (this.state) writeStore(SAVE_KEY, serialize(this.state));
  }

  private loadSave(): GameState | null {
    const raw = readStore(SAVE_KEY);
    if (!raw) return null;
    const s = deserialize(raw);
    return s && !isTerminal(s.phase) ? s : null;
  }

  // ───────────────────────── event bus subscribers ─────────────────────────

  private wireBus(): void {
    const b = this.bus;
    const name = (k: string): { t: TranslationKey } => ({ t: k as TranslationKey });
    b.on('turn:started', (e) => {
      const entry: LogEntry = { key: 'log.turn', params: { turn: e.turn, income: e.income, energy: e.produced, upkeep: e.upkeep, curtailed: e.curtailed }, kind: 'turn' };
      this.pushLog(entry);
      this.announce(this.formatLog(entry));
      if (this.tutorialStep === 4) this.advanceTutorial(5);
    });
    b.on('tile:salvaged', (e) => {
      this.pushLog({ key: 'log.salvaged', params: { gold: e.gold }, kind: 'good' });
      if (e.remaining === 0) this.pushLog({ key: 'log.ruinCleared', kind: 'info' });
      this.renderer?.addFloater(e.x, e.y, `+${e.gold}`, '#f5c84c');
      this.fx?.burst('spark', e.x, e.y);
      if (this.tutorialStep === 1) this.advanceTutorial(2);
    });
    b.on('building:placed', (e) => {
      this.pushLog({ key: 'log.built', params: { name: name(`building.${e.building}`) }, kind: 'good' });
      this.fx?.burst('spark', e.x, e.y, 6);
      if (this.tutorialStep === 2 && (e.building === 'solar' || e.building === 'wind')) this.advanceTutorial(3);
    });
    b.on('building:upgraded', (e) => this.pushLog({ key: 'log.upgraded', params: { name: name(`building.${e.building}`), level: e.level }, kind: 'good' }));
    b.on('building:demolished', (e) => {
      this.pushLog({ key: 'log.demolished', params: { name: name(`building.${e.building}`), gold: e.refund }, kind: 'info' });
      if (e.refund > 0) this.renderer?.addFloater(e.x, e.y, `+${e.refund}`, '#f5c84c');
    });
    b.on('building:toggled', (e) => this.pushLog({ key: e.enabled ? 'log.toggledOn' : 'log.toggledOff', params: { name: name(`building.${e.building}`) }, kind: 'info' }));
    b.on('building:unpowered', (e) => this.pushLog({ key: 'log.unpowered', params: { name: name(`building.${e.building}`) }, kind: 'bad' }));
    // Resolution waves (R-11.17): cleansing first, then emission.
    b.on('building:pulsed', (e) => this.fx?.pulse('clean', e.x, e.y, e.radius));
    b.on('stack:emitted', (e) => this.fx?.pulse('emit', e.x, e.y, e.radius, EMIT_DELAY));
    b.on('tile:cleaned', (e) => {
      this.pushLog({ key: 'log.cleaned', params: { amount: e.amount }, kind: 'good' });
      this.renderer?.addFloater(e.x, e.y, `-${e.amount}`, '#7fd8ff');
      this.fx?.burst('drop', e.x, e.y);
    });
    b.on('flora:planted', (e) => {
      this.pushLog({ key: 'log.planted', params: { name: name(`species.${e.species}`) }, kind: 'good' });
      this.fx?.burst('leaf', e.x, e.y, 5);
      if (this.tutorialStep === 3) this.advanceTutorial(4);
    });
    b.on('flora:matured', (e) => {
      this.pushLog({ key: 'log.matured', params: { name: name(`species.${e.species}`) }, kind: 'good' });
      this.fx?.burst('leaf', e.x, e.y, 4);
    });
    b.on('flora:withered', (e) => this.pushLog({ key: 'log.withered', params: { name: name(`species.${e.species}`) }, kind: 'bad' }));
    b.on('flora:spread', (e) => {
      this.pushLog({ key: 'log.spread', kind: 'good' });
      this.fx?.burst('leaf', e.x, e.y, 4);
    });
    b.on('tile:restored', (e) => {
      this.pushLog({ key: 'log.restored', params: { gold: e.bounty }, kind: 'good' });
      this.renderer?.addFloater(e.x, e.y, `+${e.bounty}`, '#8fe39a');
      this.fx?.burst('leaf', e.x, e.y);
    });
    b.on('ecosystem:milestone', (e) => {
      const pct = Math.round([10, 25, 50, 75][e.index - 1] ?? e.ratio * 100);
      this.pushLog({ key: 'log.milestone', params: { pct, gold: e.reward }, kind: 'good' });
      if (this.state) this.fx?.shower(this.state.width, this.state.height, 45);
      this.showJournalEntry(e.index);
    });
    b.on('stack:sealed', (e) => {
      this.pushLog({ key: 'log.sealed', kind: 'good' });
      this.fx?.burst('spark', e.x, e.y, 12);
    });
    b.on('event:random', (e) => {
      const key = `event.${e.kind}` as TranslationKey;
      const amount = e.kind === 'acidRain' ? e.tiles.length : e.amount;
      this.pushLog({ key, params: { amount }, kind: e.kind === 'acidRain' ? 'bad' : 'good' });
      this.announce(t(key, { amount }));
      if (e.kind === 'acidRain') this.shake();
      // The event made visible as weather (R-11.16).
      const s = this.state;
      if (s) this.fx?.weather(e.kind, { width: s.width, height: s.height, tiles: e.tiles, at: this.findSanctuary(s) });
    });
    b.on('action:rejected', (e) => {
      const reason = `reason.${e.reason}` as TranslationKey;
      this.pushLog({ key: 'log.rejected', params: { reason: { t: reason } }, kind: 'bad' });
      this.announce(t(reason));
    });
    b.on('game:won', (e) => {
      this.pushLog({ key: 'log.won', params: { score: e.score }, kind: 'good' });
      if (this.state) this.fx?.shower(this.state.width, this.state.height, 160);
      setTimeout(() => this.showEnd(), 350);
    });
    b.on('game:lost', (e) => {
      this.pushLog({ key: e.reason === 'time' ? 'log.lost.time' : 'log.lost.collapse', kind: 'bad' });
      setTimeout(() => this.showEnd(), 350);
    });
    b.onAny((e) => this.checkAchievements(e));
  }

  private checkAchievements(e: GameEvent): void {
    if (!this.state) return;
    const fresh = unlockedBy(e, this.state, this.achievements);
    for (const id of fresh) {
      this.achievements.add(id);
      const label = t(`ach.${id}` as TranslationKey);
      this.toast(t('ach.unlocked', { name: label }), 'ach');
      this.announce(t('ach.unlocked', { name: label }));
    }
    if (fresh.length) writeStore(ACH_KEY, JSON.stringify([...this.achievements]));
  }

  // ───────────────────────── settings ─────────────────────────

  private applySettings(): void {
    const html = document.documentElement;
    applyTheme(html, this.settings.highContrast ? THEMES.contrast : THEMES.default);
    html.style.setProperty('--scale', String(this.settings.scale));
    html.lang = this.settings.lang;
    html.classList.toggle('reduced-motion', this.settings.reducedMotion);
    html.classList.toggle('high-contrast', this.settings.highContrast);
    this.fx?.setEnabled(!this.settings.reducedMotion);
    this.titleFx?.setEnabled(!this.settings.reducedMotion);
    this.audio.enabled = this.settings.sound;
    this.music.setEnabled(this.settings.music);
    writeStore(SETTINGS_KEY, JSON.stringify(this.settings));
    this.dirty = true;
  }

  private updateSettings(patch: Partial<Settings>): void {
    this.settings = { ...this.settings, ...patch };
    if (patch.lang) setLang(patch.lang);
    this.applySettings();
  }

  private toggleLang(): void {
    this.updateSettings({ lang: getLang() === 'en' ? 'uz' : 'en' });
  }

  // ───────────────────────── screens ─────────────────────────

  private showTitle(): void {
    this.state = null;
    this.renderer = null;
    this.fx = null;
    this.forecast = null;
    this.risk = new Set();
    this.advice = null;
    this.stage = null;
    this.clearTurnReport();
    this.music.setMood('transition');
    clear(this.root);
    document.getElementById('overlay')?.remove();
    this.modalOpen = false;
    this.listeningFor = null;
    const hasSave = this.loadSave() !== null;
    const artW = TITLE_STRIP.length * TILE;
    const artH = 3 * TILE;
    const art = h('canvas', { class: 'title-art', width: artW, height: artH });
    const artFx = h('canvas', { class: 'title-fx', width: artW, height: artH });
    const screen = h(
      'div',
      { class: 'title-screen' },
      h('div', { class: 'title-art-wrap', 'aria-hidden': 'true' }, art, artFx),
      h('h1', { class: 'title' }, t('app.title')),
      h('p', { class: 'tagline' }, t('app.tagline')),
      h(
        'nav',
        { class: 'menu', 'aria-label': t('app.title') },
        hasSave ? h('button', { class: 'btn primary', onclick: () => this.continueGame() }, t('menu.continue')) : null,
        h('button', { class: hasSave ? 'btn' : 'btn primary', onclick: () => this.showNewGame() }, t('menu.newGame')),
        h('button', { class: 'btn', onclick: () => this.showHelp() }, t('menu.howToPlay')),
        h('button', { class: 'btn', onclick: () => this.showAchievements() }, t('menu.achievements')),
        h('button', { class: 'btn', onclick: () => this.showSettings() }, t('menu.settings')),
        h('button', { class: 'btn ghost', onclick: () => this.toggleLang(), 'aria-label': t('a11y.langToggle') }, getLang() === 'en' ? "O'zbekcha" : 'English'),
      ),
      h('p', { class: 'fine' }, t('menu.saveNote')),
    );
    this.root.append(screen);
    this.drawTitleArt(art);
    // Smog above the stack on the left, pollen over the living land on the right.
    this.titleFx = new FxLayer(artFx, TILE);
    this.titleFx.setEnabled(!this.settings.reducedMotion);
    const alive: { x: number; y: number }[] = [];
    for (let rep = 0; rep < 3; rep++) for (let x = 5; x < TITLE_STRIP.length; x++) alive.push({ x, y: 0 }, { x, y: 1 });
    this.titleFx.setSources({ stacks: [{ x: 0, y: 1 }], restored: alive });
    (screen.querySelector('.btn') as HTMLElement | null)?.focus();
  }

  /**
   * The title diorama tells the game's arc from left to right: ground blends through the
   * three world palettes (R-11.2) with hue-shifted shading (R-11.1), from toxic, hatched
   * soil under a smoking stack to green, grassy soil under a tree.
   */
  private drawTitleArt(c: HTMLCanvasElement): void {
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    const n = TITLE_STRIP.length;
    TITLE_STRIP.forEach((sprite, i) => {
      const r = i / (n - 1);
      const pal = paletteFor(r);
      const toxicity = Math.max(0, 1 - r * 1.35);
      const base = mixHex(pal.soilClean, pal.soilToxic, toxicity);
      const dark = shadeHex(base, -0.22);
      const light = shadeHex(base, 0.16);
      const grass = shadeHex(pal.grass, 0.08);
      const gx = i * TILE;
      const gy = 2 * TILE;
      ctx.fillStyle = base;
      ctx.fillRect(gx, gy, TILE, TILE);
      for (let y = 0; y < TILE; y++)
        for (let x = 0; x < TILE; x++) {
          const v = noise(gx + x, gy + y);
          let color: string | null = null;
          if (y === 0) color = toxicity === 0 ? grass : light;
          else if (toxicity > 0.3 && (x + y) % 5 === 0) color = 'rgba(236, 228, 255, 0.28)';
          else if (v < 0.12) color = dark;
          else if (v > 0.93) color = light;
          else if (toxicity > 0.55 && v > 0.88) color = '#9be34a';
          else if (toxicity === 0 && y < 5 && v > 0.78) color = grass;
          if (color) {
            ctx.fillStyle = color;
            ctx.fillRect(gx + x, gy + y, 1, 1);
          }
        }
      ctx.drawImage(spriteCanvas(sprite), gx, TILE);
    });
  }

  private continueGame(): void {
    const s = this.loadSave();
    if (!s) return this.showNewGame();
    this.startWith(s, false);
  }

  private showNewGame(): void {
    let difficulty: Difficulty = 'balanced';
    let seed = Math.floor(Math.random() * 1_000_000);
    const seedInput = h('input', { id: 'seed', type: 'number', inputmode: 'numeric', min: 0, value: seed, class: 'input' }) as HTMLInputElement;
    const cards = (['gentle', 'balanced', 'hard'] as Difficulty[]).map((d) => {
      const def = DIFFICULTIES[d];
      const input = h('input', { type: 'radio', name: 'difficulty', value: d, checked: d === difficulty, onchange: () => (difficulty = d) });
      // Local records (R-10.7): a reason to come back.
      const r = this.records[d];
      const record =
        r.wins > 0 && r.bestScore !== null && r.fewestTurns !== null
          ? h('span', { class: 'choice-record' }, icon('star', 'gold'), t('records.best', { score: r.bestScore, turns: r.fewestTurns, wins: r.wins, played: r.played }))
          : r.played > 0
            ? h('span', { class: 'choice-record' }, t('records.played', { played: r.played }))
            : null;
      return h(
        'label',
        { class: 'choice' },
        input,
        h(
          'span',
          { class: 'choice-body' },
          h('strong', {}, t(`difficulty.${d}` as TranslationKey)),
          h('span', {}, t(`difficulty.${d}.desc` as TranslationKey, { win: Math.round(def.winRatio * 100), turns: def.turnLimit ?? '∞' })),
          record,
        ),
      );
    });
    this.openModal(t('menu.newGame'), [
      h('fieldset', { class: 'choices' }, h('legend', {}, t('menu.difficulty')), ...cards),
      h(
        'div',
        { class: 'field' },
        h('label', { for: 'seed' }, t('menu.seed')),
        h('div', { class: 'row' }, seedInput, h('button', { class: 'btn small', onclick: () => (seedInput.value = String((seed = Math.floor(Math.random() * 1_000_000)))) }, t('menu.randomSeed'))),
      ),
      h(
        'div',
        { class: 'modal-actions' },
        h('button', { class: 'btn', onclick: () => this.closeModal() }, t('menu.back')),
        h(
          'button',
          {
            class: 'btn primary',
            onclick: () => {
              const n = Number.parseInt(seedInput.value, 10);
              this.startWith(createGame(Number.isFinite(n) ? Math.abs(n) : seed, difficulty), true);
            },
          },
          t('menu.start'),
        ),
      ),
    ]);
  }

  private startWith(s: GameState, fresh: boolean): void {
    this.state = s;
    this.closeModal();
    this.undoStack = [];
    this.log = [];
    this.tool = null;
    this.advice = null;
    this.recorded = null;
    this.clearTurnReport();
    this.cursor = this.findSanctuary(s);
    this.save();
    this.refreshForecast();
    this.stage = null;
    this.checkStage(false);
    this.buildGameScreen();
    if (fresh) this.showStory();
    else this.pushLog({ key: 'log.resumed', params: { turn: s.turn }, kind: 'turn' });
  }

  private findSanctuary(s: GameState): { x: number; y: number } {
    for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) if (tileInfo(s, x, y)?.building?.type === 'sanctuary') return { x, y };
    return { x: 0, y: 0 };
  }

  private showStory(): void {
    this.openModal(
      t('story.title'),
      [
        h('div', { class: 'story' }, h('p', {}, t('story.p1')), h('p', {}, t('story.p2')), h('p', {}, t('story.p3'))),
        h(
          'div',
          { class: 'modal-actions' },
          h(
            'button',
            {
              class: 'btn primary',
              onclick: () => {
                this.closeModal();
                if (this.settings.tutorial) this.advanceTutorial(1);
              },
            },
            t('story.begin'),
          ),
        ),
      ],
      'story-modal',
    );
  }

  // ───────────────────────── game screen ─────────────────────────

  private buildGameScreen(): void {
    const s = this.state!;
    this.titleFx = null;
    clear(this.root);
    const canvas = h('canvas', { class: 'map', role: 'img', tabindex: 0, 'aria-label': t('a11y.map') });
    const fxCanvas = h('canvas', { class: 'fx', 'aria-hidden': 'true' });
    this.root.append(
      h(
        'div',
        { class: 'game' },
        h('header', { class: 'topbar' }, h('div', { class: 'stats', id: 'stats' }), h('div', { class: 'top-actions', id: 'top-actions' })),
        h(
          'main',
          { class: 'play' },
          h(
            'section',
            { class: 'map-area' },
            h('div', { class: 'map-frame', id: 'map-frame' }, canvas, fxCanvas),
            h('div', { class: 'map-bar' }, h('div', { class: 'lens-control', id: 'lens-control', role: 'radiogroup' }), h('button', { class: 'btn small hint-btn', id: 'hint-btn', onclick: () => this.toggleHint() })),
            h('p', { class: 'hint', id: 'keys-hint' }),
          ),
          h(
            'aside',
            { class: 'side' },
            h('section', { class: 'panel tools', 'aria-labelledby': 'tools-h' }, h('h2', { id: 'tools-h' }), h('p', { class: 'muted small', id: 'tool-help' }), h('div', { class: 'tool-grid', id: 'tools', role: 'toolbar' })),
            h('section', { class: 'panel inspector', 'aria-labelledby': 'insp-h' }, h('h2', { id: 'insp-h' }), h('div', { id: 'inspector' })),
          ),
        ),
        h(
          'section',
          { class: 'panel log', 'aria-labelledby': 'log-h' },
          h('div', { class: 'log-head' }, h('h2', { id: 'log-h' }), h('button', { class: 'btn small', id: 'journal-btn', onclick: () => this.showJournal() })),
          h('ol', { id: 'log', class: 'log-list' }),
        ),
        h('div', { id: 'live', class: 'sr-only', 'aria-live': 'polite', role: 'status' }),
        h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }),
      ),
    );
    this.renderer = new Renderer(canvas, s.width, s.height);
    fxCanvas.width = canvas.width;
    fxCanvas.height = canvas.height;
    this.fx = new FxLayer(fxCanvas, TILE * ZOOM);
    this.fx.setEnabled(!this.settings.reducedMotion);
    this.syncFx();
    canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const p = this.renderer?.tileFromPoint(e.clientX, e.clientY);
      if (p && (p.x !== this.cursor.x || p.y !== this.cursor.y)) this.setCursor(p.x, p.y);
    });
    canvas.addEventListener('pointerdown', (e) => {
      const p = this.renderer?.tileFromPoint(e.clientX, e.clientY);
      if (!p) return;
      if (e.button === 2) {
        this.selectTool(null);
        return;
      }
      // Touch has no hover: the first tap previews, a second tap on the same tile acts (R-2.8).
      const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
      if (touch && this.tool !== null && (p.x !== this.cursor.x || p.y !== this.cursor.y)) {
        this.setCursor(p.x, p.y);
        return;
      }
      this.setCursor(p.x, p.y);
      this.activate();
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.renderAll();
  }

  private renderAll(): void {
    if (!this.state) {
      if (!this.modalOpen) this.showTitle();
      return;
    }
    const hint = document.getElementById('keys-hint');
    if (!hint) return;
    hint.textContent = t('hud.keysHint');
    this.renderMapBar();
    if (this.advice) this.renderHintCard();
    $('#tools-h').textContent = t('hud.tools');
    $('#insp-h').textContent = t('hud.inspector');
    $('#log-h').textContent = t('hud.log');
    $('#journal-btn').textContent = t('hud.journal');
    this.renderer?.canvas.setAttribute('aria-label', t('a11y.map'));
    this.renderHud();
    this.renderTools();
    this.renderInspector();
    this.renderLog();
    if (document.getElementById('tutorial') && this.tutorialStep >= 1 && this.tutorialStep <= 5) {
      const minimized = document.getElementById('tutorial')?.classList.contains('minimized');
      this.advanceTutorial(this.tutorialStep);
      if (minimized) {
        document.getElementById('tutorial')?.classList.add('minimized');
        this.renderTools();
      }
    }
    this.dirty = true;
  }

  /**
   * A turn-report chip (R-11.19): an up / down mark plus a signed number, colored by whether
   * the change is good. Decorative for screen readers, who hear the turn announcement.
   */
  private deltaChip(value: number | undefined, goodWhenUp: boolean): HTMLElement | null {
    if (value === undefined || value === 0) return null;
    const good = value > 0 === goodWhenUp;
    return h('span', { class: `delta ${good ? 'good' : 'bad'}`, 'aria-hidden': 'true' }, icon(value > 0 ? 'up' : 'down'), `${value > 0 ? '+' : '−'}${Math.abs(value)}`);
  }

  private renderHud(): void {
    const s = this.state;
    const stats = document.getElementById('stats');
    if (!s || !stats) return;
    const f = forecast(s);
    const sum = summary(s);
    const pct = Math.round(sum.ratio * 100);
    const goal = Math.round(sum.winRatio * 100);
    const d = this.turnDelta;
    const next = this.forecast;
    const nextPct = next ? Math.round(next.ratio * 100) : pct;
    const stage = worldStage(worldProgress(s));
    clear(stats);
    stats.append(
      h(
        'div',
        { class: 'stat gold', title: t('hud.goldTip', { income: f.income }) },
        h('img', { src: spriteDataUrl('coin'), alt: '', class: 'icon' }),
        h('span', { class: 'stat-label' }, t('hud.gold')),
        h('b', { class: 'stat-value' }, s.gold.balance, this.deltaChip(d?.gold, true)),
        h('small', {}, t('hud.goldTip', { income: f.income })),
      ),
      h(
        'div',
        { class: 'stat energy', title: t('hud.energyTip', { production: f.production, max: f.capacity, upkeep: f.upkeep }) },
        h('img', { src: spriteDataUrl('bolt'), alt: '', class: 'icon' }),
        h('span', { class: 'stat-label' }, t('hud.energy')),
        h('b', { class: 'stat-value' }, `${s.energy.current}/${s.energy.max}`, this.deltaChip(d?.energy, true)),
        h('small', {}, t('hud.energyTip', { production: f.production, max: f.capacity, upkeep: f.upkeep })),
      ),
      h(
        'div',
        { class: 'stat turn' },
        h('img', { src: spriteDataUrl('hourglass'), alt: '', class: 'icon' }),
        h('span', { class: 'stat-label' }, t('hud.turn')),
        h('b', { class: 'stat-value' }, sum.turnLimit ? t('hud.turnOf', { turn: s.turn, limit: sum.turnLimit }) : s.turn),
        h('small', {}, `${t('hud.phase')}: ${t(`phase.${s.phase}` as TranslationKey)}`),
      ),
      h(
        'div',
        { class: 'stat progress', title: next && nextPct !== pct ? t('forecast.restored', { pct: nextPct }) : null },
        h('img', { src: spriteDataUrl('sprout'), alt: '', class: 'icon' }),
        h('span', { class: 'stat-label' }, t('hud.restored')),
        h('b', { class: 'stat-value' }, `${pct}%`, this.deltaChip(d?.restored, true)),
        h(
          'div',
          {
            class: 'bar',
            role: 'progressbar',
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': pct,
            'aria-label': t('hud.restored'),
            'aria-valuetext': nextPct !== pct ? `${pct}% · ${t('forecast.restored', { pct: nextPct })}` : `${pct}%`,
          },
          h('div', { class: 'bar-fill', style: `width:${Math.min(100, pct)}%` }),
          // The forecast restoration after this turn (R-13.14), hatched so it reads as "not yet".
          nextPct > pct ? h('div', { class: 'bar-forecast', style: `left:${pct}%;width:${Math.min(100, nextPct) - pct}%` }) : null,
          h('div', { class: 'bar-goal', style: `left:${goal}%` }),
        ),
        h('small', {}, `${t('hud.goal')}: ${goal}% · ${t(`stage.${stage}` as TranslationKey)}`),
      ),
      h(
        'div',
        { class: 'stat pollution' },
        h('img', { src: spriteDataUrl('smog'), alt: '', class: 'icon' }),
        h('span', { class: 'stat-label' }, t('hud.pollution')),
        h('b', { class: 'stat-value' }, Math.round(sum.averagePollution), this.deltaChip(d?.pollution, false)),
        h('small', {}, t('hud.pollutionNote', { band: t(`band.${pollutionBand(Math.round(sum.averagePollution))}` as TranslationKey) })),
      ),
    );
    const actions = $('#top-actions');
    clear(actions);
    const over = isTerminal(s.phase);
    // Out of Energy: gently point at End turn (a glow, or a static ring under reduced motion).
    const nudge = !over && s.energy.current === 0;
    // Forecast on End turn (R-13.14): doomed plants, a winning turn, the last turn.
    const doomed = next?.withered.length ?? 0;
    const wins = next?.outcome?.result === 'victory';
    const lastTurn = !over && !wins && sum.turnLimit !== null && s.turn >= sum.turnLimit;
    const notes = [
      doomed > 0 ? t('forecast.atRisk', { count: doomed }) : '',
      wins ? t('forecast.win') : '',
      lastTurn ? t('forecast.lastTurn') : '',
    ].filter(Boolean);
    const endLabel = `${t('hud.endTurn')} (${keyLabel(this.settings.keys.endTurn)})`;
    actions.append(
      h(
        'button',
        { class: 'btn', onclick: () => this.undo(), disabled: this.undoStack.length === 0 || over, title: `${t('hud.undo')} (${keyLabel(this.settings.keys.undo)})` },
        icon('undo'),
        h('span', { class: 'btn-label hide-sm' }, t('hud.undo')),
      ),
      h(
        'button',
        {
          class: `btn primary end-turn${nudge ? ' nudge' : ''}${wins ? ' will-win' : ''}`,
          onclick: () => this.endTurn(),
          disabled: over,
          title: [endLabel, ...notes].join('\n'),
          'aria-label': [t('hud.endTurn'), ...notes].join('. '),
        },
        t('hud.endTurn'),
        icon('play', 'after'),
        doomed > 0 ? h('span', { class: 'turn-chip bad', 'aria-hidden': 'true' }, icon('warn'), String(doomed)) : null,
        wins ? h('span', { class: 'turn-chip win', 'aria-hidden': 'true' }, icon('star')) : null,
        lastTurn ? h('span', { class: 'turn-chip last', 'aria-hidden': 'true' }, t('forecast.lastTurn')) : null,
      ),
      h('button', { class: 'btn ghost', onclick: () => this.toggleLang(), 'aria-label': t('a11y.langToggle') }, getLang() === 'en' ? 'UZ' : 'EN'),
      h('button', { class: 'btn ghost', onclick: () => this.showPause() }, icon('menu'), h('span', { class: 'btn-label hide-sm' }, t('menu.pause'))),
    );
  }

  private toolLabel(tool: Tool): string {
    if (tool.kind === 'build') return t('tool.build', { name: t(`building.${tool.building}` as TranslationKey) });
    if (tool.kind === 'plant') return t('tool.plant', { name: t(`species.${tool.species}` as TranslationKey) });
    return t(`tool.${tool.kind}` as TranslationKey);
  }

  private toolDescription(tool: Tool): string {
    switch (tool.kind) {
      case 'build':
        return this.buildingDescription(tool.building, 1);
      case 'plant': {
        const d = SPECIES[tool.species];
        return t(`species.${tool.species}.desc` as TranslationKey, { tol: d.tolerance, turns: d.maturation, bio: d.bio });
      }
      case 'cleanup':
        return t('tool.cleanup.desc', { amount: K_MANUAL });
      default:
        return t(`tool.${tool.kind}.desc` as TranslationKey);
    }
  }

  private buildingDescription(type: string, level: number): string {
    const key = `building.${type}.desc` as TranslationKey;
    switch (type) {
      case 'sanctuary':
        return t(key, { energy: R_BASE });
      case 'solar':
      case 'wind':
        return t(key, { energy: producerOutput(type, level) });
      case 'scrubber':
      case 'purifier': {
        const { power, radius } = cleansePreview(type, level);
        return t(key, { power, half: Math.floor(power / 2), radius });
      }
      case 'recycler':
        return t(key, { gold: K_REC * level });
      case 'battery':
        return t(key, { max: energyCapacity(this.state ? totalBatteryLevel(this.state) + 1 : level) });
      default:
        return t(key);
    }
  }

  private renderTools(): void {
    const s = this.state;
    const grid = document.getElementById('tools');
    if (!s || !grid) return;
    clear(grid);
    const help = $('#tool-help');
    const selected = this.tool !== null ? TOOLS[this.tool]! : null;
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    help.textContent = selected ? `${this.toolDescription(selected)}${coarse ? ` ${t('hud.touchHint')}` : ''}` : t('hud.selectTool');
    let group: string | null = null;
    const hint = this.tutorialTool();
    TOOLS.forEach((tool, i) => {
      // Section headings group the palette by purpose, which keeps 15 actions scannable (R-2.7).
      const g = toolGroup(tool);
      if (g !== group) {
        group = g;
        grid.append(h('p', { class: 'tool-group' }, t(`tools.group.${g}` as TranslationKey)));
      }
      const q = previewTool(s, tool, this.cursor.x, this.cursor.y);
      const base = toolBasePrice(tool);
      const gold = q.gold || (tool.kind === 'build' || tool.kind === 'plant' ? (base?.gold ?? 0) : 0);
      const energy = q.energy || (base?.energy ?? 0);
      const cost: (string | HTMLElement)[] = [];
      if (gold > 0) cost.push(h('span', { class: 'cost gold' }, h('img', { src: spriteDataUrl('coin', 1), alt: t('hud.gold') }), String(gold)));
      if (energy > 0) cost.push(h('span', { class: 'cost energy' }, h('img', { src: spriteDataUrl('bolt', 1), alt: t('hud.energy') }), String(energy)));
      if (cost.length === 0) cost.push(h('span', { class: 'cost' }, t('hud.free')));
      const reason = q.ok ? '' : t(`reason.${q.reason}` as TranslationKey);
      const isSel = this.tool === i;
      const hinted = !isSel && toolId(tool) === hint;
      const btn = h(
        'button',
        {
          class: `tool${isSel ? ' selected' : ''}${q.ok ? '' : ' unavailable'}${hinted ? ' hinted' : ''}`,
          'aria-pressed': isSel ? 'true' : 'false',
          'data-tool': toolId(tool),
          title: `${this.toolLabel(tool)}${i < 9 ? ` (${i + 1})` : ''}\n${this.toolDescription(tool)}${reason ? `\n${reason}` : ''}`,
          onclick: () => this.selectTool(isSel ? null : i),
        },
        h('img', { src: spriteDataUrl(toolIcon(tool)), alt: '', class: 'tool-icon' }),
        h('span', { class: 'tool-name' }, i < 9 ? h('kbd', {}, String(i + 1)) : null, this.toolLabel(tool)),
        h('span', { class: 'tool-cost' }, ...cost),
        reason
          ? h('span', { class: 'tool-reason' }, icon('warn'), reason)
          : h('span', { class: 'tool-reason ok' }, icon('check'), h('span', { class: 'sr-only' }, t('hud.available'))),
      );
      grid.append(btn);
    });
  }

  private renderInspector(): void {
    const s = this.state;
    const box = document.getElementById('inspector');
    if (!s || !box) return;
    clear(box);
    const info = tileInfo(s, this.cursor.x, this.cursor.y);
    if (!info) {
      box.append(h('p', { class: 'muted' }, t('hud.noTile')));
      return;
    }
    const band = t(`band.${info.band}` as TranslationKey);
    const rows: HTMLElement[] = [
      h('p', { class: 'insp-title' }, h('strong', {}, t(`terrain.${info.terrain}` as TranslationKey)), h('span', { class: 'muted' }, ' · ', t('info.position', { x: info.x + 1, y: info.y + 1 }))),
    ];
    const tileIndex = info.y * s.width + info.x;
    if (info.terrain !== 'rock' && info.terrain !== 'stack') {
      rows.push(
        h(
          'div',
          { class: `meter band-${info.band}` },
          h('span', {}, t('info.pollution', { value: info.pollution, band })),
          h('div', { class: 'bar small', 'aria-hidden': 'true' }, h('div', { class: 'bar-fill bad', style: `width:${info.pollution}%` })),
        ),
      );
      // The exact pollution after the coming resolution (R-13.14), with a direction mark.
      const after = this.forecast?.pollution[tileIndex];
      if (after !== undefined && after !== info.pollution) {
        rows.push(h('p', { class: `small forecast ${after < info.pollution ? 'good' : 'bad'}` }, icon(after < info.pollution ? 'down' : 'up'), t('forecast.after', { value: after })));
      }
      rows.push(h('p', { class: info.restored ? 'good' : 'muted' }, icon(info.restored ? 'leaf' : 'ring'), t(info.restored ? 'info.restored' : 'info.notRestored')));
    }
    if (info.salvage) rows.push(h('p', {}, t('info.scrap', { remaining: info.salvage.remaining, gold: salvageYield(info.salvage.density) })));
    if (info.sealed !== null) rows.push(h('p', { class: info.sealed ? 'good' : 'bad' }, icon(info.sealed ? 'check' : 'warn'), t(info.sealed ? 'info.sealed' : 'info.unsealed')));
    if (info.building) {
      const b = info.building;
      rows.push(
        h(
          'div',
          { class: 'insp-card' },
          h('img', { src: spriteDataUrl(b.type), alt: '', class: 'tool-icon' }),
          h(
            'div',
            {},
            h('strong', {}, t(`building.${b.type}` as TranslationKey)),
            b.type !== 'sanctuary' ? h('p', { class: 'small' }, t('info.level', { level: b.level, max: b.maxLevel })) : null,
            h('p', { class: 'small muted' }, this.buildingDescription(b.type, b.level)),
            b.hasUpkeep
              ? h('p', { class: `small ${!b.enabled ? 'muted' : b.powered ? 'good' : 'bad'}` }, icon(!b.enabled ? 'pause' : b.powered ? 'dot' : 'zz'), t(!b.enabled ? 'info.off' : b.powered ? 'info.on' : 'info.unpowered'))
              : null,
            b.type !== 'sanctuary' && b.type !== 'sealer' && b.level < b.maxLevel
              ? h('p', { class: 'small' }, `${t('tool.upgrade')}: ${buildingCost(b.type, b.level + 1)} ${t('hud.gold')}`)
              : null,
          ),
        ),
      );
    }
    if (info.flora) {
      const f = info.flora;
      const doomed = this.risk.has(tileIndex);
      const after = this.forecast?.pollution[tileIndex] ?? info.pollution;
      rows.push(
        h(
          'div',
          { class: `insp-card${doomed ? ' doomed' : ''}` },
          h('img', { src: spriteDataUrl(floraSprite(f.species, f.stage)), alt: '', class: 'tool-icon' }),
          h(
            'div',
            {},
            h('strong', {}, t(`species.${f.species}` as TranslationKey)),
            h(
              'p',
              { class: 'small' },
              f.mature ? t('info.mature') : `${t(`info.stage.${f.stage}` as TranslationKey)} · ${t('info.growth', { growth: f.growth, max: f.maturation })}`,
            ),
            f.mature ? null : h('p', { class: 'small muted' }, t('info.turnsLeft', { turns: f.turnsLeft })),
            doomed ? h('p', { class: 'small bad' }, icon('warn'), t('forecast.wither', { after, limit: SPECIES[f.species].withers })) : null,
          ),
        ),
      );
    }
    box.append(...rows);
  }

  private renderLog(): void {
    const list = document.getElementById('log');
    if (!list) return;
    clear(list);
    for (const entry of this.log.slice(-LOG_LIMIT).reverse()) list.append(this.logItem(entry));
  }

  private logItem(entry: LogEntry): HTMLElement {
    const mark = LOG_ICONS[entry.kind];
    return h('li', { class: `log-${entry.kind}` }, mark ? icon(mark) : null, h('span', {}, this.formatLog(entry)));
  }

  /** Log entries keep raw parameters so they re-translate when the language changes. */
  private formatLog(e: LogEntry): string {
    const params: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(e.params ?? {})) params[k] = typeof v === 'object' ? t(v.t) : v;
    if (e.key === 'log.turn') {
      let extra = '';
      if (Number(params.upkeep) > 0) extra += t('log.turnUpkeep', { upkeep: params.upkeep! });
      if (Number(params.curtailed) > 0) extra += t('log.turnCurtailed', { curtailed: params.curtailed! });
      params.extra = extra;
    }
    return t(e.key, params);
  }

  private pushLog(entry: LogEntry): void {
    this.log.push(entry);
    if (this.log.length > LOG_LIMIT * 2) this.log.splice(0, this.log.length - LOG_LIMIT);
    const list = document.getElementById('log');
    if (!list) return;
    list.prepend(this.logItem(entry));
    while (list.children.length > LOG_LIMIT) list.lastElementChild?.remove();
  }

  private announce(text: string): void {
    const live = document.getElementById('live');
    if (live) live.textContent = text;
  }

  private toast(text: string, kind: 'ach' | 'info' = 'info'): void {
    const box = document.getElementById('toasts');
    if (!box) return;
    const el = h('div', { class: `toast toast-${kind}` }, kind === 'ach' ? icon('star', 'gold') : null, h('span', {}, text));
    box.append(el);
    setTimeout(() => el.remove(), 4000);
  }

  private shake(): void {
    if (this.settings.reducedMotion) return;
    const frame = document.getElementById('map-frame');
    if (!frame) return;
    frame.classList.remove('shake');
    void frame.offsetWidth;
    frame.classList.add('shake');
  }

  // ───────────────────────── interaction ─────────────────────────

  private setCursor(x: number, y: number): void {
    const s = this.state;
    if (!s) return;
    this.cursor = { x: Math.max(0, Math.min(s.width - 1, x)), y: Math.max(0, Math.min(s.height - 1, y)) };
    this.dirty = true;
    this.renderTools();
    this.renderInspector();
    const info = tileInfo(s, this.cursor.x, this.cursor.y);
    if (info) this.announce(t('a11y.tile', { terrain: t(`terrain.${info.terrain}` as TranslationKey), band: t(`band.${info.band}` as TranslationKey), value: info.pollution }));
  }

  private selectTool(i: number | null): void {
    this.tool = i;
    this.dirty = true;
    this.renderTools();
    if (i !== null) this.announce(this.toolLabel(TOOLS[i]!));
  }

  private activate(): void {
    if (this.tool === null || !this.state) return;
    this.dispatch(toolIntent(TOOLS[this.tool]!, this.cursor.x, this.cursor.y));
  }

  private endTurn(): void {
    this.dispatch({ kind: 'endTurn' });
  }

  private onKey(e: KeyboardEvent): void {
    if (this.listeningFor) {
      e.preventDefault();
      this.finishRebind(e.code);
      return;
    }
    const action = actionForCode(this.settings.keys, e.code);
    if (this.modalOpen) {
      if (action === 'cancel' || e.key === 'Escape') {
        const closable = document.querySelector('.modal[data-closable="true"]');
        if (closable) {
          e.preventDefault();
          this.closeModal();
        }
      }
      if (e.key === 'Tab') this.trapFocus(e);
      return;
    }
    if (!this.state) return;
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA')) return;
    const digit = /^Digit([1-9])$/.exec(e.code);
    if (digit) {
      const i = Number(digit[1]) - 1;
      if (i < TOOLS.length) this.selectTool(this.tool === i ? null : i);
      e.preventDefault();
      return;
    }
    const onButton = target?.tagName === 'BUTTON';
    switch (action) {
      case 'up':
        this.setCursor(this.cursor.x, this.cursor.y - 1);
        break;
      case 'down':
        this.setCursor(this.cursor.x, this.cursor.y + 1);
        break;
      case 'left':
        this.setCursor(this.cursor.x - 1, this.cursor.y);
        break;
      case 'right':
        this.setCursor(this.cursor.x + 1, this.cursor.y);
        break;
      case 'activate':
        if (onButton) return; // let Enter press the focused button
        this.activate();
        break;
      case 'endTurn':
        this.endTurn();
        break;
      case 'undo':
        this.undo();
        break;
      case 'cancel':
        if (this.tool !== null) this.selectTool(null);
        else this.showPause();
        break;
      case 'nextTool':
        this.selectTool(this.tool === null ? 0 : (this.tool + 1) % TOOLS.length);
        break;
      case 'prevTool':
        this.selectTool(this.tool === null ? TOOLS.length - 1 : (this.tool - 1 + TOOLS.length) % TOOLS.length);
        break;
      case 'hint':
        this.toggleHint();
        break;
      case 'lens':
        this.setLens(LENSES[(LENSES.indexOf(this.lens) + 1) % LENSES.length]!, true);
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  // ───────────────────────── lenses and hints ─────────────────────────

  /** The lens control next to the map (R-13.12): a radio group of three pressed buttons. */
  private renderMapBar(): void {
    const group = document.getElementById('lens-control');
    const hintBtn = document.getElementById('hint-btn');
    if (!group || !hintBtn) return;
    group.setAttribute('aria-label', t('a11y.lens'));
    clear(group);
    group.append(
      h('span', { class: 'lens-label', 'aria-hidden': 'true' }, icon('eye')),
      ...LENSES.map((l) =>
        h(
          'button',
          {
            class: `btn small lens-btn${l === this.lens ? ' active' : ''}`,
            role: 'radio',
            'aria-checked': l === this.lens ? 'true' : 'false',
            title: `${t(`lens.${l}` as TranslationKey)} (${keyLabel(this.settings.keys.lens)})`,
            onclick: () => this.setLens(l, true),
          },
          t(`lens.${l}` as TranslationKey),
        ),
      ),
    );
    clear(hintBtn);
    hintBtn.append(icon('bulb'), t('hud.hint'), h('kbd', { class: 'kbd-after' }, keyLabel(this.settings.keys.hint)));
    hintBtn.setAttribute('aria-pressed', this.advice ? 'true' : 'false');
    hintBtn.toggleAttribute('disabled', !this.state || isTerminal(this.state.phase));
  }

  private setLens(lens: Lens, announce: boolean): void {
    this.lens = lens;
    this.dirty = true;
    this.renderMapBar();
    if (announce) this.announce(t('lens.announce', { name: t(`lens.${lens}` as TranslationKey) }));
  }

  /** Opens the Guardian's advice (R-13.13), or closes it when it is already open. */
  private toggleHint(): void {
    const s = this.state;
    if (this.advice) {
      this.closeHint();
      return;
    }
    if (!s || isTerminal(s.phase)) return;
    const a = advise(s, this.forecast);
    if (!a) return;
    this.advice = a;
    this.dirty = true;
    this.renderHintCard();
    this.renderMapBar();
    this.announce(this.adviceText(a));
    document.querySelector<HTMLElement>('#hint-card .btn.primary')?.focus();
  }

  private renderHintCard(): void {
    const a = this.advice;
    const side = this.root.querySelector('.side');
    document.getElementById('hint-card')?.remove();
    if (!a || !side) return;
    const primary = a.intent
      ? h('button', { class: 'btn small primary', onclick: () => this.showMe() }, t('hint.show'))
      : a.id === 'endTurn' || a.id === 'noEnergy'
        ? h('button', { class: 'btn small primary', onclick: () => this.endTurn() }, t('hud.endTurn'))
        : null;
    const card = h(
      'div',
      { class: `hint-card${a.id === 'witherRisk' ? ' urgent' : ''}`, id: 'hint-card', role: 'note' },
      h('p', { class: 'hint-title' }, icon(a.id === 'witherRisk' ? 'warn' : 'bulb'), t('hint.title')),
      h('p', { class: 'hint-text' }, this.adviceText(a)),
      h('div', { class: 'row' }, h('button', { class: 'btn small', onclick: () => this.closeHint() }, t('hint.close')), primary),
    );
    side.prepend(card);
  }

  /** "Show me": selects the suggested tool and moves the cursor to its tile, without acting. */
  private showMe(): void {
    const intent = this.advice?.intent;
    if (!intent || intent.kind === 'endTurn') return;
    const i = TOOLS.findIndex((tool) => toolId(tool) === toolIdOf(intent));
    if (i >= 0) this.selectTool(i);
    this.setCursor(intent.x, intent.y);
    document.querySelector('#tools .tool.selected')?.scrollIntoView({ block: 'nearest' });
    this.renderer?.canvas.focus();
  }

  private closeHint(): void {
    if (!this.advice && !document.getElementById('hint-card')) return;
    this.advice = null;
    document.getElementById('hint-card')?.remove();
    this.dirty = true;
    this.renderMapBar();
  }

  /** The advice as a sentence, with 1-based coordinates like the inspector. */
  private adviceText(a: Advice): string {
    const p = a.params;
    const x = (a.at?.x ?? 0) + 1;
    const y = (a.at?.y ?? 0) + 1;
    const name = p.species ? t(`species.${p.species}` as TranslationKey) : p.building ? t(`building.${p.building}` as TranslationKey) : '';
    if (a.id === 'witherRisk') {
      const key: TranslationKey = (p.count ?? 1) > 1 ? 'advice.witherRiskMany' : 'advice.witherRisk';
      return t(key, { name, x, y, after: p.after ?? 0, limit: p.limit ?? 0, count: p.count ?? 1 });
    }
    return t(`advice.${a.id}` as TranslationKey, { name, x, y, gold: p.gold ?? 0 });
  }

  // ───────────────────────── tutorial ─────────────────────────

  /** The palette tool the visible tutorial step asks for (highlighted in the toolbar). */
  private tutorialTool(): string | null {
    const card = document.getElementById('tutorial');
    if (!card || card.classList.contains('minimized')) return null;
    const byStep: Record<number, string> = { 1: 'salvage', 2: 'build:solar', 3: 'plant:grass', 5: 'build:sealer' };
    return byStep[this.tutorialStep] ?? null;
  }

  /** Scrolls only the tool list (never the page) so the hinted tool is visible. */
  private revealHintedTool(): void {
    const grid = document.getElementById('tools');
    const btn = grid?.querySelector<HTMLElement>('.tool.hinted');
    if (!grid || !btn) return;
    const top = btn.offsetTop - grid.offsetTop;
    if (top < grid.scrollTop || top + btn.offsetHeight > grid.scrollTop + grid.clientHeight) grid.scrollTop = Math.max(0, top - 28);
  }

  private advanceTutorial(step: number): void {
    if (!this.settings.tutorial || !this.state) return;
    this.tutorialStep = step;
    document.getElementById('tutorial')?.remove();
    if (step > 5) return;
    // Docked at the top of the side column, so tips never cover map tiles (R-13.10).
    const side = this.root.querySelector('.side');
    if (!side) return;
    const card = h(
      'div',
      { class: 'tutorial', id: 'tutorial', role: 'note' },
      h('p', {}, h('strong', {}, `${step}/5 `), t(`tutorial.${step}` as TranslationKey)),
      h(
        'div',
        { class: 'row' },
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              this.tutorialStep = 99;
              document.getElementById('tutorial')?.remove();
              this.updateSettings({ tutorial: false });
              this.renderTools();
            },
          },
          t('tutorial.skip'),
        ),
        h(
          'button',
          {
            class: 'btn small primary',
            onclick: () => {
              if (step === 5) {
                this.tutorialStep = 99;
                document.getElementById('tutorial')?.remove();
              } else document.getElementById('tutorial')?.classList.add('minimized');
              this.renderTools();
            },
          },
          t('tutorial.next'),
        ),
      ),
    );
    side.prepend(card);
    this.renderTools();
    this.revealHintedTool();
  }

  // ───────────────────────── modals ─────────────────────────

  private openModal(title: string, body: HTMLElement[], cls = '', closable = true): void {
    this.closeModal();
    this.lastFocus = document.activeElement as HTMLElement | null;
    const modal = h(
      'div',
      { class: `modal ${cls}`, role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'modal-title', 'data-closable': closable ? 'true' : 'false' },
      h('h2', { id: 'modal-title' }, title),
      ...body,
    );
    const overlay = h('div', { class: 'overlay', id: 'overlay' }, modal);
    document.body.append(overlay);
    this.modalOpen = true;
    // Focus the most meaningful control: the chosen option, an explicit target, the main action.
    const focusable =
      modal.querySelector<HTMLElement>('input[type="radio"]:checked') ??
      modal.querySelector<HTMLElement>('[data-autofocus]') ??
      modal.querySelector<HTMLElement>('.btn.primary') ??
      modal.querySelector<HTMLElement>('button, input, select');
    focusable?.focus();
  }

  private closeModal(): void {
    document.getElementById('overlay')?.remove();
    this.listeningFor = null;
    if (this.modalOpen) {
      this.modalOpen = false;
      // The title screen may be stale (e.g. language changed in Settings): redraw it.
      if (!this.state) this.showTitle();
      else this.lastFocus?.focus?.();
    }
  }

  private trapFocus(e: KeyboardEvent): void {
    const modal = document.querySelector('.modal');
    if (!modal) return;
    const items = [...modal.querySelectorAll<HTMLElement>('button, input, select, [tabindex="0"]')].filter((x) => !x.hasAttribute('disabled'));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      last.focus();
      e.preventDefault();
    } else if (!e.shiftKey && document.activeElement === last) {
      first.focus();
      e.preventDefault();
    }
  }

  private showPause(): void {
    this.openModal(t('menu.pause'), [
      h(
        'nav',
        { class: 'menu' },
        h('button', { class: 'btn primary', onclick: () => this.closeModal() }, t('menu.resume')),
        h('button', { class: 'btn', onclick: () => this.showHelp() }, t('menu.howToPlay')),
        h('button', { class: 'btn', onclick: () => this.showJournal() }, t('hud.journal')),
        h('button', { class: 'btn', onclick: () => this.showAchievements() }, t('menu.achievements')),
        h('button', { class: 'btn', onclick: () => this.showSettings() }, t('menu.settings')),
        h('button', { class: 'btn', onclick: () => this.showNewGame() }, t('menu.newGame')),
        h('button', { class: 'btn ghost', onclick: () => this.showTitle() }, t('menu.mainMenu')),
      ),
    ]);
  }

  private backButton(): HTMLElement {
    return h('div', { class: 'modal-actions' }, h('button', { class: 'btn primary', onclick: () => (this.state ? this.closeModal() : this.showTitle()) }, t('menu.close')));
  }

  private showHelp(): void {
    const keys = ['goal', 'turns', 'gold', 'energy', 'pollution', 'plants', 'patterns'] as const;
    this.openModal(t('help.title'), [
      h('div', { class: 'help' }, ...keys.map((k) => h('p', {}, t(`help.${k}` as TranslationKey)))),
      h('p', { class: 'muted small' }, t('hud.keysHint')),
      this.backButton(),
    ]);
  }

  private showAchievements(): void {
    this.openModal(t('ach.title'), [
      h(
        'ul',
        { class: 'achievements' },
        ...ACHIEVEMENTS.map((id) => {
          const got = this.achievements.has(id);
          return h(
            'li',
            { class: got ? 'got' : 'locked' },
            h('span', { class: 'ach-icon', 'aria-hidden': 'true' }, icon(got ? 'star' : 'lock')),
            h('span', {}, h('strong', {}, t(`ach.${id}` as TranslationKey)), h('br'), h('span', { class: 'small' }, t(`ach.${id}.desc` as TranslationKey))),
            h('span', { class: 'sr-only' }, got ? '' : t('ach.locked')),
          );
        }),
      ),
      this.backButton(),
    ]);
  }

  private showJournal(): void {
    const s = this.state;
    const entries = s?.journal ?? [];
    this.openModal(t('hud.journal'), [
      ...(s ? this.progressChart(s) : []),
      entries.length ? h('div', { class: 'journal' }, ...entries.map((i) => h('blockquote', {}, t(`journal.${i}` as TranslationKey)))) : h('p', { class: 'muted' }, t('story.p3')),
      this.backButton(),
    ]);
  }

  /** The restoration / pollution chart of this game (R-11.20), or a note until it exists. */
  private progressChart(s: GameState): HTMLElement[] {
    const winRatio = DIFFICULTIES[s.difficulty].winRatio;
    const m = chartModel(s.history, winRatio);
    const title = h('h3', { class: 'chart-title' }, t('chart.title'));
    if (!m) return [title, h('p', { class: 'muted small' }, t('chart.empty'))];
    const sm = m.summary;
    return [
      title,
      chartElement(m, {
        aria: t('chart.aria', { turns: sm.turns, from: sm.fromRestored, to: sm.toRestored, pFrom: sm.fromPollution, pTo: sm.toPollution, goal: sm.goal }),
        restored: t('chart.restored'),
        pollution: t('chart.pollution'),
        goal: `${t('chart.goal')} ${sm.goal}%`,
        turn: t('chart.turn'),
      }),
    ];
  }

  /** Folds a finished game into the local records exactly once (R-10.7). */
  private recordFinishedGame(s: GameState): RecordUpdate | null {
    if (!s.outcome) return null;
    const key = `${s.seed}:${s.difficulty}:${s.outcome.turn}:${s.outcome.result}:${s.outcome.score}`;
    if (this.recorded?.key === key) return this.recorded.update;
    const update = recordGame(this.records, s.difficulty, s.outcome);
    this.records = update.records;
    writeStore(RECORDS_KEY, JSON.stringify(this.records));
    this.recorded = { key, update };
    return update;
  }

  private showJournalEntry(i: number): void {
    setTimeout(() => {
      if (this.modalOpen || !this.state || isTerminal(this.state.phase)) return;
      this.openModal(t('hud.journal'), [h('blockquote', { class: 'journal-entry' }, t(`journal.${i}` as TranslationKey)), this.backButton()]);
    }, 500);
  }

  private showSettings(): void {
    const st = this.settings;
    const toggle = (key: 'highContrast' | 'reducedMotion' | 'sound' | 'music' | 'patterns' | 'tutorial', label: TranslationKey) =>
      h(
        'label',
        { class: 'switch' },
        h('input', {
          type: 'checkbox',
          checked: st[key],
          onchange: (e: Event) => {
            this.updateSettings({ [key]: (e.target as HTMLInputElement).checked } as Partial<Settings>);
            this.renderAll();
          },
        }),
        h('span', {}, t(label)),
      );
    const keyRows = KEY_ACTIONS.map((a) =>
      h(
        'div',
        { class: 'key-row' },
        h('span', {}, t(`key.${a}` as TranslationKey)),
        h('button', { class: 'btn small key', id: `key-${a}`, onclick: () => this.startRebind(a) }, ...this.keyCap(st.keys[a])),
      ),
    );
    this.openModal(t('settings.title'), [
      h(
        'div',
        { class: 'settings' },
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'set-lang' }, t('settings.language')),
          h(
            'select',
            {
              id: 'set-lang',
              class: 'input',
              'data-autofocus': true,
              onchange: (e: Event) => {
                this.updateSettings({ lang: (e.target as HTMLSelectElement).value as Lang });
                this.showSettings();
                document.getElementById('set-lang')?.focus();
              },
            },
            h('option', { value: 'en', selected: st.lang === 'en' }, 'English'),
            h('option', { value: 'uz', selected: st.lang === 'uz' }, "O'zbekcha"),
          ),
        ),
        h(
          'div',
          { class: 'field' },
          h('label', { for: 'set-scale' }, t('settings.scale')),
          h(
            'select',
            {
              id: 'set-scale',
              class: 'input',
              onchange: (e: Event) => {
                this.updateSettings({ scale: Number((e.target as HTMLSelectElement).value) });
              },
            },
            ...SCALES.map((sc) => h('option', { value: sc, selected: st.scale === sc }, `${Math.round(sc * 100)}%`)),
          ),
        ),
        toggle('highContrast', 'settings.contrast'),
        toggle('reducedMotion', 'settings.motion'),
        toggle('sound', 'settings.sound'),
        toggle('music', 'settings.music'),
        toggle('patterns', 'settings.patterns'),
        toggle('tutorial', 'settings.tutorial'),
        h('h3', {}, t('settings.keys')),
        h('div', { class: 'keys' }, ...keyRows),
        h('p', { class: 'small bad', id: 'key-msg', role: 'alert' }),
        h(
          'button',
          {
            class: 'btn small',
            onclick: () => {
              this.updateSettings({ keys: { ...DEFAULT_KEYS } });
              this.showSettings();
            },
          },
          t('settings.keys.reset'),
        ),
      ),
      this.backButton(),
    ]);
  }

  private startRebind(a: KeyAction): void {
    this.listeningFor = a;
    const btn = document.getElementById(`key-${a}`);
    if (btn) btn.textContent = t('settings.keys.press');
  }

  private finishRebind(code: string): void {
    const a = this.listeningFor;
    this.listeningFor = null;
    if (!a) return;
    const msg = document.getElementById('key-msg');
    if (code === 'Escape' && a !== 'cancel') {
      const btn = document.getElementById(`key-${a}`);
      if (btn) this.setKeyCap(btn, this.settings.keys[a]);
      return;
    }
    const r = rebind(this.settings.keys, a, code);
    if (r.ok) {
      this.updateSettings({ keys: r.keys });
      if (msg) msg.textContent = '';
    } else if (msg) {
      msg.textContent = t('settings.keys.conflict', { action: r.conflict === 'reserved' ? '1–9' : t(`key.${r.conflict}` as TranslationKey) });
    }
    const btn = document.getElementById(`key-${a}`);
    if (btn) {
      this.setKeyCap(btn, this.settings.keys[a]);
      btn.focus();
    }
    this.renderHud();
  }

  /** Key cap content: pixel arrows for arrow keys (with a spoken name), text otherwise. */
  private keyCap(code: string): (Node | string)[] {
    const arrow = ARROW_ICONS[code];
    if (!arrow) return [keyLabel(code)];
    return [icon(arrow, 'key-ico'), h('span', { class: 'sr-only' }, code.replace('Arrow', 'Arrow '))];
  }

  private setKeyCap(btn: HTMLElement, code: string): void {
    clear(btn);
    btn.append(...this.keyCap(code));
  }

  private showEnd(): void {
    const s = this.state;
    if (!s || !s.outcome) return;
    document.getElementById('tutorial')?.remove();
    const won = s.outcome.result === 'victory';
    removeStore(SAVE_KEY);
    const sum = summary(s);
    const text = won ? t('end.victoryText', { turns: s.turn }) : t(s.outcome.reason === 'collapse' ? 'end.defeatText.collapse' : 'end.defeatText.time');
    const difficulty = s.difficulty;
    const seed = s.seed;
    const artSprites = won ? ['grass', 'shrub', 'tree', 'sanctuary', 'tree', 'shrub', 'grass'] : ['stack', 'ruin', 'stack'];
    const rec = this.recordFinishedGame(s);
    const badges = [
      rec?.bestScore ? h('span', { class: 'end-badge' }, icon('star'), t('end.newBest')) : null,
      rec?.fewestTurns ? h('span', { class: 'end-badge' }, icon('star'), t('end.newFastest')) : null,
    ].filter((b): b is HTMLSpanElement => b !== null);
    this.openModal(
      t(won ? 'end.victory' : 'end.defeat'),
      [
        h('div', { class: 'end-art', 'aria-hidden': 'true' }, ...artSprites.map((n) => h('img', { src: spriteDataUrl(n, 3), alt: '' }))),
        h('p', { class: 'lead' }, text),
        ...(badges.length ? [h('p', { class: 'end-badges' }, ...badges)] : []),
        ...this.progressChart(s),
        h(
          'dl',
          { class: 'end-stats' },
          h('dt', {}, t('end.seed')),
          h('dd', {}, h('code', {}, String(s.seed))),
          h('dt', {}, t('end.turns')),
          h('dd', {}, s.turn),
          h('dt', {}, t('end.restored')),
          h('dd', {}, `${sum.restored} (${Math.round(sum.ratio * 100)}%)`),
          h('dt', {}, t('end.planted')),
          h('dd', {}, s.stats.planted + s.stats.spread),
          h('dt', {}, t('end.goldEarned')),
          h('dd', {}, s.gold.earned),
          h('dt', {}, t('end.score')),
          h('dd', { class: 'score' }, s.outcome.score),
        ),
        h(
          'div',
          { class: 'modal-actions' },
          h('button', { class: 'btn', onclick: () => this.showTitle() }, t('menu.mainMenu')),
          h('button', { class: 'btn primary', onclick: () => this.startWith(createGame(won ? Math.floor(Math.random() * 1_000_000) : seed, difficulty), true) }, t('menu.playAgain')),
        ),
      ],
      won ? 'end victory' : 'end defeat',
      false,
    );
  }

  // ───────────────────────── frame loop ─────────────────────────

  private loop(): void {
    let last = 0;
    const frame = (now: number) => {
      requestAnimationFrame(frame);
      const s = this.state;
      const r = this.renderer;
      if (!s || !r) return;
      const animate = !this.settings.reducedMotion;
      if (animate && now - last > 140) {
        last = now;
        r.tick();
        this.dirty = true;
      }
      if (r.hasFloaters()) this.dirty = true;
      if (!this.dirty) return;
      this.dirty = false;
      const tool = this.tool !== null ? TOOLS[this.tool]! : null;
      const ghost = tool && !isTerminal(s.phase) ? { sprite: previewSprite(tool), ok: previewTool(s, tool, this.cursor.x, this.cursor.y).ok } : null;
      r.draw(s, {
        cursor: this.cursor,
        ghost,
        risk: isTerminal(s.phase) ? new Set() : this.risk,
        hint: this.advice?.at ?? null,
        lens: this.lens,
        range: rangeFor(s, this.cursor.x, this.cursor.y, tool),
        patterns: this.settings.patterns,
        reducedMotion: this.settings.reducedMotion,
        highContrast: this.settings.highContrast,
      });
    };
    requestAnimationFrame(frame);
  }
}
