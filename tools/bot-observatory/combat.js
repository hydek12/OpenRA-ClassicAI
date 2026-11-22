'use strict';

const combatViewer = (() => {
  const byId = id => document.getElementById(id);
  const clock = byId('combat-clock');
  const slider = byId('combat-time');
  const position = byId('combat-position');
  const openingOnly = byId('combat-opening-only');
  const filter = byId('combat-filter');
  const previous = byId('combat-previous');
  const next = byId('combat-next');
  const names = { contact: 'Contact', loss: 'Unit lost', retreat_decided: 'Retreat decided', retreat_order: 'Retreat order issued' };
  const reasons = {
    engagement_declined: 'Engagement check declined', no_reachable_target: 'No reachable target',
    threat_assessment: 'Threat assessment favored withdrawal', unsafe_approach: 'Approach judged unsafe',
    lost_visibility: 'Target remained out of sight',
  };
  let models = [];
  let matchTime = 0;
  let extent = 0;
  let rows = [];
  let table;
  let empty;
  let rails = [];
  let stops = [];
  let mixed = false;

  const whole = value => Number.isSafeInteger(value) && value >= 0;
  const label = value => typeof value === 'string' && value.trim().length > 0;
  const isUnit = unit => unit && whole(unit.id) && label(unit.name) && label(unit.type);
  const unitLabel = unit => unit.name + ' #' + unit.id;
  const duration = value => value.toFixed(2) + ' s';
  const roundUp = time => Math.ceil(time * 100 - 1e-7) / 100;
  const timestep = run => (run.setup.timestepMs ?? 1000 / run.setup.tickRate) / 1000;
  const latestTick = trace => trace?.events.at(-1)?.tick ?? 0;

  function element(parent, tag, value = '', className) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function example(squads, tick) {
    const squad = squads.squads.find(entry => entry.firstAttack);
    const { units, target } = squad.firstAttack;
    const flags = { squadId: squad.id, openingUnit: true, afterOpeningOrder: true, afterSquadOrder: true };
    return { events: [
      { ...flags, tick, kind: 'contact', unit: units[0], opponent: target, detail: 'dealt', damage: 12,
        openingContact: true, firstSquadContact: true },
      { ...flags, tick: tick + 38, kind: 'retreat_decided', detail: 'threat_assessment', retreatId: 1, unitCount: units.length },
      { ...flags, tick: tick + 40, kind: 'retreat_order', unit: units[0], detail: 'Move', retreatId: 1 },
      { ...flags, tick: tick + 85, kind: 'loss', unit: units[0], opponent: target, detail: 'enemy' },
    ] };
  }

  function validate(run, firstOrder, firstContact) {
    const trace = run.combatTimeline;
    if (trace === undefined) return;
    const invalid = () => { throw new Error('The combat or losses trace is invalid.'); };
    if (!trace || !Array.isArray(trace.events)) invalid();

    const squads = new Map((run.squadTimeline?.squads ?? []).map(squad => [squad.id, squad]));
    const retreats = new Map();
    const contacts = new Set();
    const losses = new Set();
    let openingContact = null;
    let previousTick = 0;
    const cutoff = run.observation?.observedThroughTick ?? Number.MAX_SAFE_INTEGER;
    for (const event of trace.events) {
      const squad = squads.get(event?.squadId);
      if (!event || !Object.hasOwn(names, event.kind) || !whole(event.tick) ||
          event.tick < previousTick || event.tick > cutoff ||
          (event.squadId !== undefined && (!squad || squad.createdAt > event.tick)) ||
          ['openingUnit', 'openingContact', 'afterOpeningOrder', 'afterSquadOrder', 'firstSquadContact'].some(
            flag => event[flag] !== undefined && typeof event[flag] !== 'boolean') ||
          (event.afterOpeningOrder ? firstOrder === null || event.tick < firstOrder :
            firstOrder !== null && event.tick > firstOrder) ||
          (event.openingUnit && !event.afterOpeningOrder) ||
          (event.unit !== undefined && !isUnit(event.unit)) ||
          (event.opponent !== undefined && !isUnit(event.opponent))) invalid();
      previousTick = event.tick;

      if (event.kind === 'contact') {
        if (!event.unit || !event.opponent || !whole(event.damage) || event.damage === 0 ||
            !['dealt', 'received'].includes(event.detail) || (!event.openingContact && !event.firstSquadContact) ||
            (event.afterSquadOrder && (!squad?.firstAttack || squad.firstAttack.issuedAt > event.tick))) invalid();
        if (event.openingContact) {
          if (!event.openingUnit || openingContact !== null) invalid();
          openingContact = event.tick;
        }
        if (event.firstSquadContact) {
          const phase = [event.squadId, Boolean(event.afterOpeningOrder), Boolean(event.afterSquadOrder)].join('/');
          if (!squad || contacts.has(phase)) invalid();
          contacts.add(phase);
        }
      } else if (event.kind === 'loss') {
        if (!event.unit || losses.has(event.unit.id) ||
            !['enemy', 'allied', 'other', 'unknown'].includes(event.detail)) invalid();
        losses.add(event.unit.id);
      } else if (event.kind === 'retreat_decided') {
        if (!squad || !whole(event.retreatId) || !event.retreatId || retreats.has(event.retreatId) ||
            !whole(event.unitCount) || !label(event.detail)) invalid();
        retreats.set(event.retreatId, event);
      } else {
        const retreat = retreats.get(event.retreatId);
        if (!event.unit || !retreat || retreat.squadId !== event.squadId || !label(event.detail)) invalid();
      }
    }
    if (openingContact !== firstContact) invalid();
  }

  function firstOrderOf(run) {
    return run.events.reduce((first, event) => event.type === 'attack_order' ? Math.min(first, event.tick) : first, Infinity);
  }

  function show(runs, mixingExamples) {
    mixed = mixingExamples;
    models = runs.map((run, index) => {
      const trace = run.combatTimeline;
      const tickSeconds = timestep(run);
      const anchor = firstOrderOf(run);
      const end = run.observation?.observedThroughTick ?? Math.max(latestTick(trace), Number.isFinite(anchor) ? anchor : 0);
      const squads = run.squadTimeline?.squads ?? [];
      return {
        index, trace, anchor, end, tickSeconds,
        squads: new Map(squads.map(squad => [squad.id, squad])),
        opening: squads.find(squad => squad.firstAttack?.sequence === 1),
        retreats: new Map((trace?.events ?? []).filter(event => event.kind === 'retreat_decided')
          .map(event => [event.retreatId, event])),
      };
    });
    const available = models.some(model => model.trace);
    const canAlign = models.some(model => model.trace && Number.isFinite(model.anchor));
    byId('combat-empty').hidden = available;
    byId('combat-content').hidden = !available;
    clock.options[0].disabled = !canAlign;
    clock.value = canAlign ? 'elapsed' : 'match';
    openingOnly.checked = false;
    if (available) rebuild(true);
  }

  const relative = () => clock.value === 'elapsed';

  function eventTime(model, tick) {
    return (tick - (relative() ? model.anchor : 0)) * model.tickSeconds;
  }

  function squadLabel(model, event) {
    const squad = model.squads.get(event.squadId);
    return squad ? squad.kind + ' #' + squad.id : 'Unassigned';
  }

  function describe(event) {
    if (event.kind === 'contact') {
      const scope = event.openingContact ? 'Opening contact · ' : event.afterSquadOrder ? 'After this squad’s order · ' : '';
      return scope + unitLabel(event.unit) + ' ' + event.detail + ' ' + event.damage + ' damage ' +
        (event.detail === 'dealt' ? 'to ' : 'from ') + unitLabel(event.opponent);
    }
    if (event.kind === 'loss') {
      if (event.opponent?.id === event.unit.id)
        return unitLabel(event.unit) + ' · recorded damage source is the same actor';
      const source = event.opponent ? ' · ' + event.detail + ' source ' + unitLabel(event.opponent) : ' · source unrecorded';
      return unitLabel(event.unit) + source;
    }
    if (event.kind === 'retreat_decided') {
      const reason = Object.hasOwn(reasons, event.detail) ? reasons[event.detail] : event.detail.replaceAll('_', ' ');
      return 'Retreat #' + event.retreatId + ' · ' + reason + ' · ' +
        event.unitCount + (event.unitCount === 1 ? ' unit' : ' units');
    }
    const order = event.detail === 'ReturnToBase' ? 'Return to base' : event.detail;
    return 'Retreat #' + event.retreatId + ' · ' + unitLabel(event.unit) + ' · ' + order;
  }

  function visibleEvent(model, event) {
    return (!relative() || event.afterOpeningOrder && Number.isFinite(model.anchor)) &&
      (!openingOnly.checked || event.openingUnit);
  }

  function rebuild(resetPosition = false) {
    const aligned = relative();
    byId('combat-relative').hidden = !aligned;
    byId('combat-match-note').hidden = aligned;
    byId('combat-match-note').textContent = 'Use Inspect at above to change the shared match clock.';
    extent = Math.max(.01, ...models.filter(model => model.trace && (!aligned || Number.isFinite(model.anchor)))
      .map(model => eventTime(model, model.end)));
    slider.max = position.max = roundUp(extent);
    if (resetPosition) slider.value = Math.min(Number(slider.max), 30);

    const visible = [];
    const selectedKind = filter.value;
    for (const model of models) {
      for (const event of model.trace?.events ?? []) {
        const kind = event.kind.startsWith('retreat_') ? 'retreat' : event.kind;
        if (visibleEvent(model, event) && (!selectedKind || kind === selectedKind))
          visible.push({ event, model, kind, time: eventTime(model, event.tick) });
      }
    }
    visible.sort((a, b) => a.time - b.time || a.model.index - b.model.index);
    const container = byId('combat-events');
    container.replaceChildren();
    empty = element(container, 'p', 'No matching combat events by this time.');
    table = element(container, 'table');
    const header = table.createTHead().insertRow();
    for (const name of [aligned ? 'After first order' : 'Match time', 'Run', 'Squad', 'Event', 'Details'])
      element(header, 'th', name).scope = 'col';
    const body = table.createTBody();
    rows = visible.map(item => {
      const { event, model, time } = item;
      const row = body.insertRow();
      row.className = 'squad-run-' + model.index;
      element(row, 'td', (aligned ? '+' : '') + duration(time));
      element(row, 'td', model.index ? 'B' : 'A');
      element(row, 'td', squadLabel(model, event));
      element(row, 'td', names[event.kind]);
      const origin = model.opening && model.opening.id !== event.squadId
        ? ' from ' + model.opening.kind + ' #' + model.opening.id
        : '';
      const cohort = event.openingUnit
        ? (event.kind === 'retreat_decided' ? ' · includes opening attack units' : ' · Opening attack unit' + origin) : '';
      const priorDecision = aligned && event.kind === 'retreat_order' &&
        !model.retreats.get(event.retreatId)?.afterOpeningOrder;
      const detail = describe(event) + cohort + (priorDecision ? ' · decided before first attack order' : '') +
        (aligned ? ' · match ' + duration(event.tick * model.tickSeconds) : '');
      element(row, 'td', detail);
      return { row, time };
    });
    stops = [...new Set(visible.map(({ time }) => roundUp(time)))];
    overview(visible);
    draw();
  }

  function percentage(time) {
    return Math.max(0, Math.min(100, 100 * time / extent)) + '%';
  }

  function overview(events) {
    const panel = byId('combat-overview');
    panel.replaceChildren();
    const scale = element(panel, 'div', '', 'squad-overview-scale');
    element(scale, 'span', '0 s');
    element(scale, 'span', duration(extent));
    rails = [];
    for (const model of models) {
      const lane = element(panel, 'div', '', 'squad-overview-lane');
      element(lane, 'span', model.index ? 'B' : 'A', 'squad-overview-label run-' + model.index);
      const rail = element(lane, 'div', '', 'squad-overview-rail run-' + model.index);
      if (model.trace && (!relative() || Number.isFinite(model.anchor))) {
        element(rail, 'span', '', 'squad-overview-window').style.width = percentage(eventTime(model, model.end));
        for (const item of events) {
          const { event, kind, time } = item;
          if (item.model !== model || event.kind === 'retreat_order') continue;
          const point = element(rail, 'span', '', 'combat-dot combat-dot-' + kind);
          point.style.left = percentage(time);
          point.dataset.time = time;
          point.title = names[event.kind] + ' · ' + duration(time) + ' · ' + squadLabel(model, event);
        }
      }
      rails.push(element(rail, 'span', '', 'squad-overview-cursor'));
    }
    const legend = element(panel, 'div', '', 'squad-overview-legend');
    for (const [kind, text] of [['contact', 'Contact'], ['loss', 'Loss'], ['retreat', 'Retreat decision']]) {
      const item = element(legend, 'span');
      element(item, 'i', '', 'combat-dot combat-dot-' + kind);
      item.append(' ' + text);
    }
  }

  function describeTime(model, tick) {
    const absolute = duration(tick * model.tickSeconds);
    return relative() ? '+' + duration(eventTime(model, tick)) + ' · match ' + absolute : absolute;
  }

  function summaries(time) {
    const parent = byId('combat-summaries');
    parent.replaceChildren();
    for (const model of models) {
      const box = element(parent, 'section', '', 'squad-summary combat-card run-' + model.index);
      element(box, 'h3', model.index ? 'Run B' : 'Run A');
      if (!model.trace) {
        element(box, 'p', 'Combat trace unavailable');
        continue;
      }
      if (relative() && !Number.isFinite(model.anchor)) {
        element(box, 'p', 'First attack order unobserved through ' + duration(model.end * model.tickSeconds));
        continue;
      }
      const events = model.trace.events.filter(event =>
        visibleEvent(model, event) && eventTime(model, event.tick) <= time + 1e-7);
      const losses = events.filter(event => event.kind === 'loss');
      const openings = losses.filter(event => event.openingUnit);
      const retreats = events.filter(event => event.kind === 'retreat_decided');
      const orders = events.filter(event => event.kind === 'retreat_order');
      const first = events.find(event => event.openingContact);
      const withdrawal = retreats[0];
      element(box, 'strong', first ? 'Opening contact ' + describeTime(model, first.tick) : 'Opening contact unobserved at this time');
      element(box, 'p', losses.length + ' tracked ' + (losses.length === 1 ? 'loss' : 'losses') +
        ' · ' + openings.length + ' from the opening attack');
      if (losses.length) {
        const byType = new Map();
        for (const { unit } of losses) byType.set(unit.name, (byType.get(unit.name) ?? 0) + 1);
        element(box, 'small', [...byType.entries()].map(([name, count]) => name + (count > 1 ? ' ×' + count : '')).join(', '));
      }
      element(box, 'small', retreats.length + ' retreat ' + (retreats.length === 1 ? 'decision' : 'decisions') +
        ' · ' + orders.length + ' unit ' + (orders.length === 1 ? 'order' : 'orders') + ' issued');
      if (withdrawal) {
        element(box, 'small', 'First retreat ' + describeTime(model, withdrawal.tick) + ' · ' + squadLabel(model, withdrawal));
        const dispatch = orders.find(order => order.retreatId === withdrawal.retreatId);
        element(box, 'small', dispatch ? 'Its first order issued ' + describeTime(model, dispatch.tick)
          : 'No order recorded for that retreat by this time');
      }
      if (relative()) {
        const count = model.opening?.firstAttack.units.length;
        const roster = count === undefined ? '' : ' · ' + count + (count === 1 ? ' unit' : ' units');
        element(box, 'small', 'First order at ' + duration(model.anchor * model.tickSeconds) + roster);
      }
      if (time >= eventTime(model, model.end) - .005)
        element(box, 'small', 'Observation through ' + describeTime(model, model.end));
    }
  }

  function draw() {
    const aligned = relative();
    const time = aligned ? Number(slider.value) : matchTime;
    if (aligned) {
      position.value = time.toFixed(2);
      slider.setAttribute('aria-valuetext', duration(time) + ' after first attack order');
    }
    if (!aligned && mixed)
      byId('combat-match-note').textContent = 'Use Inspect at above to inspect both clocks. One run is a simulated example.';
    else if (aligned && mixed)
      byId('combat-match-note').textContent = 'One run is a simulated example.';
    byId('combat-match-note').hidden = aligned && !mixed;
    summaries(time);
    let hasVisible = false;
    for (const item of rows) {
      const hide = item.time > time + 1e-7;
      if (item.row.hidden !== hide) item.row.hidden = hide;
      hasVisible ||= !hide;
    }
    table.hidden = !hasVisible;
    empty.hidden = hasVisible;
    previous.disabled = !stops.some(stop => stop < time - 1e-7);
    next.disabled = !stops.some(stop => stop > time + 1e-7);
    for (const cursor of rails) cursor.style.left = percentage(time);
  }

  function seek(time, marker = false) {
    if (!relative()) {
      if (marker) economyViewer.seekEvent(time);
      else economyViewer.selectTime(time);
      return;
    }
    const value = marker ? roundUp(time) : time;
    slider.value = Math.max(0, Math.min(Number(slider.max), value)).toFixed(2);
    draw();
  }

  function renderMatch(time) {
    matchTime = time;
    if (!byId('combat-content').hidden && !relative()) draw();
  }

  clock.addEventListener('change', () => rebuild(true));
  openingOnly.addEventListener('change', () => rebuild());
  filter.addEventListener('change', () => rebuild());
  slider.addEventListener('input', draw);
  position.addEventListener('change', () => seek(Number.isFinite(position.valueAsNumber) ? position.valueAsNumber : Number(slider.value)));
  previous.addEventListener('click', () => {
    const time = relative() ? Number(slider.value) : matchTime;
    const stop = stops.findLast(value => value < time - 1e-7);
    if (stop !== undefined) seek(stop, true);
  });
  next.addEventListener('click', () => {
    const time = relative() ? Number(slider.value) : matchTime;
    const stop = stops.find(value => value > time + 1e-7);
    if (stop !== undefined) seek(stop, true);
  });
  byId('combat-overview').addEventListener('click', event => {
    const marker = event.target.closest('[data-time]');
    if (marker) {
      seek(Number(marker.dataset.time), true);
      return;
    }
    const rail = event.target.closest('.squad-overview-rail');
    if (!rail) return;
    const bounds = rail.getBoundingClientRect();
    if (bounds.width) seek((event.clientX - bounds.left) / bounds.width * extent);
  });

  return { example, latestTick, validate, show, renderMatch };
})();
