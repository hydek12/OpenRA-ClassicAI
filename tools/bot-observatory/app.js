'use strict';

const milestones = [
  ['production_building', 'First production building'],
  ['combat_unit', 'First combat unit'],
  ['attack_order', 'First attack order'],
  ['enemy_contact', 'First enemy contact'],
];

const setup = {
  map: 'Example map',
  seed: 42,
  faction: 'Allies',
  opponent: 'Scripted example',
  spawn: 'west',
  tickRate: 25,
  botOrderQuotient: 4,
  difficulty: 'classic-normal',
};

function sampleRun(label, botTickInterval, ticks) {
  const squads = squadViewer.example(botTickInterval, ticks[2]);
  return {
    version: 1,
    label,
    setup: { ...setup, botTickInterval },
    events: milestones.map(([type], index) => ({ type, tick: ticks[index] })),
    economy: economyViewer.example(botTickInterval),
    squadTimeline: squads,
    combatTimeline: combatViewer.example(squads, ticks[3]),
    observation: { observedThroughTick: 2500, stopReason: 'tick_limit', exact: true, tickLimit: 2500 },
  };
}

const optionalControls = {
  mapUid: 'map checksum',
  botType: 'bot profile',
  localSeed: 'local random seed',
  botRandomSeed: 'isolated bot seed',
  timestepMs: 'simulation timestep',
};

const stopReasons = {
  in_progress: 'Recording in progress',
  match_ended: 'Match ended',
  milestones_complete: 'All milestones recorded',
  tick_limit: 'Simulation tick limit reached',
  wall_timeout: 'Wall-clock timeout',
  interrupted: 'Runner interrupted',
  client_exited: 'OpenRA exited',
  client_closed: 'OpenRA closed',
  world_closed: 'Match closed',
  out_of_sync: 'Simulation went out of sync',
  script_error: 'Map script failed',
};

const samples = [
  sampleRun('Run A', 2, [625, 1100, 1800, 2100]),
  sampleRun('Run B', 4, [625, 1100, 2010, 2360]),
];

function validateRun(run) {
  if (run?.version !== 1 || typeof run.label !== 'string' || !run.label.trim() ||
      !Array.isArray(run.events)) {
    throw new Error('Expected a version 1 log with a label and an events array.');
  }
  for (const [key, example] of Object.entries(samples[0].setup)) {
    const value = run.setup?.[key];
    if (typeof value !== typeof example ||
        (typeof value === 'string' && !value.trim()) ||
        (typeof value === 'number' && !Number.isSafeInteger(value))) {
      throw new Error('The ' + key + ' setup field is invalid.');
    }
  }
  for (const key of ['tickRate', 'botTickInterval', 'botOrderQuotient']) {
    if (run.setup[key] < 1) throw new Error(key + ' must be positive.');
  }
  for (const [key, label] of Object.entries(optionalControls)) {
    const value = run.setup[key];
    if (value === undefined) continue;
    const valid = key === 'timestepMs' || key === 'localSeed' || key === 'botRandomSeed'
      ? Number.isSafeInteger(value) && (key !== 'timestepMs' || value > 0)
      : typeof value === 'string' && value.trim();
    if (!valid) throw new Error('Invalid ' + label + '.');
  }
  const options = run.setup.lobbyOptions;
  if (options !== undefined && (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.values(options).some(value => typeof value !== 'string'))) {
    throw new Error('Lobby options must be an object with string values.');
  }
  for (const event of run.events) {
    if (typeof event?.type !== 'string' || !Number.isSafeInteger(event.tick) || event.tick < 0) {
      throw new Error('Each event needs a type and a nonnegative integer tick.');
    }
  }
  const observation = run.observation;
  if (observation !== undefined && (!observation ||
      !Number.isSafeInteger(observation.observedThroughTick) || observation.observedThroughTick < 0 ||
      typeof observation.exact !== 'boolean' || !Object.hasOwn(stopReasons, observation.stopReason) ||
      (observation.tickLimit !== undefined && (!Number.isSafeInteger(observation.tickLimit) || observation.tickLimit < 1)) ||
      run.events.some(event => event.tick > observation.observedThroughTick))) {
    throw new Error('The observation metadata is invalid.');
  }
  economyViewer.validate(run.economy, observation?.observedThroughTick);
  squadViewer.validate(run.squadTimeline, observation?.observedThroughTick);
  if (run.squadTimeline) {
    const firstOrder = run.squadTimeline.squads.find(squad => squad.firstAttack?.sequence === 1)?.firstAttack;
    if ((firstOrder?.issuedAt ?? null) !== firstTick(run, 'attack_order'))
      throw new Error('The first squad attack differs from the match milestone.');
  }
  combatViewer.validate(run, firstTick(run, 'attack_order'), firstTick(run, 'enemy_contact'));
  return run;
}

