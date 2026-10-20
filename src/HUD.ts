import { KINDS, KIND_BY_ID, POWERUPS, type PowerupType } from './ObjectFactory';
import { TITLES, titleIndex, titleProgress } from './rules';

const $ = (id: string) => document.getElementById(id)!;
const FEED_MAX = 5;
const FEED_LIFE_MS = 2600;

export interface RunStats {
    size: number;
    eaten: number;
    bestCombo: number;
    collection: ReadonlyMap<string, number>;
}

/** Number part of a size; switches to kilometres from 1 km (see `sizeUnit`). */
export function formatSize(size: number): string {
    const v = size >= 1000 ? size / 1000 : size;
    return v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : v.toFixed(0);
}

export const sizeUnit = (size: number) => (size >= 1000 ? 'km' : 'm');

/** "12.3 m", "4.56 km" */
export const formatLength = (size: number) => `${formatSize(size)} ${sizeUnit(size)}`;

function formatClock(seconds: number): string {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/** All DOM updates for the in-game HUD and the pause / result screens. */
export class HUD {
    private sizeVal = $('size-val');
    private sizeUnitEl = $('size-unit');
    private staminaEl = $('stamina');
    private staminaFill = $('stamina-fill');
    private lastStamina = '';
    private titleVal = $('title-val');
    private nextTitle = $('next-title');
    private progress = $('progress-fill');
    private timer = $('timer');
    private eatenVal = $('eaten-val');
    private powerups = $('powerups');
    private combo = $('combo');
    private feedList = $('feed');
    private bannerEl = $('banner');
    private hintEl = $('hint');

    private lastSize = '';
    private lastTitle = -1;
    private lastClock = '';
    private lastFeed: { kind: string; li: HTMLLIElement; n: number; at: number } | null = null;
    private chips = new Map<PowerupType, HTMLElement>();
    private hintTimer = 0;

    public show(withTimer: boolean) {
        $('hud').classList.remove('hidden');
        this.timer.classList.toggle('hidden', !withTimer);
    }

    public setSize(size: number) {
        const text = formatSize(size);
        if (text === this.lastSize) return;
        this.lastSize = text;
        this.sizeVal.textContent = text;
        this.sizeUnitEl.textContent = sizeUnit(size);
        this.progress.style.width = `${(titleProgress(size) * 100).toFixed(1)}%`;
        const i = titleIndex(size);
        if (i !== this.lastTitle) {
            this.lastTitle = i;
            this.titleVal.textContent = TITLES[i].name;
            this.nextTitle.textContent = i < TITLES.length - 1 ? `下一級 ${formatLength(TITLES[i + 1].size)}` : '最高稱號';
        }
    }

    public setTimer(seconds: number) {
        const text = formatClock(seconds);
        if (text === this.lastClock) return;
        this.lastClock = text;
        this.timer.textContent = text;
        this.timer.classList.toggle('urgent', seconds <= 30);
    }

    /** Sprint bar: shown while draining or refilling, greyed out while winded. */
    public setStamina(level: number, winded: boolean, sprinting: boolean) {
        const key = `${Math.round(level * 100)}${winded ? 'w' : ''}${sprinting ? 's' : ''}`;
        if (key === this.lastStamina) return;
        this.lastStamina = key;
        this.staminaEl.classList.toggle('show', level < 0.995 || sprinting);
        this.staminaEl.classList.toggle('winded', winded);
        this.staminaFill.style.transform = `scaleX(${level.toFixed(3)})`;
    }

    public setEaten(n: number) {
        this.eatenVal.textContent = String(n);
    }

    public setCombo(n: number) {
        this.combo.replaceChildren(el('span', 'x', `×${n}`), el('span', 'label', '連擊'));
        this.combo.classList.add('show');
        this.combo.classList.remove('bump');
        void this.combo.offsetWidth; // restart the pop animation
        this.combo.classList.add('bump');
    }

    public hideCombo() {
        this.combo.classList.remove('show');
    }

    /** "🐑 綿羊 ×3": repeated bites of the same kind merge into one line. */
    public feed(kindId: string, isNew: boolean) {
        const kind = KIND_BY_ID.get(kindId);
        if (!kind) return;
        const now = performance.now();
        const last = this.lastFeed;
        if (!isNew && last && last.kind === kindId && now - last.at < 1200 && last.li.isConnected) {
            last.n++;
            last.at = now;
            last.li.querySelector('.times')!.textContent = `×${last.n}`;
            return;
        }
        if (!isNew && last && now - last.at < 150) return; // a burst of mixed bites: keep the list readable
        const li = el('li', '');
        li.append(el('span', 'emoji', kind.emoji), el('span', 'name', kind.name), el('span', 'times', ''));
        if (isNew) li.append(el('span', 'new', '新發現'));
        this.pushFeed(li);
        this.lastFeed = { kind: kindId, li, n: 1, at: now };
    }

    public feedText(text: string, className: string) {
        this.pushFeed(el('li', className, text));
        this.lastFeed = null;
    }

    private pushFeed(li: HTMLLIElement) {
        this.feedList.append(li);
        while (this.feedList.children.length > FEED_MAX) this.feedList.firstElementChild!.remove();
        window.setTimeout(() => li.remove(), FEED_LIFE_MS);
    }

    public banner(big: string, sub: string) {
        const inner = el('div', 'inner');
        inner.append(el('div', 'big', big), el('div', 'sub', sub));
        this.bannerEl.replaceChildren(inner);
    }

    public hint(text: string, seconds: number) {
        this.hintEl.textContent = text;
        this.hintEl.classList.add('show');
        window.clearTimeout(this.hintTimer);
        if (seconds > 0) this.hintTimer = window.setTimeout(() => this.hintEl.classList.remove('show'), seconds * 1000);
    }

    public hideHint() {
        this.hintEl.classList.remove('show');
    }

    /** Power-up chips with a draining bar; only touches the DOM when a chip appears or expires. */
    public setPowerups(remaining: Readonly<Record<'magnet' | 'boost', number>>) {
        for (const type of ['magnet', 'boost'] as const) {
            const left = remaining[type];
            let chip = this.chips.get(type);
            if (left > 0 && !chip) {
                chip = el('div', 'chip');
                chip.style.setProperty('--c', `#${POWERUPS[type].color.toString(16).padStart(6, '0')}`);
                chip.append(el('span', 'dot'), el('span', '', POWERUPS[type].name), el('span', 'bar'));
                this.powerups.append(chip);
                this.chips.set(type, chip);
            } else if (left <= 0 && chip) {
                chip.remove();
                this.chips.delete(type);
                continue;
            }
            if (chip) (chip.lastElementChild as HTMLElement).style.transform = `scaleX(${left / POWERUPS[type].seconds})`;
        }
    }

    public renderCollection(container: HTMLElement, collection: ReadonlyMap<string, number>): number {
        let found = 0;
        container.replaceChildren(...KINDS.map(kind => {
            const n = collection.get(kind.id) ?? 0;
            const cell = el('div', n ? 'cell' : 'cell locked');
            if (n) {
                found++;
                cell.title = kind.name;
                cell.append(el('span', 'emoji', kind.emoji), el('span', 'n', `×${n}`));
            } else {
                cell.title = '尚未發現';
                cell.append(el('span', 'emoji', '?'));
            }
            return cell;
        }));
        return found;
    }

    public showPause(stats: RunStats) {
        const i = titleIndex(stats.size);
        $('pause-summary').textContent = `${formatLength(stats.size)} · ${TITLES[i].name} · 已吞下 ${stats.eaten} 件`;
        const found = this.renderCollection($('pause-collection'), stats.collection);
        $('pause-found').textContent = `${found} / ${KINDS.length}`;
        $('pause-screen').classList.remove('hidden');
    }

    public hidePause() {
        $('pause-screen').classList.add('hidden');
    }

    public showEnd(stats: RunStats, isRecord: boolean, best: number) {
        $('end-size').textContent = formatSize(stats.size);
        $('end-unit').textContent = sizeUnit(stats.size);
        $('end-title').textContent = isRecord ? TITLES[titleIndex(stats.size)].name : `${TITLES[titleIndex(stats.size)].name} · 最佳 ${formatLength(best)}`;
        $('end-record').classList.toggle('hidden', !isRecord);
        $('end-eaten').textContent = String(stats.eaten);
        $('end-combo').textContent = `×${stats.bestCombo}`;
        const found = this.renderCollection($('end-collection'), stats.collection);
        $('end-found').textContent = `${found}/${KINDS.length}`;
        $('hud').classList.add('hidden');
        $('end-screen').classList.remove('hidden');
    }
}
