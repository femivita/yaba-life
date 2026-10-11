import { JOBS, jobById } from '../sim/Jobs';
import { SPEEDS, fmtH, type Life, type Running, type ToastKind } from '../sim/Life';
import { DAYS, NEEDS, NEED_INFO, RENT_WEEKLY, SKILLS, SKILL_INFO, clockText, naira, skillXpFor } from '../sim/State';
import { PEOPLE } from '../npc/People';
import { relLabel } from '../npc/Social';

export interface MenuOption {
  label: string;
  icon?: string;
  detail?: string;
  disabled?: string | null;
  onPick: () => void;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * Life-sim HUD in the spirit of The Sims: needs bars and mood, wallet and
 * clock, speed controls, an action queue bubble, context menus for objects
 * and people, a conversation panel and a phone with job, skills, friends,
 * wants and bank tabs.
 */
export class LifeUI {
  private root: HTMLElement;
  private needsEl: HTMLElement;
  private moodEl: HTMLElement;
  private moneyEl: HTMLElement;
  private dayEl: HTMLElement;
  private actEl: HTMLElement;
  private toasts: HTMLElement;
  private menu: HTMLElement;
  private promptEl: HTMLElement;
  private dlg: HTMLElement;
  private phone: HTMLElement;
  private modal: HTMLElement;
  private wantsEl: HTMLElement;
  private speedBtns: HTMLButtonElement[] = [];
  private menuOpts: MenuOption[] = [];
  private phoneTab = 'job';
  onSpeed: (i: number) => void = () => {};
  onCancel: () => void = () => {};
  onInteract: () => void = () => {};
  menuOpen = false;

