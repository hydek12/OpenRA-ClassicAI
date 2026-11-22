'use strict';

const squadViewer = (() => {
  const byId = id => document.getElementById(id);
  const kinds = ['Assault', 'Rush', 'Protection', 'Air', 'Naval'];
  const reasons = {
    assault_threshold: 'Assault size threshold met',
    rush_evaluation: 'Rush evaluation approved',
    damage_response: 'Response to an attack',
    air_assignment: 'Air unit assignment',
    naval_assignment: 'Naval unit assignment',
    existing_squad: 'Squad present when recording began',
    unavailable: 'Unit no longer available',
    destroyed: 'Unit destroyed',
    owner_changed: 'Unit changed owners',
    left_world: 'Unit left the map',
    released: 'Members released',
  };
  const triggers = {
    ground_engagement_approved: 'Engagement check approved the attack',
    continue_advance: 'Squad continued toward its target',
    unit_ready_to_engage: 'Unit was ready to engage',
    air_target_attackable: 'Aircraft could engage its target',
  };
  const outcomes = {
    formed: 'Squad created',
    reinforced: 'Existing squad reinforced',
    below_threshold: 'Below threshold',
    no_unassigned_attacker: 'No unassigned attacker',
    no_reachable_base: 'No reachable enemy base',
    declined_engagement: 'Engagement declined',
  };
  const seconds = (run, tick) => tick * (run.setup.timestepMs ?? 1000 / run.setup.tickRate) / 1000;
  const elapsed = value => value.toFixed(2) + ' s';
  const whole = value => Number.isSafeInteger(value) && value >= 0;
  const nonempty = value => typeof value === 'string' && value.trim().length > 0;
  const unitIsValid = unit => unit && whole(unit.id) && nonempty(unit.type) && nonempty(unit.name);
  const unitLabel = unit => unit.name + ' #' + unit.id;
  const squadLabel = squad => squad.kind + ' #' + squad.id;
  const label = (labels, code) => Object.hasOwn(labels, code) ? labels[code] : code.replaceAll('_', ' ');
  let runs = [];
  let events = [];
  let position = 0;
  let firstSquads = [];
  let overviewKey;
  let overviewCursors = [];
  let ledger;
  let emptyLedger;

  function element(parent, tag, value = '', className) {
    const node = document.createElement(tag);
    node.textContent = value;
    if (className) node.className = className;
    parent.append(node);
    return node;
  }

  function validate(trace, cutoff = Number.MAX_SAFE_INTEGER) {
    if (trace === undefined) return;
    const invalid = () => { throw new Error('The squad or attack trace is invalid.'); };
    const tick = value => whole(value) && value <= cutoff;
    if (!trace || !Array.isArray(trace.squads) || !Array.isArray(trace.decisions)) invalid();

    const squadsById = new Map();
    const attacks = [];
    for (const squad of trace.squads) {
      if (!squad || !whole(squad.id) || !squad.id || squadsById.has(squad.id) ||
          !kinds.includes(squad.kind) || !tick(squad.createdAt) || !nonempty(squad.reason) ||
          !Array.isArray(squad.membershipChanges) ||
          (squad.initialTarget !== undefined && !unitIsValid(squad.initialTarget)) ||
          (squad.disbandedAt !== undefined && (!tick(squad.disbandedAt) || squad.disbandedAt < squad.createdAt))) invalid();
      squadsById.set(squad.id, squad);

      const members = new Set();
      let previous = squad.createdAt;
      for (const change of squad.membershipChanges) {
        if (!tick(change?.tick) || change.tick < previous || change.tick > (squad.disbandedAt ?? cutoff) ||
            !unitIsValid(change.unit) || !nonempty(change.reason)) invalid();
        if (change.action === 'joined' && !members.has(change.unit.id)) members.add(change.unit.id);
        else if (change.action === 'left' && members.has(change.unit.id)) members.delete(change.unit.id);
        else invalid();
        previous = change.tick;
      }
      if (squad.disbandedAt !== undefined && members.size) invalid();

      const attack = squad.firstAttack;
      const firstJoin = squad.membershipChanges.find(change => change.action === 'joined');
      if (attack !== undefined && (!attack || !whole(attack.sequence) || !attack.sequence ||
          !tick(attack.queuedAt) || attack.queuedAt < squad.createdAt ||
          !firstJoin || attack.queuedAt < firstJoin.tick ||
          !tick(attack.issuedAt) || attack.issuedAt < attack.queuedAt || !nonempty(attack.order) ||
          !nonempty(attack.trigger) || !unitIsValid(attack.target) ||
          !Array.isArray(attack.units) || !attack.units.length || !attack.units.every(unitIsValid) ||
          new Set(attack.units.map(unit => unit.id)).size !== attack.units.length ||
          (attack.assessedEnemies !== undefined && !whole(attack.assessedEnemies)))) invalid();
      if (attack) attacks.push(attack);
    }

    attacks.sort((a, b) => a.sequence - b.sequence);
    if (attacks.some((attack, index) => attack.sequence !== index + 1 ||
        (index > 0 && attack.issuedAt < attacks[index - 1].issuedAt))) invalid();

    let previous = 0;
    for (const decision of trace.decisions) {
      const linked = squadsById.get(decision?.squadId);
      if (!tick(decision?.tick) || decision.tick < previous || !['assault', 'rush'].includes(decision.kind) ||
          !whole(decision.available) || !whole(decision.required) || !whole(decision.unassigned) ||
          decision.unassigned > decision.available || !nonempty(decision.outcome) ||
          (decision.squadId !== undefined && (!linked || linked.createdAt > decision.tick ||
            linked.kind.toLowerCase() !== decision.kind || !['formed', 'reinforced'].includes(decision.outcome)))) invalid();
      previous = decision.tick;
    }
  }

  function latestTick(trace) {
    if (!trace) return 0;
    let end = trace.decisions.at(-1)?.tick ?? 0;
    for (const squad of trace.squads)
      end = Math.max(end, squad.createdAt, squad.disbandedAt ?? 0, squad.firstAttack?.issuedAt ?? 0,
        squad.membershipChanges.at(-1)?.tick ?? 0);
    return end;
  }

  function example(interval, attackTick) {
    const rush = interval === 4;
    const formed = attackTick - (rush ? 30 : 48);
    const target = { id: 45, type: 'e1', name: 'Rifle Infantry' };
    const units = rush ? [{ id: 71, type: 'e1', name: 'Rifle Infantry' }] :
      [{ id: 74, type: 'jeep', name: 'Ranger' }, { id: 75, type: 'e1', name: 'Rifle Infantry' }];
    const reason = rush ? 'rush_evaluation' : 'assault_threshold';
    const id = rush ? 2 : 1;
    const squads = [];
    if (rush) {
      const protectedAt = formed - 260;
      squads.push({
        id: 1, kind: 'Protection', createdAt: protectedAt, reason: 'damage_response',
        membershipChanges: [{ tick: protectedAt, action: 'joined', reason: 'damage_response',
          unit: { id: 73, type: 'e3', name: 'Rocket Soldier' } }],
      });
    }
    squads.push({
      id, kind: rush ? 'Rush' : 'Assault', createdAt: formed, reason,
      membershipChanges: units.map(unit => ({ tick: formed, action: 'joined', unit, reason })),
      firstAttack: { sequence: 1, queuedAt: attackTick, issuedAt: attackTick, order: 'AttackMove',
        trigger: 'ground_engagement_approved', assessedEnemies: 1, units, target },
    });
    return {
      squads,
      decisions: [{
        tick: formed - 200, kind: 'assault', available: 0, unassigned: 0, required: 2, outcome: 'below_threshold',
      }, {
        tick: formed, kind: rush ? 'rush' : 'assault', available: 2, unassigned: units.length,
        required: 2, outcome: 'formed', squadId: id,
      }],
    };
  }

  function describeDecision(decision) {
    const name = decision.kind === 'rush' ? 'Rush check' : 'Assault check';
    const count = decision.kind === 'rush'
      ? decision.available + ' ground units, ' + decision.unassigned + ' unassigned'
      : decision.available + ' eligible';
    return name + ' · ' + count + ' · threshold ' + decision.required + ' · ' + label(outcomes, decision.outcome);
  }

  function unitCounts(units) {
    const counts = new Map();
    for (const unit of units) counts.set(unit.name, (counts.get(unit.name) ?? 0) + 1);
    return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([name, count]) => name + (count > 1 ? ' ×' + count : ''));
  }

  function describeAttack(run, attack, compact = false) {
    const assessed = attack.assessedEnemies === undefined ? '' :
      ' · ' + attack.assessedEnemies + (attack.assessedEnemies === 1 ? ' enemy assessed' : ' enemies assessed');
    const participants = compact ? unitCounts(attack.units) : attack.units.map(unitLabel);
    return label(triggers, attack.trigger) + assessed + '. ' + attack.order + ' toward ' +
      unitLabel(attack.target) + ' · queued ' + elapsed(seconds(run, attack.queuedAt)) +
      ' · issued to ' + participants.join(', ');
  }

  function show(nextRuns) {
    runs = nextRuns;
    const hasTrace = runs.some(run => run.squadTimeline);
    byId('squads-empty').hidden = hasTrace;
    byId('squads-content').hidden = !hasTrace;
    events = [];
    overviewKey = undefined;
    firstSquads = runs.map(run => run.squadTimeline?.squads.find(squad => squad.firstAttack?.sequence === 1)?.id);
    byId('squad-first-filter').hidden = firstSquads.every(id => id === undefined);
    byId('squad-first-only').checked = false;
    for (const [index, run] of runs.entries()) {
      const trace = run.squadTimeline;
      if (!trace) continue;
      const add = (tick, squad, action, detail, check = false, sequence = 0) => events.push({
        time: seconds(run, tick), index, kind: squad?.kind, squadId: squad?.id,
        squad: squad?.text ?? (squad ? squadLabel(squad) : '—'),
        action, detail, check, sequence,
      });
      const squadById = new Map(trace.squads.map(squad => [squad.id, squad]));
      for (const decision of trace.decisions) {
        const kind = decision.kind === 'rush' ? 'Rush' : 'Assault';
        add(decision.tick, squadById.get(decision.squadId) ?? { kind, text: kind }, 'Decision',
          describeDecision(decision), true);
      }
      for (const squad of trace.squads) {
        const target = squad.initialTarget ? ' · initial target ' + unitLabel(squad.initialTarget) : '';
        const firstJoin = squad.membershipChanges.find(change => change.action === 'joined');
        if (!firstJoin && !squad.firstAttack) continue;
        if (firstJoin?.tick !== squad.createdAt)
          add(squad.createdAt, squad, 'Registered', label(reasons, squad.reason) + target);
        if (firstJoin) {
          const entry = squad.reason === 'existing_squad' ? 'Roster observed' : 'Formed';
          add(firstJoin.tick, squad, entry, label(reasons, squad.reason) + target);
        }
        const changes = [];
        for (const change of squad.membershipChanges) {
          const previous = changes.at(-1);
          if (previous?.tick === change.tick && previous.action === change.action && previous.reason === change.reason)
            previous.units.push(change.unit);
          else changes.push({ ...change, units: [change.unit] });
        }
        for (const change of changes)
          add(change.tick, squad, change.action === 'joined' ? 'Joined' : 'Left',
            change.units.map(unitLabel).join(', ') + ' · ' + label(reasons, change.reason));
        if (squad.firstAttack) {
          const attack = squad.firstAttack;
          if (attack.queuedAt < attack.issuedAt)
            add(attack.queuedAt, squad, 'Attack queued', label(triggers, attack.trigger) + ' · toward ' + unitLabel(attack.target));
          add(attack.issuedAt, squad, 'First attack', describeAttack(run, attack), false, attack.sequence);
        }
        if (squad.disbandedAt !== undefined)
          add(squad.disbandedAt, squad, 'Disbanded', 'Squad removed');
      }
    }
    const priority = { Decision: 0, Registered: 1, Formed: 2, 'Roster observed': 2, Joined: 3, Left: 3,
      'Attack queued': 4, 'First attack': 5, Disbanded: 6 };
    events.sort((a, b) => a.time - b.time || a.index - b.index ||
      priority[a.action] - priority[b.action] || a.sequence - b.sequence);

    const filter = byId('squad-filter');
    const selected = filter.value;
    const availableKinds = new Set(events.map(event => event.kind));
    filter.replaceChildren();
    element(filter, 'option', 'All types').value = '';
    for (const kind of kinds)
      if (availableKinds.has(kind)) element(filter, 'option', kind).value = kind;
    filter.value = availableKinds.has(selected) ? selected : '';

    const container = byId('squad-events');
    container.replaceChildren();
    container.scrollTop = 0;
    emptyLedger = element(container, 'p', 'No matching squad events by this time.');
    ledger = element(container, 'table');
    const header = ledger.createTHead().insertRow();
    for (const name of ['Time', 'Run', 'Squad', 'Event', 'Details'])
      element(header, 'th', name).scope = 'col';
    const body = ledger.createTBody();
    for (const event of events) {
      const row = event.row = body.insertRow();
      row.className = 'squad-run-' + event.index + (event.action === 'First attack' ? ' squad-first-attack' : '');
      element(row, 'td', elapsed(event.time));
      element(row, 'td', event.index ? 'B' : 'A');
      element(row, 'td', event.squad);
      element(row, 'td', event.action);
      element(row, 'td', event.detail);
    }
  }

  function summary(time) {
    const summaries = byId('squad-summaries');
    const expanded = [...summaries.querySelectorAll('details[open]')].map(details => details.dataset.run);
    summaries.replaceChildren();
    runs.forEach((run, index) => {
      const box = element(summaries, 'section', '', 'squad-summary run-' + index);
      const runName = index === 0 ? 'Run A' : 'Run B';
      element(box, 'h3', runName);
      if (!run.squadTimeline) {
        element(box, 'p', 'Squad trace unavailable');
        return;
      }

      let formed = 0;
      let members = 0;
      const active = [];
      let first;
      for (const squad of run.squadTimeline.squads) {
        const observed = tick => seconds(run, tick) <= time + 1e-7;
        if (!observed(squad.createdAt)) continue;
        const roster = new Map();
        let hadMembers = false;
        for (const change of squad.membershipChanges) {
          if (!observed(change.tick)) break;
          if (change.action === 'joined') {
            hadMembers = true;
            roster.set(change.unit.id, change.unit);
          } else roster.delete(change.unit.id);
        }
        if (hadMembers && squad.reason !== 'existing_squad') formed++;
        if (roster.size && (squad.disbandedAt === undefined || !observed(squad.disbandedAt))) {
          active.push({ squad, roster });
          members += roster.size;
        }
        const attack = squad.firstAttack;
        if (attack && observed(attack.issuedAt) && (!first || attack.sequence < first.attack.sequence))
          first = { squad, attack };
      }

      element(box, 'p', formed + ' formed · ' + active.length + ' active · ' + members + ' assigned');
      if (!first) {
        element(box, 'small', 'No squad attack recorded by this time');
      } else {
        const { squad, attack } = first;
        const joined = squad.membershipChanges.find(change => change.action === 'joined');
        element(box, 'strong', squadLabel(squad) + ' ordered its first attack at ' + elapsed(seconds(run, attack.issuedAt)));
        if (joined) {
          const formation = seconds(run, joined.tick);
          const delay = seconds(run, attack.issuedAt) - formation;
          const existing = squad.reason === 'existing_squad';
          element(box, 'small', (existing ? 'Roster first observed at ' : 'Formed at ') + elapsed(formation) +
            ' · ' + label(reasons, squad.reason) + ' · ' + elapsed(delay) + ' to first order');
        }
        const formationDecision = run.squadTimeline.decisions.find(decision => decision.squadId === squad.id);
        if (formationDecision) element(box, 'small', describeDecision(formationDecision));
        element(box, 'small', describeAttack(run, attack, true));
      }
      const details = element(box, 'details');
      details.dataset.run = index;
      details.open = expanded.includes(String(index));
      element(details, 'summary', 'Active rosters');
      const list = element(details, 'ul');
      for (const { squad, roster } of active)
        element(list, 'li', squadLabel(squad) + ' · ' + [...roster.values()].map(unitLabel).join(', '));
      if (!active.length) element(list, 'li', 'No active squads');
    });
  }

  function matchesFilter(event, filter, firstOnly) {
    return (!filter || event.kind === filter) &&
      (!firstOnly || event.squadId === undefined || event.squadId === firstSquads[event.index]);
  }

  function renderOverview(time, filter, firstOnly) {
    const extent = Number(byId('economy-time').max) || .01;
    const percentage = value => Math.min(100, value / extent * 100) + '%';
    const key = filter + '/' + firstOnly;
    if (overviewKey !== key) {
      const panel = byId('squad-overview');
      panel.replaceChildren();
      const scale = element(panel, 'div', '', 'squad-overview-scale');
      element(scale, 'span', '0 s');
      element(scale, 'span', elapsed(extent));
      overviewCursors = [];
      for (const [index, run] of runs.entries()) {
        const lane = element(panel, 'div', '', 'squad-overview-lane');
        element(lane, 'span', index ? 'B' : 'A', 'squad-overview-label run-' + index);
        const rail = element(lane, 'div', '', 'squad-overview-rail run-' + index);
        const trace = run.squadTimeline;
        if (trace) {
          const end = run.observation?.observedThroughTick ?? latestTick(trace);
          element(rail, 'span', '', 'squad-overview-window').style.width = percentage(seconds(run, end));
          for (const event of events) {
            if (event.index !== index || !matchesFilter(event, filter, firstOnly)) continue;
            if (event.action !== 'Formed' && event.action !== 'First attack') continue;
            const marker = element(rail, 'span', '', event.action === 'Formed' ? 'squad-formed-dot' : 'squad-attack-dot');
            marker.style.left = percentage(event.time);
            marker.dataset.time = event.time;
            marker.title = event.squad + ' · ' + event.action + ' · ' + elapsed(event.time);
          }
        }
        overviewCursors.push(element(rail, 'span', '', 'squad-overview-cursor'));
      }
      const legend = element(panel, 'div', '', 'squad-overview-legend');
      for (const [kind, text] of [['formed', 'Squad formed'], ['attack', 'First attack by a squad']]) {
        const item = element(legend, 'span');
        element(item, 'i', '', 'squad-' + kind + '-dot');
        item.append(' ' + text);
      }
      overviewKey = key;
    }
    for (const marker of overviewCursors)
      marker.style.left = percentage(time);
  }

  function render(time) {
    position = time;
    if (byId('squads-content').hidden) return;
    summary(time);
    const filter = byId('squad-filter').value;
    const firstOnly = byId('squad-first-only').checked;
    renderOverview(time, filter, firstOnly);
    const showChecks = byId('squad-checks').checked;
    let hasVisible = false;
    for (const event of events) {
      const visible = event.time <= time + 1e-7 && matchesFilter(event, filter, firstOnly) && (showChecks || !event.check);
      const hide = !visible;
      if (event.row.hidden !== hide) event.row.hidden = hide;
      hasVisible ||= visible;
    }
    ledger.hidden = !hasVisible;
    emptyLedger.hidden = hasVisible;
  }

  byId('squad-filter').addEventListener('change', () => render(position));
  byId('squad-first-only').addEventListener('change', () => render(position));
  byId('squad-checks').addEventListener('change', () => render(position));
  byId('squad-overview').addEventListener('click', event => {
    const marker = event.target.closest('[data-time]');
    if (marker) {
      economyViewer.seekEvent(Number(marker.dataset.time));
      return;
    }
    const rail = event.target.closest('.squad-overview-rail');
    if (!rail) return;
    const bounds = rail.getBoundingClientRect();
    if (bounds.width > 0)
      economyViewer.selectTime((event.clientX - bounds.left) / bounds.width * Number(byId('economy-time').max));
  });

  return { example, latestTick, show, render, validate };
})();