function firstTick(run, type) {
  let first = null;
  for (const event of run.events) {
    if (event.type === type && (first === null || event.tick < first)) first = event.tick;
  }
  return first;
}

function elapsedSeconds(run, type) {
  const tick = firstTick(run, type);
  return tick === null ? null : tickSeconds(run, tick);
}

function tickSeconds(run, tick) {
  return run.setup.timestepMs === undefined
    ? tick / run.setup.tickRate
    : tick * run.setup.timestepMs / 1000;
}

function setupDifferences(a, b) {
  const differences = [];
  function compare(label, left, right) {
    if (left !== right) differences.push(label + ' (' + (left ?? 'missing') + ' → ' + (right ?? 'missing') + ')');
  }
  for (const key of Object.keys(setup)) compare(key, a[key], b[key]);
  for (const [key, label] of Object.entries(optionalControls)) compare(label, a[key], b[key]);
  const optionsA = a.lobbyOptions ?? {};
  const optionsB = b.lobbyOptions ?? {};
  const optionIds = new Set([...Object.keys(optionsA), ...Object.keys(optionsB)]);
  for (const id of optionIds) {
    const left = Object.hasOwn(optionsA, id) ? optionsA[id] : undefined;
    const right = Object.hasOwn(optionsB, id) ? optionsB[id] : undefined;
    compare('lobby option ' + id, left, right);
  }
  return differences;
}

function cell(row, tag, value) {
  const element = document.createElement(tag);
  element.textContent = value;
  row.append(element);
  return element;
}

const inputs = [document.querySelector('#run-a'), document.querySelector('#run-b')];
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const tracks = document.querySelector('#tracks');
const comparison = document.querySelector('#comparison');
const runs = [...samples];
let usingExample = [true, true];
const loadVersions = [0, 0];
const loadErrors = ['', ''];

function renderTracks() {
  const eventTimes = runs.map(run => milestones.map(([type]) => elapsedSeconds(run, type)));
  const endTimes = runs.map(run => run.observation ? tickSeconds(run, run.observation.observedThroughTick) : null);
  const latest = Math.max(0, ...eventTimes.flat(), ...endTimes);
  const scaleStep = latest > 120 ? 60 : latest > 30 ? 15 : 5;
  const end = Math.max(scaleStep * 2, Math.ceil(latest / (scaleStep * 2)) * scaleStep * 2);
  tracks.replaceChildren();

  const scale = document.createElement('div');
  scale.className = 'timeline-scale';
  for (const value of [0, end / 2, end]) cell(scale, 'span', value + ' s');
  tracks.append(scale);

  eventTimes.forEach((times, runIndex) => {
    const lane = document.createElement('div');
    lane.className = 'timeline-lane';
    cell(lane, 'span', runIndex === 0 ? 'A' : 'B').className = 'lane-label';
    const rail = document.createElement('div');
    rail.className = 'timeline-rail';
    times.forEach((time, index) => {
      if (time === null) return;
      const point = cell(rail, 'span', '');
      point.className = 'timeline-point event-color-' + index;
      point.style.left = (time / end * 100) + '%';
      point.title = milestones[index][1] + ' · ' + time.toFixed(2) + ' s';
    });
    const observedEnd = endTimes[runIndex];
    if (observedEnd !== null) {
      const point = cell(rail, 'span', '');
      point.className = 'observation-point';
      point.style.left = (observedEnd / end * 100) + '%';
      point.title = observationSummary(runs[runIndex]);
    }
    lane.append(rail);
    tracks.append(lane);
  });
}

