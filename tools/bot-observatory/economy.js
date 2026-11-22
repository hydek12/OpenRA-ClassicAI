'use strict';

const economyViewer = (() => {
  const byId = id => document.getElementById(id);
  const cursor = byId('economy-time');
  const position = byId('economy-position');
  const queueFilter = byId('queue-filter');
  const different = byId('different-choices');
  const jump = byId('jump-to-gap');
  const attackButtons = [byId('economy-attack-a'), byId('economy-attack-b')];
  const number = new Intl.NumberFormat();
  const signed = new Intl.NumberFormat(undefined, { signDisplay: 'exceptZero' });
  const colors = ['#9bbbff', '#ffd083'];
  const labels = ['Run A', 'Run B'];
  const whole = value => Number.isSafeInteger(value) && value >= 0;
  const amount = (cash, ore) => number.format(cash + ore) + ' (' + number.format(cash) +
    ' cash · ' + number.format(ore) + ' ore)';
  const timeLabel = value => value.toFixed(2) + ' s';
  const tickLength = run => (run.setup.timestepMs ?? 1000 / run.setup.tickRate) / 1000;
  const timeOf = (run, tick) => tick * tickLength(run);
  const tickAt = (run, time) => Math.floor(time / tickLength(run) + 1e-7);
  const roundUpToCursor = time => Math.ceil(time * 100 - 1e-7) / 100;
  const cutoffOf = run => run.observation?.observedThroughTick ??
    Math.max(run.economy?.samples.at(-1)?.tick ?? 0, squadViewer.latestTick(run.squadTimeline),
      combatViewer.latestTick(run.combatTimeline));
  let runs = [];
  let extent = 0;
  let mixed = false;

  function text(parent, tag, value, className) {
    const element = document.createElement(tag);
    element.textContent = value;
    if (className) element.className = className;
    parent.append(element);
    return element;
  }

  function validate(economy, end = Number.MAX_SAFE_INTEGER) {
    if (economy === undefined) return;
    const fail = () => { throw new Error('The resource or production trace is invalid.'); };
    if (!economy || !whole(economy.sampleEveryTicks) || economy.sampleEveryTicks === 0 ||
        !Array.isArray(economy.samples) || !economy.samples.length || !Array.isArray(economy.jobs)) fail();
    const validTick = tick => whole(tick) && tick <= end;
    let previous = -1;
    for (const sample of economy.samples) {
      if (!validTick(sample?.tick) || sample.tick <= previous ||
          !['cash', 'ore', 'earned', 'productionPaid', 'productionRefunded'].every(key => whole(sample[key])) ||
          !Number.isSafeInteger(sample.netSpent) ||
          (sample.enabledQueues !== undefined && (!Array.isArray(sample.enabledQueues) ||
           sample.enabledQueues.some(queue => typeof queue !== 'string' || !queue.length)))) fail();
      for (const key of ['powerProvided', 'powerDrained']) {
        if (sample[key] !== undefined && !Number.isSafeInteger(sample[key])) fail();
      }
      previous = sample.tick;
    }

    let previousId = 0;
    let previousJobTick = 0;
    for (const job of economy.jobs) {
      if (!job || !whole(job.id) || job.id <= previousId || job.queuedAt < previousJobTick ||
          !['queue', 'item', 'name'].every(key => typeof job[key] === 'string' && job[key].length > 0) ||
          typeof job.isBuilding !== 'boolean' || !validTick(job.queuedAt) ||
          !['cost', 'cashPaid', 'orePaid', 'cashRefunded', 'oreRefunded'].every(key => whole(job[key])) ||
          ![job.payments, job.fundingWaits, job.pauses].every(Array.isArray) ||
          (job.cancellationReason !== undefined && typeof job.cancellationReason !== 'string')) fail();
      previousId = job.id;
      previousJobTick = job.queuedAt;
      previous = job.queuedAt;
      for (const tick of [job.startedAt, job.readyAt, job.completedAt, job.cancelledAt]) {
        if (tick === undefined) continue;
        if (!validTick(tick) || tick < previous) fail();
        previous = tick;
      }
      if (job.completedAt !== undefined && job.cancelledAt !== undefined) fail();

      let paidCash = 0;
      let paidOre = 0;
      previous = job.queuedAt;
      for (const payment of job.payments) {
        if (!validTick(payment?.firstTick) || !validTick(payment.tick) || payment.firstTick < previous ||
            payment.tick < payment.firstTick || !whole(payment.cash) || !whole(payment.ore)) fail();
        previous = payment.tick;
        paidCash += payment.cash;
        paidOre += payment.ore;
      }
      if (paidCash !== job.cashPaid || paidOre !== job.orePaid) fail();
      for (const wait of job.fundingWaits) {
        if (!validTick(wait?.startTick) || wait.startTick < job.queuedAt ||
            (wait.endTick !== undefined && (!validTick(wait.endTick) || wait.endTick < wait.startTick)) ||
            !whole(wait.required) || !Number.isSafeInteger(wait.available)) fail();
      }
      for (const pause of job.pauses) {
        if (!validTick(pause?.tick) || pause.tick < job.queuedAt || typeof pause.paused !== 'boolean') fail();
      }
    }
  }

  function example(interval) {
    const second = interval === 4;
    const define = (id, queue, item, name, cost, queuedAt, readyAt, completedAt) => ({
      id, queue, item, name, isBuilding: queue === 'Building', cost, queuedAt,
      startedAt: queuedAt + 1, readyAt, completedAt, cashPaid: cost, orePaid: 0,
      cashRefunded: 0, oreRefunded: 0, fundingWaits: [], pauses: [],
      payments: [{ firstTick: queuedAt + 1, tick: readyAt, cash: cost, ore: 0 }],
    });
    const jobs = [
      define(1, 'Building', 'powr', 'Power Plant', 300, 55, 330, 340),
      second ? define(2, 'Building', 'tent', 'Barracks', 300, 355, 585, 625) :
        define(2, 'Building', 'weap', 'War Factory', 1800, 355, 604, 625),
      second ? define(3, 'Infantry', 'e1', 'Rifle Infantry', 100, 685, 1099, 1100) :
        define(3, 'Vehicle', 'jeep', 'Ranger', 500, 685, 1099, 1100),
      define(4, 'Building', 'proc', 'Ore Refinery', 1400, 800, second ? 1575 : 1800, second ? 1600 : 1825),
    ];
    const ticks = [...new Set([0, 2500, ...jobs.flatMap(job => [job.queuedAt, job.readyAt, job.completedAt])])].sort((a, b) => a - b);
    return {
      sampleEveryTicks: 25,
      jobs,
      samples: ticks.map(tick => {
        const paid = jobs.filter(job => job.readyAt <= tick).reduce((total, job) => total + job.cost, 0);
        return { tick, cash: 5000 - paid, ore: 0, earned: 0, netSpent: paid, productionPaid: paid, productionRefunded: 0 };
      }),
    };
  }

  function sampleAt(run, time) {
    const tick = tickAt(run, time);
    return run.economy?.samples.findLast(sample => sample.tick <= tick);
  }

  function draw(canvas, metric) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = rect.width;
    const height = rect.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.scale(dpr, dpr);

    const left = 55;
    const right = width - 14;
    const top = 14;
    const bottom = height - 26;
    let maxValue = 0;
    for (const run of runs)
      for (const sample of run.economy?.samples ?? []) maxValue = Math.max(maxValue, metric(sample));
    const magnitude = 10 ** Math.floor(Math.log10(Math.max(5, maxValue)) - 0.5);
    const max = Math.ceil(Math.max(5, maxValue) / (magnitude * 3)) * magnitude * 3;
    const x = time => left + (right - left) * time / extent;
    const y = value => bottom - (bottom - top) * value / max;

    ctx.font = '11px system-ui, sans-serif';
    ctx.strokeStyle = '#35453e';
    ctx.fillStyle = '#b5c7be';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (let i = 0; i <= 3; i++) {
      const value = max * i / 3;
      const line = y(value);
      ctx.beginPath();
      ctx.moveTo(left, line);
      ctx.lineTo(right, line);
      ctx.stroke();
      ctx.fillText(number.format(value), left - 7, line);
    }
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    ctx.fillText('0 s', left, bottom + 7);
    ctx.textAlign = 'right';
    ctx.fillText(number.format(Math.round(extent)) + ' s', right, bottom + 7);

    runs.forEach((run, index) => {
      const samples = run.economy?.samples;
      if (!samples?.length) return;
      ctx.strokeStyle = colors[index];
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x(timeOf(run, samples[0].tick)), y(metric(samples[0])));
      for (let i = 1; i < samples.length; i++) {
        const point = x(timeOf(run, samples[i].tick));
        ctx.lineTo(point, y(metric(samples[i - 1])));
        ctx.lineTo(point, y(metric(samples[i])));
      }
      ctx.stroke();
    });
    ctx.strokeStyle = '#eaf0ed';
    ctx.lineWidth = 1;
    const line = x(Math.min(Number(cursor.value), extent));
    ctx.beginPath();
    ctx.moveTo(line, top);
    ctx.lineTo(line, bottom);
    ctx.stroke();
  }

  function renderBalances(time) {
    const balances = byId('economy-balances');
    balances.replaceChildren();
    const states = runs.map((run, index) => {
      const box = text(balances, 'section', '', 'economy-balance run-' + index);
      text(box, 'h3', labels[index]);
      const sample = sampleAt(run, time);
      if (!sample) {
        text(box, 'p', run.economy ? 'Awaiting first recorded sample' : 'No resource trace');
        return;
      }
      text(box, 'strong', amount(sample.cash, sample.ore));
      const cutoff = tickAt(run, time);
      const jobs = run.economy.jobs.filter(job => job.queuedAt <= cutoff);
      const completed = jobs.filter(job => job.completedAt !== undefined && job.completedAt <= cutoff).length;
      text(box, 'small', number.format(sample.productionPaid) + ' production paid · ' +
        number.format(sample.productionRefunded) + ' refunded · ' + number.format(sample.earned) + ' earned');
      const otherSpent = sample.netSpent - (sample.productionPaid - sample.productionRefunded);
      if (otherSpent !== 0) text(box, 'small', number.format(otherSpent) + ' other net spending');
      text(box, 'small', jobs.length + ' queued · ' + completed + ' completed · funds sampled at ' +
        timeLabel(timeOf(run, sample.tick)));
      if (sample.enabledQueues) {
        text(box, 'small', sample.enabledQueues.length ? 'Enabled queues · ' + sample.enabledQueues.join(', ') : 'No queues enabled');
      }
      if (sample.powerProvided !== undefined && sample.powerDrained !== undefined) {
        text(box, 'small', 'Power ' + number.format(sample.powerProvided) + ' supplied · ' +
          number.format(sample.powerDrained) + ' used');
      }
      return { sample, queued: jobs.length, completed };
    });
    const difference = byId('economy-difference');
    difference.hidden = mixed || states.some(state => !state);
    if (difference.hidden) return;
    const [a, b] = states;
    difference.textContent = 'B − A · ' + signed.format(b.queued - a.queued) + ' queued · ' +
      signed.format(b.completed - a.completed) + ' completed · ' +
      signed.format(b.sample.productionPaid - a.sample.productionPaid) + ' paid · ' +
      signed.format(b.sample.cash + b.sample.ore - a.sample.cash - a.sample.ore) + ' available';
  }

  function pairedJobs(time) {
    const slots = new Map();
    runs.forEach((run, index) => {
      const ordinals = new Map();
      for (const job of run.economy?.jobs ?? []) {
        const queued = timeOf(run, job.queuedAt);
        if (queued > time + 1e-7) continue;
        const ordinal = (ordinals.get(job.queue) ?? 0) + 1;
        ordinals.set(job.queue, ordinal);
        const key = JSON.stringify([job.queue, ordinal]);
        if (!slots.has(key)) slots.set(key, { queue: job.queue, ordinal, jobs: [null, null], time: queued });
        const slot = slots.get(key);
        slot.jobs[index] = job;
        slot.time = Math.min(slot.time, queued);
      }
    });
    return [...slots.values()].sort((a, b) => a.time - b.time || a.queue.localeCompare(b.queue) || a.ordinal - b.ordinal);
  }

  function lowPowerSpans(run, time) {
    const cutoff = Math.min(tickAt(run, time), cutoffOf(run));
    const spans = [];
    let start;
    for (const sample of run.economy?.samples ?? []) {
      if (sample.tick > cutoff) break;
      if (sample.powerProvided < sample.powerDrained) {
        start ??= sample.tick;
      } else if (start !== undefined) {
        spans.push([start, sample.tick]);
        start = undefined;
      }
    }
    if (start !== undefined) spans.push([start, cutoff]);
    return spans;
  }

  function drawJobTrack(cell, run, job, cutoff, time, lowPower) {
    if (time <= 0) return;
    const track = text(cell, 'div', '', 'job-track');
    track.setAttribute('aria-hidden', 'true');
    const end = Math.min(job.completedAt ?? job.cancelledAt ?? cutoff, cutoff);
    const started = Math.min(job.startedAt ?? end, end);
    const ready = Math.min(job.readyAt ?? end, end);
    const percent = tick => Math.min(100, timeOf(run, tick) / time * 100);
    const segment = (from, to, kind) => {
      if (to <= from) return;
      const bar = text(track, 'span', '', kind);
      bar.style.left = percent(from) + '%';
      bar.style.width = (percent(to) - percent(from)) + '%';
    };
    segment(job.queuedAt, started, 'job-queued');
    segment(started, ready, 'job-working');
    segment(ready, end, 'job-ready');
    for (const wait of job.fundingWaits) {
      if (wait.startTick >= cutoff) break;
      segment(wait.startTick, Math.min(wait.endTick ?? end, end), 'job-funds');
    }
    for (const [from, to] of lowPower) segment(from, to, 'job-low-power');
    const terminal = job.completedAt ?? job.cancelledAt;
    if (terminal !== undefined && terminal <= cutoff) {
      const point = text(track, 'span', '', job.cancelledAt === undefined ? 'job-complete' : 'job-cancelled');
      point.style.left = percent(terminal) + '%';
    }
  }

  function describeJob(cell, run, job, time, financialCutoff, powerSpans) {
    if (!job) {
      text(cell, 'span', run.economy ? '—' : 'No production trace');
      return;
    }
    const cutoff = Math.min(tickAt(run, time), cutoffOf(run));
    const stage = (label, tick) => tick !== undefined && tick <= cutoff
      ? label + ' ' + timeLabel(timeOf(run, tick)) : null;
    const stages = [
      stage('Queued', job.queuedAt), stage('Work started', job.startedAt), stage(job.isBuilding ? 'Ready to place' : 'Ready', job.readyAt),
      stage(job.isBuilding ? 'Placed' : 'Completed', job.completedAt), stage('Cancelled', job.cancelledAt),
    ].filter(Boolean);
    text(cell, 'strong', job.name);
    text(cell, 'small', job.item + ' · cost ' + number.format(job.cost));
    text(cell, 'small', stages.join(' · '));
    const workEnd = Math.min(cutoff, job.readyAt ?? job.completedAt ?? job.cancelledAt ?? cutoff);
    const lowPower = [];
    if (job.startedAt !== undefined) {
      for (const [from, to] of powerSpans) {
        const start = Math.max(from, job.startedAt);
        const end = Math.min(to, workEnd);
        if (end > start) lowPower.push([start, end]);
      }
    }
    drawJobTrack(cell, run, job, cutoff, time, lowPower);

    let cash = 0;
    let ore = 0;
    for (const payment of job.payments) {
      if (payment.tick > financialCutoff) break;
      cash += payment.cash;
      ore += payment.ore;
    }
    text(cell, 'small', 'Paid ' + amount(cash, ore));
    if (job.cancelledAt !== undefined && job.cancelledAt <= financialCutoff) {
      const reason = job.cancellationReason?.replaceAll('_', ' ') ?? 'cancelled';
      text(cell, 'small', 'Refunded ' + amount(job.cashRefunded, job.oreRefunded) + ' · ' + reason);
    }
    const waits = job.fundingWaits.filter(wait => wait.startTick <= cutoff);
    if (waits.length) {
      const duration = waits.reduce((sum, wait) => sum + Math.max(0, Math.min(cutoff, wait.endTick ?? cutoff) - wait.startTick), 0);
      const firstWait = waits[0];
      text(cell, 'small', 'Funding wait began at ' + timeLabel(timeOf(run, firstWait.startTick)) +
        ' · ' + timeLabel(timeOf(run, duration)) + ' total · needed ' + number.format(firstWait.required) +
        ', had ' + number.format(firstWait.available), 'funding-note');
    }
    if (lowPower.length) text(cell, 'small', 'Low power during work (sampled)', 'power-note');
    const lastPause = job.pauses.findLast(pause => pause.tick <= cutoff);
    if (lastPause?.paused && !stage('Cancelled', job.cancelledAt) && !stage('Completed', job.completedAt))
      text(cell, 'small', 'Paused at ' + timeLabel(timeOf(run, lastPause.tick)));
  }

  function renderJobs(time) {
    const result = byId('production-comparison');
    result.replaceChildren();
    const queue = queueFilter.value;
    const pairs = pairedJobs(time).filter(slot => !queue || slot.queue === queue);
    const comparable = !mixed && runs.every(run => run.economy);
    const differs = slot => slot.jobs[0]?.item !== slot.jobs[1]?.item;
    const firstChoice = comparable && pairs.find(slot => slot.jobs.every(Boolean) && differs(slot));
    const firstTiming = comparable && pairs.find(slot => slot.jobs.every(Boolean) &&
      Math.abs(timeOf(runs[0], slot.jobs[0].queuedAt) - timeOf(runs[1], slot.jobs[1].queuedAt)) > 0.001);
    const summary = byId('queue-difference');
    summary.textContent = '';
    if (firstChoice) {
      const [a, b] = firstChoice.jobs;
      summary.textContent = firstChoice.queue + ' #' + firstChoice.ordinal + ' is the first different paired choice. ' +
        'A queued ' + a.name + ' at ' + timeLabel(timeOf(runs[0], a.queuedAt)) + ' and B queued ' +
        b.name + ' at ' + timeLabel(timeOf(runs[1], b.queuedAt)) + '.';
    } else if (firstTiming) {
      const [a, b] = firstTiming.jobs;
      summary.textContent = firstTiming.queue + ' #' + firstTiming.ordinal + ' is the first queued timing gap. ' +
        'A queued at ' + timeLabel(timeOf(runs[0], a.queuedAt)) + ' and B queued at ' + timeLabel(timeOf(runs[1], b.queuedAt)) + '.';
    }

    const timing = byId('queue-timing');
    timing.textContent = '';
    if (firstChoice && firstTiming && firstChoice !== firstTiming) {
      const [a, b] = firstTiming.jobs;
      timing.textContent = 'First queued timing gap · ' + firstTiming.queue + ' #' + firstTiming.ordinal +
        ' · A ' + timeLabel(timeOf(runs[0], a.queuedAt)) + ' · B ' + timeLabel(timeOf(runs[1], b.queuedAt));
    }

    const gap = firstChoice || firstTiming;
    jump.hidden = !gap;
    if (gap) {
      const gapTime = Math.max(...gap.jobs.map((job, index) => timeOf(runs[index], job.queuedAt)));
      jump.dataset.time = roundUpToCursor(gapTime);
    }

    const visible = comparable && different.checked ? pairs.filter(differs) : pairs;
    byId('job-legend').hidden = !visible.length;
    if (!visible.length) {
      text(result, 'p', pairs.length ? 'The visible queue choices match.' : 'No jobs queued by this time.');
      return;
    }

    const table = text(result, 'table', '');
    const head = table.createTHead().insertRow();
    text(head, 'th', 'Queue position').scope = 'col';
    for (const label of labels) text(head, 'th', label).scope = 'col';
    const body = table.createTBody();
    const financialCutoffs = runs.map(run => sampleAt(run, time)?.tick ?? -1);
    const powerSpans = runs.map(run => lowPowerSpans(run, time));
    for (const slot of visible) {
      const row = body.insertRow();
      if (comparable && differs(slot)) row.className = 'queue-changed';
      text(row, 'th', slot.queue + ' #' + slot.ordinal).scope = 'row';
      runs.forEach((run, index) => describeJob(text(row, 'td', ''), run, slot.jobs[index], time,
        financialCutoffs[index], powerSpans[index]));
    }
  }

  function redraw() {
    const time = Number(cursor.value);
    position.value = time.toFixed(2);
    cursor.setAttribute('aria-valuetext', timeLabel(time));
    squadViewer.render(time);
    combatViewer.renderMatch(time);
    if (!byId('economy-content').hidden) {
      renderBalances(time);
      renderJobs(time);
      draw(byId('funds-chart'), sample => sample.cash + sample.ore);
      draw(byId('spend-chart'), sample => sample.productionPaid);
    }
  }

  function show(nextRuns, mixingExamples) {
    runs = [...nextRuns];
    mixed = mixingExamples;
    const hasTrace = runs.some(run => run.economy);
    byId('economy-empty').hidden = hasTrace;
    byId('economy-content').hidden = !hasTrace;
    squadViewer.show(runs);
    combatViewer.show(runs, mixingExamples);
    const timelineRuns = runs.filter(run => run.economy || run.squadTimeline || run.combatTimeline);
    byId('timeline-cursor').hidden = !timelineRuns.length;
    if (!timelineRuns.length) return;
    extent = Math.max(0.01, ...timelineRuns.map(run => timeOf(run, cutoffOf(run))));
    cursor.max = roundUpToCursor(extent);
    position.max = cursor.max;
    cursor.value = cursor.max;
    const oldQueue = queueFilter.value;
    queueFilter.replaceChildren();
    text(queueFilter, 'option', 'All queues').value = '';
    const queues = new Set(runs.flatMap(run => run.economy?.jobs.map(job => job.queue) ?? []));
    for (const queue of [...queues].sort()) text(queueFilter, 'option', queue).value = queue;
    queueFilter.value = queues.has(oldQueue) ? oldQueue : '';
    different.disabled = mixed || runs.some(run => !run.economy);
    attackButtons.forEach((button, index) => {
      const run = runs[index];
      const tick = run.events.reduce((first, event) => event.type === 'attack_order'
        ? Math.min(first, event.tick) : first, Infinity);
      button.hidden = mixed || !(run.economy || run.squadTimeline || run.combatTimeline) || !Number.isFinite(tick) || tick > cutoffOf(run);
      if (!button.hidden) button.dataset.time = roundUpToCursor(timeOf(run, tick));
    });
    byId('economy-attacks').hidden = attackButtons.every(button => button.hidden);
    redraw();
  }

  function selectTime(time) {
    const value = Number.isFinite(time) ? time : Number(cursor.value);
    cursor.value = (Math.max(0, Math.min(Number(cursor.max), value))).toFixed(2);
    redraw();
  }

  jump.addEventListener('click', () => {
    selectTime(Number(jump.dataset.time));
    cursor.focus();
  });
  for (const button of attackButtons) {
    button.addEventListener('click', () => {
      selectTime(Number(button.dataset.time));
      cursor.focus();
    });
  }
  position.addEventListener('change', () => selectTime(position.valueAsNumber));
  for (const id of ['funds-chart', 'spend-chart']) {
    byId(id).addEventListener('click', event => {
      const span = event.currentTarget.getBoundingClientRect().width - 55 - 14;
      if (span > 0) selectTime((event.offsetX - 55) * extent / span);
    });
  }
  cursor.addEventListener('input', redraw);
  queueFilter.addEventListener('change', () => renderJobs(Number(cursor.value)));
  different.addEventListener('change', () => renderJobs(Number(cursor.value)));
  window.addEventListener('resize', () => {
    if (!byId('economy-content').hidden && extent) {
      draw(byId('funds-chart'), sample => sample.cash + sample.ore);
      draw(byId('spend-chart'), sample => sample.productionPaid);
    }
  });

  return { example, show, validate, selectTime, seekEvent: time => selectTime(roundUpToCursor(time)) };
})();