  constructor(private life: Life) {
    this.root = document.createElement('div');
    this.root.id = 'life';
    this.root.innerHTML = `
      <div class="top">
        <div class="pill money"></div>
        <div class="pill day"></div>
        <div class="speeds"></div>
      </div>
      <div class="needs card2"><div class="mood"></div><div class="bars"></div><div class="wants"></div></div>
      <div class="act hidden"></div>
      <div class="toasts"></div>
      <div class="prompt hidden"></div>
      <div class="menu hidden"></div>
      <div class="dlg hidden"></div>
      <button class="phonebtn" title="Phone (P)">📱</button>
      <button class="usebtn hidden">✋</button>
      <div class="phone hidden"></div>
      <div class="modal hidden"></div>`;
    document.body.appendChild(this.root);
    const q = (s: string) => this.root.querySelector(s) as HTMLElement;
    this.needsEl = q('.bars');
    this.moodEl = q('.mood');
    this.wantsEl = q('.wants');
    this.moneyEl = q('.money');
    this.dayEl = q('.day');
    this.actEl = q('.act');
    this.toasts = q('.toasts');
    this.menu = q('.menu');
    this.promptEl = q('.prompt');
    this.dlg = q('.dlg');
    this.phone = q('.phone');
    this.modal = q('.modal');
    const sp = q('.speeds');
    ['⏸', '▶', '▶▶', '▶▶▶'].forEach((t, i) => {
      const b = document.createElement('button');
      b.textContent = t;
      b.title = ['Pause', 'Normal', 'Fast', 'Ultra'][i] + ` (${i === 0 ? 'Space' : i})`;
      b.addEventListener('click', () => this.onSpeed(i));
      sp.appendChild(b);
      this.speedBtns.push(b);
    });
    this.needsEl.innerHTML = NEEDS.map((n) => `<div class="need" data-n="${n}"><span class="ic">${NEED_INFO[n].icon}</span><span class="lb">${NEED_INFO[n].label}</span><i><b></b></i></div>`).join('');
    q('.phonebtn').addEventListener('click', () => this.togglePhone());
    q('.usebtn').addEventListener('click', () => this.onInteract());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyP') this.togglePhone();
      if (this.menuOpen && /^Digit[1-9]$/.test(e.code)) {
        const o = this.menuOpts[Number(e.code.slice(5)) - 1];
        if (o && !o.disabled) {
          this.hideMenu();
          o.onPick();
        }
      }
      if (e.code === 'Escape') {
        this.hideMenu();
        this.hideDialogue();
        this.togglePhone(false);
        this.hideModal();
      }
    });
  }

  // -------------------------------------------------------------------
  // per-frame

  update() {
    const s = this.life.s;
    this.moneyEl.textContent = naira(s.money);
    this.moneyEl.classList.toggle('neg', s.money < 3000);
    this.dayEl.textContent = `${DAYS[this.life.weekday].slice(0, 3)} ${clockText(s.minutes)} · Day ${this.life.day + 1}${s.location === 'home' && !this.life.lightOn() ? ' · 🔌 NEPA took light' : ''}`;
    for (const n of NEEDS) {
      const el = this.needsEl.querySelector(`[data-n="${n}"] b`) as HTMLElement;
      const v = s.needs[n];
      el.style.width = `${v}%`;
      el.style.background = v > 60 ? '#2ecc71' : v > 30 ? '#f1c40f' : '#e74c3c';
    }
    const m = this.life.moodLabel();
    this.moodEl.innerHTML = `<span class="gem" style="background:${m.color}"></span> ${m.text}`;
    this.moodEl.title = this.life.moodlets().map((x) => `${x.mood > 0 ? '+' : ''}${x.mood} ${x.label}`).join('\n');
    this.speedBtns.forEach((b, i) => b.classList.toggle('on', i === this.life.speedIndex && !this.life.running));
    this.activity(this.life.running);
  }

  private wantsKey = '';
  updateWants() {
    const ws = this.life.wants(3);
    const key = ws.map((w) => w.id).join();
    if (key === this.wantsKey) return;
    this.wantsKey = key;
    this.wantsEl.innerHTML = `<div class="wh">Wants</div>${ws.map((w) => `<div class="want">${w.icon} ${esc(w.label)}</div>`).join('')}`;
  }

  private lastAct = '';
  private activity(r: Running | null) {
    if (!r) {
      if (this.lastAct) {
        this.actEl.classList.add('hidden');
        this.lastAct = '';
      }
      return;
    }
    const key = r.label;
    if (key !== this.lastAct) {
      this.lastAct = key;
      this.actEl.classList.remove('hidden');
      this.actEl.innerHTML = `<span class="ai">${r.icon}</span><div class="at"><div>${esc(r.label)}</div><i><b></b></i></div><button title="Cancel (move to cancel)">✕</button>`;
      this.actEl.querySelector('button')!.addEventListener('click', () => this.onCancel());
    }
    (this.actEl.querySelector('b') as HTMLElement).style.width = `${Math.min(100, (r.elapsed / r.total) * 100)}%`;
  }

  // -------------------------------------------------------------------

  toast(msg: string, kind: ToastKind = 'info') {
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.textContent = msg;
    this.toasts.prepend(el);
    while (this.toasts.children.length > 4) this.toasts.lastChild!.remove();
    setTimeout(() => el.classList.add('out'), 5200);
    setTimeout(() => el.remove(), 5800);
  }

  prompt(text: string | null) {
    const use = this.root.querySelector('.usebtn') as HTMLElement;
    if (!text || this.menuOpen) {
      this.promptEl.classList.add('hidden');
      use.classList.add('hidden');
      return;
    }
    this.promptEl.classList.remove('hidden');
    this.promptEl.innerHTML = `<kbd>E</kbd> ${esc(text)}`;
    use.classList.remove('hidden');
  }

  showMenu(title: string, sub: string, opts: MenuOption[]) {
    this.menuOpts = opts;
    this.menuOpen = true;
    this.menu.classList.remove('hidden');
    this.menu.innerHTML = `<div class="mh"><b>${esc(title)}</b><span>${esc(sub)}</span><button class="x">✕</button></div>` +
      opts.map((o, i) => `<button class="mi${o.disabled ? ' off' : ''}" data-i="${i}"><span class="k">${i < 9 ? i + 1 : ''}</span><span class="mic">${o.icon ?? ''}</span><span class="ml">${esc(o.label)}${o.detail ? `<em>${esc(o.detail)}</em>` : ''}${o.disabled ? `<em class="why">${esc(o.disabled)}</em>` : ''}</span></button>`).join('');
    this.menu.querySelector('.x')!.addEventListener('click', () => this.hideMenu());
    this.menu.querySelectorAll('.mi').forEach((b) =>
      b.addEventListener('click', () => {
        const o = opts[Number((b as HTMLElement).dataset.i)];
        if (o.disabled) return;
        this.hideMenu();
        o.onPick();
      }),
    );
  }

  hideMenu() {
    this.menuOpen = false;
    this.menu.classList.add('hidden');
  }

  // -------------------------------------------------------------------
  // conversation

  dialogue(who: { name: string; title: string; rel: number; label: string }, lines: { tunde?: string; them?: string }, acts: MenuOption[]) {
    this.dlg.classList.remove('hidden');
    const pct = (who.rel + 100) / 2;
    this.dlg.innerHTML = `
      <div class="dh"><div><b>${esc(who.name)}</b><span>${esc(who.title)}</span></div>
        <div class="rel"><i><b style="width:${pct}%;background:${who.rel >= 0 ? '#2ecc71' : '#e74c3c'}"></b></i><span>${esc(who.label)} (${Math.round(who.rel)})</span></div>
        <button class="x">✕</button></div>
      <div class="lines">${lines.tunde ? `<p class="me">Tunde: “${esc(lines.tunde)}”</p>` : ''}${lines.them ? `<p class="them">${esc(who.name)}: “${esc(lines.them)}”</p>` : ''}</div>
      <div class="acts">${acts.map((a, i) => `<button data-i="${i}" ${a.disabled ? 'class="off"' : ''} title="${esc(a.disabled ?? a.detail ?? '')}">${a.icon ?? ''} ${esc(a.label)}</button>`).join('')}</div>`;
    this.dlg.querySelector('.x')!.addEventListener('click', () => this.hideDialogue());
    this.dlg.querySelectorAll('.acts button').forEach((b) =>
      b.addEventListener('click', () => {
        const a = acts[Number((b as HTMLElement).dataset.i)];
        if (!a.disabled) a.onPick();
      }),
    );
  }

  get dialogueOpen() {
    return !this.dlg.classList.contains('hidden');
  }

  hideDialogue() {
    this.dlg.classList.add('hidden');
  }

  // -------------------------------------------------------------------
  // modal (travel, work style, intro)

  showModal(title: string, html: string, opts: MenuOption[], dismissable = true) {
    this.modal.classList.remove('hidden');
    this.modal.innerHTML = `<div class="mbox"><h2>${esc(title)}</h2><div class="mbody">${html}</div><div class="mopts">${opts.map((o, i) => `<button data-i="${i}" ${o.disabled ? 'class="off"' : ''}><span>${o.icon ?? ''}</span><span>${esc(o.label)}${o.detail ? `<em>${esc(o.detail)}</em>` : ''}${o.disabled ? `<em class="why">${esc(o.disabled)}</em>` : ''}</span></button>`).join('')}</div>${dismissable ? '<button class="x">✕</button>' : ''}</div>`;
    this.modal.querySelector('.x')?.addEventListener('click', () => this.hideModal());
    this.modal.querySelectorAll('.mopts button').forEach((b) =>
      b.addEventListener('click', () => {
        const o = opts[Number((b as HTMLElement).dataset.i)];
        if (o.disabled) return;
        this.hideModal();
        o.onPick();
      }),
    );
  }

  hideModal() {
    this.modal.classList.add('hidden');
  }

  get modalOpen() {
    return !this.modal.classList.contains('hidden');
  }

  // -------------------------------------------------------------------
  // phone

  togglePhone(show?: boolean) {
    const s = show ?? this.phone.classList.contains('hidden');
    this.phone.classList.toggle('hidden', !s);
    if (s) this.renderPhone();
  }

  renderPhone() {
    const L = this.life;
    const s = L.s;
    const tabs: [string, string][] = [['job', '💼 Job'], ['skills', '📚 Skills'], ['people', '👥 People'], ['wants', '⭐ Wants'], ['bank', '🏦 Bank']];
    let body = '';
    if (this.phoneTab === 'job') {
      const j = L.job();
      if (j && s.job) {
        const lvl = j.levels[s.job.level];
        const next = j.levels[s.job.level + 1];
        body += `<h4>${esc(j.name)}</h4><p><b>${esc(lvl.title)}</b> · ${naira(lvl.pay)} per shift</p>
          <p>Hours: ${j.days.length === 7 ? 'every day' : j.days.length === 5 ? 'Mon–Fri' : 'Mon–Sat'}, ${fmtH(j.start)}–${fmtH(j.start + j.hours)} at ${esc(placeName(j.place))}</p>
          <p>Performance</p><div class="bar"><b style="width:${Math.max(0, s.job.performance)}%"></b></div>
          ${next ? `<p class="dim">Next: ${esc(next.title)} (${naira(next.pay)}), needs ${SKILL_INFO[j.skill].label} ${next.skill}</p>` : '<p class="dim">Top of the ladder!</p>'}
          <p class="dim">${esc(j.blurb)}</p><button class="quit">Quit job</button>`;
      } else {
        body += '<p>No job yet. Sapa is calling! Visit these employers and ask for work:</p>';
      }
      body += '<h4>Jobs in Yaba</h4>' + JOBS.map((jj) => `<div class="row"><b>${esc(jj.name)}</b><span>${naira(jj.levels[0].pay)}/shift · ${fmtH(jj.start)}–${fmtH(jj.start + jj.hours)}${jj.levels[0].skill ? ` · needs ${SKILL_INFO[jj.skill].label} ${jj.levels[0].skill}` : ''}</span><span class="dim">Talk to ${esc(PEOPLE.find((p) => p.id === jj.employer)!.name)} at ${esc(placeName(jj.place))}</span></div>`).join('');
      body += '<p class="dim">Hustle: hawk pure water at Yaba bus terminal or Ojuelegba any time from 6am to 8pm.</p>';
    } else if (this.phoneTab === 'skills') {
      body = SKILLS.map((k) => {
        const sk = s.skills[k];
        return `<div class="row"><b>${SKILL_INFO[k].icon} ${SKILL_INFO[k].label} · level ${sk.level}</b><div class="bar"><b style="width:${(sk.xp / skillXpFor(sk.level)) * 100}%"></b></div></div>`;
      }).join('') + '<p class="dim">Practise coding on your laptop, at CcHUB or the UNILAG library. Charisma grows from talking to people and the mirror. Hustle grows at the market. Cooking grows at your gas cooker.</p>';
    } else if (this.phoneTab === 'people') {
      const met = s.metNpcs.map((id) => PEOPLE.find((p) => p.id === id)).filter(Boolean);
      body = met.length ? met.map((p) => {
        const v = s.relationships[p!.id] ?? 0;
        return `<div class="row"><b>${esc(p!.name)}</b><span class="dim">${esc(p!.title)}</span><div class="bar"><b style="width:${(v + 100) / 2}%;background:${v >= 0 ? '#2ecc71' : '#e74c3c'}"></b></div><span>${relLabel(v)} (${Math.round(v)})</span></div>`;
      }).join('') : '<p>You have not met anybody yet.</p>';
      body += '<p class="dim">People to find: Iya Bisi (Yaba Market), Emeka (bus terminal), Chidi (Banilux Bar, evenings), Kemi (CcHUB), Amaka (UNILAG library, weekdays), Mallam Sani (suya outside White House, evenings).</p>';
    } else if (this.phoneTab === 'wants') {
      const ws = L.wants(20);
      body = ws.map((w) => `<div class="row"><b>${w.icon} ${esc(w.label)}</b><span class="dim">Reward ${naira(w.reward)} and a good mood</span></div>`).join('') + `<p class="dim">Fulfilled: ${s.wantsDone.length}</p>`;
    } else {
      const over = L.rentOverdue();
      body = `<h4>Balance: ${naira(s.money)}</h4><p>Rent: ${naira(RENT_WEEKLY)} weekly to Baba. ${over ? `<b class="neg">${over} day(s) overdue</b>` : `Paid through Day ${s.rentPaidThroughDay + 1}`}</p>
        <p>Foodstuff at home: ${s.inventory.foodstuff ?? 0} · Snacks: ${s.inventory.snack ?? 0}</p>` +
        s.ledger.slice(0, 14).map((l) => `<div class="tx"><span>${esc(l.what)}</span><b class="${l.amount < 0 ? 'neg' : 'pos'}">${l.amount < 0 ? '' : '+'}${naira(l.amount)}</b></div>`).join('');
    }
    this.phone.innerHTML = `<div class="ph"><b>📱 Tunde's phone</b><button class="x">✕</button></div><div class="tabs">${tabs.map(([k, t]) => `<button data-t="${k}" class="${k === this.phoneTab ? 'on' : ''}">${t}</button>`).join('')}</div><div class="pbody">${body}</div>`;
    this.phone.querySelector('.x')!.addEventListener('click', () => this.togglePhone(false));
    this.phone.querySelectorAll('.tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.phoneTab = (b as HTMLElement).dataset.t!;
        this.renderPhone();
      }),
    );
    this.phone.querySelector('.quit')?.addEventListener('click', () => {
      L.quit();
      this.renderPhone();
    });
  }
}

function placeName(id: string) {
  if (id === 'yaba_bus_terminal') return 'Yaba Bus Terminal';
  const names: Record<string, string> = { yaba_market: 'Yaba Market', banilux_bar: 'Banilux Bar', cchub: 'CcHUB' };
  return names[id] ?? id;
}

export { jobById, SPEEDS };