function observationSummary(run) {
  const observation = run.observation;
  if (!observation) return '';
  const time = tickSeconds(run, observation.observedThroughTick).toFixed(2);
  const tick = observation.observedThroughTick;
  const coverage = observation.exact ? 'observed through' : 'last confirmed checkpoint';
  return stopReasons[observation.stopReason] + ' · ' + coverage + ' tick ' + tick + ' (' + time + ' s)';
}

function render() {
  const differences = setupDifferences(runs[0].setup, runs[1].setup);
  if (runs[0].observation?.tickLimit !== runs[1].observation?.tickLimit) {
    differences.push('configured simulation tick limit');
  }
  const source = usingExample.every(Boolean) ? 'Simulated example data.' :
    usingExample.some(Boolean) ? 'One example run and one imported run.' : 'Two imported runs.';
  let controls = ' Recorded control settings match.';
  if (usingExample[0] !== usingExample[1]) {
    controls = ' Import a second log to compare recorded settings.';
  } else if (differences.length) {
    controls = ' Differences in ' + differences.join(', ') + ' can affect the timing comparison.';
  }
  status.textContent = source + controls;
  error.textContent = loadErrors.filter(Boolean).join(' ');

  renderTracks();

  const table = document.createElement('table');
  const heading = table.createTHead().insertRow();
  cell(heading, 'th', 'Event').scope = 'col';
  for (const [index, run] of runs.entries()) {
    const column = cell(heading, 'th', run.label);
    column.scope = 'col';
    column.append(Object.assign(document.createElement('small'), {
      textContent: run.setup.map + ' · seed ' + run.setup.seed +
        ' · interval ' + run.setup.botTickInterval + ' ticks',
    }));
    const summary = observationSummary(run);
    if (summary || !usingExample[index]) {
      cell(column, 'small', summary || 'Observation endpoint unavailable');
    }
  }
  cell(heading, 'th', 'B − A').scope = 'col';

  const body = table.createTBody();
  function addComparisonRow(label, times, eventIndex) {
    const row = body.insertRow();
    const heading = cell(row, 'th', label);
    heading.scope = 'row';
    if (eventIndex !== undefined) {
      const swatch = document.createElement('span');
      swatch.className = 'event-swatch event-color-' + eventIndex;
      swatch.setAttribute('aria-hidden', 'true');
      heading.prepend(swatch);
    }
    for (const time of times) cell(row, 'td', time === null ? '—' : time.toFixed(2) + ' s');
    const delta = times[1] === null || times[0] === null ? null : times[1] - times[0];
    cell(row, 'td', delta === null ? '—' : (delta > 0 ? '+' : '') + delta.toFixed(2) + ' s');
  }
  milestones.forEach(([type, label], index) => {
    addComparisonRow(label, runs.map(run => elapsedSeconds(run, type)), index);
  });
  addComparisonRow('Attack order to contact', runs.map(run => {
    const order = elapsedSeconds(run, 'attack_order');
    const contact = elapsedSeconds(run, 'enemy_contact');
    return order === null || contact === null || contact < order ? null : contact - order;
  }));
  comparison.replaceChildren(table);
  economyViewer.show(runs, usingExample[0] !== usingExample[1]);
}

inputs.forEach((input, index) => {
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const version = ++loadVersions[index];
    try {
      const run = validateRun(JSON.parse(await file.text()));
      if (loadVersions[index] !== version) return;
      runs[index] = run;
      usingExample[index] = false;
      loadErrors[index] = '';
    } catch (failure) {
      if (loadVersions[index] !== version) return;
      loadErrors[index] = 'Could not load ' + file.name + '. ' + failure.message +
        ' The previous run is still shown.';
      input.value = '';
    }
    render();
  });
});

document.querySelector('#reset').addEventListener('click', () => {
  inputs.forEach((input, index) => {
    ++loadVersions[index];
    input.value = '';
    runs[index] = samples[index];
    loadErrors[index] = '';
  });
  usingExample = [true, true];
  render();
});

render();
