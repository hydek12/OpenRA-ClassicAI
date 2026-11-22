# The Bot Observatory

Compare production, squad formation, first attack decisions, and combat
outcomes in two OpenRA runs. Open
[`index.html`](index.html) in a browser. The viewer starts with two simulated
runs, reads imported JSON locally, and shows both runs on one elapsed-time scale.

## Record a cadence pair

The [OpenRA exporter patch](openra-exporter.patch) targets
`hydek12/OpenRA-ClassicAI` at commit `02ab064f89aa65ab7e3d38abf201586136d64082`.
Apply it from that checkout and build with the .NET 10 SDK. On Apple Silicon,
use the `osx-arm64` native target.

```sh
git apply --check /path/to/bot-observatory/openra-exporter.patch
git apply /path/to/bot-observatory/openra-exporter.patch

dotnet build OpenRA.Launcher/OpenRA.Launcher.csproj -p:TargetPlatform=osx-arm64
dotnet build OpenRA.Platforms.Default/OpenRA.Platforms.Default.csproj -p:TargetPlatform=osx-arm64
dotnet build OpenRA.Mods.Cnc/OpenRA.Mods.Cnc.csproj -p:TargetPlatform=osx-arm64
```

Run the pair from a desktop session with OpenRA's Red Alert content installed.
This command uses the included [Blitz skirmish profile](blitz.settings.yaml)
and stores each match's settings and logs in a fresh directory.

```sh
python3 /path/to/bot-observatory/run-pair.py /path/to/OpenRA-ClassicAI \
  --content "$HOME/Library/Application Support/OpenRA/Content" \
  --output ./observatory-runs --seed 42 --intervals 2 4
```

The profile runs a Rush bot at spawn 1 against a Normal bot at spawn 2. Both use
the Classic Normal difficulty preset. Each run ends when the match ends,
all four milestones occur, or the wall-clock timeout expires. You can also
set a simulation cutoff with `--max-ticks`. Import the two `match-*.json`
files in the viewer. Missing events appear as dashes. The comparison reports
`B − A`. A positive value means the event happened later in B.

The exporter can also be enabled in a manually configured local `ra-classic`
skirmish. Set `OPENRA_OBSERVATORY_DIR` to a writable directory before launching
OpenRA. Set `OPENRA_OBSERVATORY_SPAWN` to an explicit spawn number to record
only that bot. `OPENRA_OBSERVATORY_INTERVAL` overrides the cadence only when a
spawn is selected. `OPENRA_OBSERVATORY_SEED` fixes the lobby seed and derives
the local random seed. Both seeds are recorded. On Blitz, the two bots
share this local stream with each other and some presentation effects.
Compare Blitz runs with the same game speed, renderer, lobby settings, and
opponent. A reactive opponent can behave differently after the first
divergence.

## Run the fixed-opponent benchmark

Add `--benchmark` to run the original Observatory Range map. The launcher
generates the map in each isolated support directory using installed Red
Alert terrain. The fixed opponent issues four waves at ticks 750, 2000,
3500, and 5200. Each wave has a preset composition, spawn positions, and
destination. The modified Classic Normal squad threshold is six for both
cadences. The map leaves the simulation running after either side is
eliminated so both runs can reach the same observation limit.

```sh
python3 /path/to/bot-observatory/run-pair.py /path/to/OpenRA-ClassicAI \
  --content "$HOME/Library/Application Support/OpenRA/Content" \
  --output ./observatory-runs --benchmark --seed 42 --intervals 2 4
```

The default benchmark limit is 12,000 simulation ticks. The run pair passes
only when both logs confirm that exact cutoff. Use `--max-ticks` to change
the observation window and `--timeout` to give a slower machine more
wall-clock time. The benchmark checks the map checksum and fixed opponent
before comparing the timelines. It also checks the dispatched wave ticks
against [the schedule](benchmark/waves.json). The benchmark seeds a
dedicated bot random stream and records it as `setup.botRandomSeed`.
Combat outcomes can still depend on both sides' actions and game rules.

## Compare squads and attacks

Import both match logs and use **Inspect at** for the same point in both
runs. The squad overview marks formation and each squad’s first attack
on the shared time scale. Select a mark to inspect that moment.
**Active rosters** lists the units assigned
at the cursor. The event table also lists joins, departures, and
disbanding. Unit IDs identify actors within each run.

**Run A first attack** and **Run B first attack** move the cursor to
the corresponding match milestone. The squad cards name the squad, its
formation time and reason, the decision that queued its first attack,
the target, and the participants when the order was issued. The event
table shows queue and issue separately when they fell on different
ticks. Use **Squad type** or **First attack squads only** to focus the
history. **Show decision checks** displays the scheduled Assault and
Rush evaluations, including the available units and required count.

A squad forms when its first member joins. The raw trace also records
registry entries that never gained members. A departure uses the tick
when the squad manager removes the actor from the roster. Squads
already present when recording starts display their first observed
roster. The attack trace covers
the AI’s marked, enemy-targeted squad attack orders. The game’s
automatic attacks and ordinary defense orders have their own paths.
The viewer still opens older milestone and production logs.

## How seed 42 reached its first attack

Load the [2-tick run](squad-runs/seed42-interval2.json) as A and the
[4-tick run](squad-runs/seed42-interval4.json) as B. At 109.60 s,
expand B’s **Active rosters** to see its Protection squad. Select
**Run B first attack** to see the Rush decision and the unit it sent.

Both runs formed Protection squads first, at 24.40 s in A and
30.24 s in B. The first squads to issue a recorded attack followed
different formation paths.

| | Run A, 2 ticks | Run B, 4 ticks |
|---|---|---|
| First attacking squad | Assault #3 at 38.80 s | Rush #7 at 125.12 s |
| Formation check | 6 eligible, threshold 6 | 14 ground units, threshold 6, 1 unassigned |
| Members | 4 Rifle Infantry, 2 Rocket Soldiers | 1 Rifle Infantry |
| First order | 39.76 s toward a Mobile Construction Vehicle | 127.52 s toward a Construction Yard |

B’s Protection #6 took 13 units at 109.44 s in response to a Heavy
Tank. At 109.60 s, B’s Assault check found zero unassigned units. Its
later Rush check counted the 13 units already in Protection and the one
unassigned Rifle Infantry that joined the Rush. Each first attack order
followed a ground engagement check that approved the attack after
assessing four nearby enemies.

A diagnostic replay separated B’s two checks. The Rush formation
scan found zero eligible defenders near the target base at 125.12 s.
The engagement scan at 127.52 s assessed four enemy actors. Both first
engagement checks scored 15 on the engine’s attack-or-flee scale.
The attack branch accepts scores below 30.

Removing only the [70 s wave](squad-runs/seed42-interval4-omit-wave-3500.json)
left 11 units available at B’s 77.60 s Assault check. That squad
issued its first attack at 79.52 s. Removing only the
[104 s wave](squad-runs/seed42-interval4-omit-wave-5200.json)
left 13 units eligible for Assault at 109.60 s and led to a first
attack at 115.52 s. These controls each reached the same 240 s cutoff.

In the [2-tick](squad-runs/seed42-no-waves-interval2.json)
and [4-tick](squad-runs/seed42-no-waves-interval4.json) runs with all
waves removed, both bots formed Assault as their first squad. Their
first attack orders came at 39.76 s and 79.52 s.

With the squad threshold raised from six to twelve, the
[2-tick run](squad-runs/seed42-threshold12-interval2.json)
formed its attack squad at 86.80 s and issued the first order at
87.76 s. The [4-tick run](squad-runs/seed42-threshold12-interval4.json)
still met its Rush threshold with 14 ground units at 125.12 s.
Its first order again went to one Rifle Infantry at 127.52 s.

## Squad benchmark runs

Every fixed-opponent pair ran to 240 s. The first formation column
includes Protection squads. An em dash marks an event unobserved at
the cutoff.

| Seed | First formed, A | First formed, B | First attack, A | First attack, B | Import logs |
|---:|---|---|---|---|---|
| 42 | Protection 24.40 s | Protection 30.24 s | Assault 39.76 s | Rush 127.52 s | [2 ticks](squad-runs/seed42-interval2.json) · [4 ticks](squad-runs/seed42-interval4.json) |
| 43 | Protection 40.96 s | Protection 48.16 s | Assault 59.28 s | Assault 148.56 s | [2 ticks](squad-runs/seed43-interval2.json) · [4 ticks](squad-runs/seed43-interval4.json) |
| 44 | Protection 24.16 s | Protection 28.96 s | Assault 66.04 s | Assault 72.08 s | [2 ticks](squad-runs/seed44-interval2.json) · [4 ticks](squad-runs/seed44-interval4.json) |
| 45 | Protection 23.80 s | — | Assault 74.56 s | — | [2 ticks](squad-runs/seed45-interval2.json) · [4 ticks](squad-runs/seed45-interval4.json) |
| 46 | Protection 75.76 s | Protection 196.88 s | Assault 142.60 s | — | [2 ticks](squad-runs/seed46-interval2.json) · [4 ticks](squad-runs/seed46-interval4.json) |
| 47 | Protection 24.16 s | Protection 56.64 s | Assault 42.80 s | Assault 151.60 s | [2 ticks](squad-runs/seed47-interval2.json) · [4 ticks](squad-runs/seed47-interval4.json) |

Protection was the earliest formation in every fixed-opponent run
that formed a squad. At the cutoff, B on seed 45 had formed zero
squads. B on seed 46 had formed one Protection squad and recorded
zero attack orders.

In a longer seed 46 run, B formed a second Protection squad at
255.76 s. Its 34 Assault checks found at most two eligible units
against the six-unit threshold. Both extended runs reached the
wall-clock limit. B’s last confirmed checkpoint was 1,093.84 s
with zero recorded attack orders. Compare the
[extended 2-tick run](squad-runs/seed46-extended-interval2.json)
and [extended 4-tick run](squad-runs/seed46-extended-interval4.json).

In the reactive Blitz pair, the
[2-tick run](squad-runs/blitz-seed42-interval2.json)
queued its 34-unit Rush’s first order at 240.80 s and issued it at
240.82 s. Inspect 240.80 s to see the queued decision, then 240.82 s
to see the issued order. The
[4-tick run](squad-runs/blitz-seed42-interval4.json)
issued a 29-unit Assault at 169.60 s.

A fresh build reproduced all 12 fixed-opponent squad logs byte for
byte. The original milestone and production fields matched the earlier
benchmark exports. Separate fixtures exercised Air and Naval
assignments, releases, and departures after actor loss. Seed 42 also ran
to 960 simulation seconds at both cadences and preserved the same squad
history through 240 seconds. The viewer opened both extended logs and
matched their event histories at 41 cursor positions.

## Compare combat and losses

In **Combat and losses**, **Since first attack order** gives each run
its own zero point. Drag the cursor to compare the same elapsed time
after each bot’s opening order. Each event also shows its match time.
Choose **Match clock** to use the shared **Inspect at** cursor and see
earlier combat, including runs with no recorded attack order.

**Opening attack units only** follows the actors named in the first
order, including after they leave or change squads. The loss counts
use confirmed deaths of owned mobile units and tracked squad members.
A destroyed vehicle contributes one casualty at the unit's death tick.
Each row gives the unit’s name, ID, current squad if assigned, and the
damage source when available. Squad release and reassignment are roster
changes. **Contact** marks the first observed positive damage dealt or
received against an enemy in its phase. The opening contact uses the
actors in the first attack order.

**Retreat decided** marks an AI state transition and gives its reason.
**Retreat order issued** records an actual command to a live, orderable
unit, linked to that decision by its retreat ID. Use the **Combat event**
filter to see only contacts, losses, or retreats. **Previous event** and
**Next event** jump between the times that match the current filters.

For fresh runs, use the fixed benchmark or set `--max-ticks` on the
Blitz runner to keep logging after contact. Use
`--max-ticks 18000 --timeout 600` for a 360-second simulation window
with a ten-minute wall-clock limit per match.
The runner prints the elapsed coverage for each bot, since the same
match cutoff can leave different amounts of time after its first order.

### Seed 42 after the first attack

Open [the 2-tick run](combat-runs/seed42-interval2.json) as Run A and
[the 4-tick run](combat-runs/seed42-interval4.json) as Run B. Select
**Since first attack order** and **Opening attack units only**. The
plus signs below indicate time since each run's first attack order.
Both logs end at 240.00 s on the match clock.

| Event | Run A · 2 ticks | Run B · 4 ticks |
|---|---|---|
| First attack order | 39.76 s match time · Assault #3 · 6 units | 127.52 s match time · Rush #7 · 1 unit |
| First contact | +4.82 s · Rifle Infantry received damage from enemy Rifle Infantry | +11.46 s · Rifle Infantry damaged a Mobile Construction Vehicle |
| Opening units lost by +30 s | 3 Rifle Infantry at +5.62, +7.22, and +8.72 s | 0 |
| Opening squad decided to retreat | +60.04 s · No reachable target | +48.16 s · No reachable target |
| First command issued for that retreat | +63.06 s · Move | +54.24 s · Move |
| Opening units lost by the cutoff | 6 of 6 | 0 of 1 |

A lost its three remaining opening units at +64.64, +66.64, and +69.04 s,
after the retreat orders were issued. Those units had already left
Assault #3 in the bot's roster, and the combat timeline still follows
their actor IDs. B's earlier retreat relative to its own opening happened
later on the match clock, at 175.68 s compared with A's 99.80 s.

### Matched combat runs

All six pairs used Observatory Range and ended at tick 12,000
(240.00 s). Four pairs had an opening order for both runs. In those
pairs, the 4-tick bot reached contact sooner after ordering the attack
on seeds 43 and 44, and took longer on seeds 42 and 47.
The loss columns count opening attack units through +30 s. A dash
indicates the first attack order was unobserved.

| Seed | Contact after the opening order · 2 ticks | Contact after the opening order · 4 ticks | Opening losses · 2 ticks | Opening losses · 4 ticks | Logs |
|---:|---:|---:|---:|---:|---|
| 42 | +4.82 s | +11.46 s | 3 | 0 | [2 ticks](combat-runs/seed42-interval2.json) · [4 ticks](combat-runs/seed42-interval4.json) |
| 43 | +10.76 s | +3.66 s | 5 | 0 | [2 ticks](combat-runs/seed43-interval2.json) · [4 ticks](combat-runs/seed43-interval4.json) |
| 44 | +7.18 s | +3.36 s | 0 | 1 | [2 ticks](combat-runs/seed44-interval2.json) · [4 ticks](combat-runs/seed44-interval4.json) |
| 45 | +1.24 s | — | 1 | — | [2 ticks](combat-runs/seed45-interval2.json) · [4 ticks](combat-runs/seed45-interval4.json) |
| 46 | +11.22 s | — | 0 | — | [2 ticks](combat-runs/seed46-interval2.json) · [4 ticks](combat-runs/seed46-interval4.json) |
| 47 | +2.92 s | +9.74 s | 1 | 0 | [2 ticks](combat-runs/seed47-interval2.json) · [4 ticks](combat-runs/seed47-interval4.json) |

The 600 s follow-ups on seeds 45 and 46 still showed no opening attack
order for the 4-tick bots. Their recorded Assault and Rush checks stayed
below the squad threshold. Seed 45 lost one Ore Truck at 84.48 s.
Seed 46 recorded two defensive contacts and eight unit losses. Use
**Match clock** to inspect those events.
[Seed 45, 2 ticks](combat-runs/seed45-interval2-600s.json) ·
[Seed 45, 4 ticks](combat-runs/seed45-interval4-600s.json) ·
[Seed 46, 2 ticks](combat-runs/seed46-interval2-600s.json) ·
[Seed 46, 4 ticks](combat-runs/seed46-interval4-600s.json)

The clean-build repeat reproduced all 12 logs byte for byte. Removing
the combat trace from each log yielded the same parsed data as its
existing squad log, including the milestones and production ledger.
Seed 42 cutoffs one tick before and on the opening squad's first order,
contact, loss, retreat decision, and retreat command reproduced the
corresponding prefixes of the full log.

### Seed 42 wave controls

Each control removes one scheduled wave and keeps the rest of that
run's settings. On the 2-tick run, omitting the 40 s wave preserved the
opening order at 39.76 s. The opening squad then lost its first units
at +65.48 and +66.68 s, for two confirmed deaths by the cutoff. Omitting
the 15 s wave also preserved the attack time and led to four opening
losses within +30 s.

| Control | Contact after its first order | Opening losses by +30 s | First retreat decision involving opening units |
|---|---:|---:|---:|
| [2 ticks · omit the 15 s wave](combat-runs/seed42-interval2-omit-wave-750.json) | +4.06 s | 4 of 6 | — |
| [2 ticks · omit the 40 s wave](combat-runs/seed42-interval2-omit-wave-2000.json) | +11.16 s | 0 of 6 | +75.08 s |
| [4 ticks · omit the 70 s wave](combat-runs/seed42-interval4-omit-wave-3500.json) | +9.90 s | 0 of 11 | +48.00 s |
| [4 ticks · omit the 104 s wave](combat-runs/seed42-interval4-omit-wave-5200.json) | +9.24 s | 0 of 13 | +48.16 s |

With all four waves removed, both bots made contact and recorded zero
unit deaths through 240 s. [2-tick no-wave run](combat-runs/seed42-no-waves-interval2.json) ·
[4-tick no-wave run](combat-runs/seed42-no-waves-interval4.json)

### Combat against a reactive opponent

On Blitz seed 42, the 2-tick bot's 34-unit Rush first damaged an Ore
Truck at +11.22 s. The 4-tick bot's 29-unit Assault first took damage
from a Flame Tower at +5.82 s. They lost 20 and 15 opening units
respectively in the first 30 seconds, and both lost their entire opening
groups by the 360 s match cutoff. [2-tick Blitz run](combat-runs/blitz-seed42-interval2.json) ·
[4-tick Blitz run](combat-runs/blitz-seed42-interval4.json)

On Blitz seed 45, the 2-tick bot's opening squad decided to retreat
at +30.00 s with three units left. Its Rocket Soldier, Rifle Infantry,
and Light Tank died at +30.08, +31.28, and +32.48 s. The log records
zero issued commands for that retreat. In the same elapsed 30-second
window, the 4-tick bot's opening squad took zero losses after first
damaging a SAM Site at +26.54 s. [2-tick Blitz run](combat-runs/blitz-seed45-interval2.json) ·
[4-tick Blitz run](combat-runs/blitz-seed45-interval4.json)

## Compare resources and production

Import both match logs, then use **Inspect at** or click either chart to
set the same time in both runs. Use **Run A first attack** or **Run B
first attack** to compare both runs at that milestone. The balances show
cash and ore value, gross production payments, refunds, credited income,
power, and enabled queue categories. Under the balances, **B − A** shows
the difference in accepted orders, completions, gross paid, and available
funds. The queue table pairs the first accepted order in each category
with the first on the other side, then the second with the
second, and so on. Filter by queue or choose **Show different choices**
to focus on the rows where the two sides chose different items or only
one side has an entry at the selected time. Each row's stage bars share
the selected time as their right edge. The command-line runner also
prints the queue and payment totals at each observation endpoint.

Each entry shows its quoted cost, actual payments from cash and ore, and
the ticks for queue acceptance, first processing, readiness, placement
or completion, and cancellation when observed. For buildings,
**Ready to place** marks construction finishing and **Placed** marks the
building entering the map. The stage bars mark funding waits and low
power during production. Low power follows the latest recorded power
checkpoint. The table shows credited refunds. The balance cards show
the difference between overall net spending and net production spending
as **other net spending**.

The exporter records accepted standard and Classic production queue
entries for the observed bot. Lifecycle transitions use exact simulation
ticks. Balance samples and item payments share checkpoints, usually
every 25 ticks and at the end of the observation. The cursor shows the
latest financial checkpoint on or before the selected time. Logs
without an economy trace still show the match milestones.

## Where the benchmark runs diverged

Load [interval 2 as Run A](production-runs/seed42-interval2.json) and
[interval 4 as Run B](production-runs/seed42-interval4.json). Both runs
started with 5,000 credits on Observatory Range and faced the same
scheduled waves. The first accepted order was a Power Plant in both
runs. A queued it at 5.16 s and placed it at 10.04 s. B queued it
at 10.14 s and placed it at 15.14 s. Both orders entered their queues
before the first scheduled wave at 15.00 s.

The cadence setting controls how often bot modules evaluate decisions,
including the base builder and squad manager. The Power Plant took
3.60 s from queue acceptance to readiness in each run. The time to
queue it and the time from readiness to placement both varied. A
separate diagnostic replay logged the base builder's Power Plant
decisions at 5.08 s and 10.08 s. The engine accepted each order within
0.08 s of the decision.

The first item choice that differed was in the Infantry queue. A queued a
Rocket Soldier at 19.26 s and completed it at 22.88 s. B queued a
Rifle Infantry at 26.46 s and completed it at 27.68 s. A placed its
first Ore Refinery at 37.10 s, while it was still under construction in
B. Enter **39.76 s**, when A issued its first attack order, to compare the
state of both runs at that point.

| At 39.76 s | Run A, interval 2 | Run B, interval 4 |
|---|---:|---:|
| Accepted orders | 11 | 8 |
| Completed orders | 10 | 6 |
| Infantry completed | 7 | 4 |
| Gross production payments | 3,422 | 2,610 |
| Available funds | 1,553 | 2,355 |
| Latest balance checkpoint | 39.76 s | 39.68 s |

B still had more funds available at A's first attack. The timeline
shows a delay in accepting the first order, a different first Infantry
choice, and a widening gap in completed production before B issued its
first attack order at 127.52 s. A diagnostic replay showed that A had
six eligible units at its 38.80 s squad check and sent a six-unit
Assault squad. B had zero units available for a new Assault squad at
its 45.60, 77.60, and 109.60 s checks. Its first attack order came
from a one-unit Rush squad.

With the waves removed, the first attacks came at 39.76 s and 79.52 s.
The timing gap persisted, and the scheduled waves widened it in this
seed. Compare [interval 2 without waves](production-runs/seed42-no-waves-interval2.json)
and [interval 4 without waves](production-runs/seed42-no-waves-interval4.json).

Seed 45 shows a different pattern. A's second building order was an
Allied Barracks. B chose an Ore Refinery, then queued a War Factory at
39.42 s. The War Factory was cancelled at 73.10 s when the building
queue cleared. The game credited all 1,514 paid back to the bot
(422 cash and 1,092 ore). B had no recorded unit production queue or
attack order by the 240 s cutoff. Load
[seed 45 interval 2](production-runs/seed45-interval2.json) and
[seed 45 interval 4](production-runs/seed45-interval4.json) and inspect
73.52 s to see the cancellation, refund, and disabled queues together.

A diagnostic replay confirmed that both second building choices came
from the base builder's shuffled list of eligible structures. In a
separate run with all four waves removed, B queued the same first three
buildings at the same times, placed its War Factory at 63.80 s, and
issued an attack at 119.12 s.
Compare [interval 2 without waves](production-runs/seed45-no-waves-interval2.json)
and [interval 4 without waves](production-runs/seed45-no-waves-interval4.json)
as a separate pair.

Removing only the [40 s wave](production-runs/seed45-interval4-omit-wave-2000.json)
kept B at 74 power supplied against 30 used at the 50.52 s checkpoint.
The original run supplied 25 against 30 then. B finished the factory at
63.80 s and attacked at 215.12 s with that wave removed. Removing only
the [70 s wave](production-runs/seed45-interval4-omit-wave-3500.json)
reproduced the 73.10 s cancellation.

Seed 46 shows slower production after orders were accepted. Both bots
completed a War Factory. B began work on its first Ranger at 64.88 s,
3.68 s earlier than A, whose Vehicle queue had an Ore Truck ahead of
the Ranger. The Ranger took 6.00 s from start to completion in A and
17.96 s in B. At B's start the latest checkpoint showed 7 power supplied
against 60 used and 3,181 credits available.
The game's low-power production slowdown was active, and the Ranger
recorded no funding waits. Compare
[seed 46 interval 2](production-runs/seed46-interval2.json) with
[seed 46 interval 4](production-runs/seed46-interval4.json) at 82.84 s.
In the [interval 2 control](production-runs/seed46-no-waves-interval2.json)
and [interval 4 control](production-runs/seed46-no-waves-interval4.json)
without waves, both first Rangers took 6.00 s from work start to completion.

With 2,500 starting credits on seed 42, both Ore Refineries stalled
for funds. Inspect **45.00 s** to see their zero balances alongside
their funding waits. A's first wait ran from 34.02 to 52.78 s.
B's ran from 40.34 to 78.24 s. These controls ran for 480 s.
Load the [2-tick low-cash run](production-runs/seed42-low-cash-interval2.json)
and the [4-tick low-cash run](production-runs/seed42-low-cash-interval4.json).

## Production benchmark logs

All six matched pairs ran in the headless harness to tick 12,000
(240 s), with the same four scripted waves. Both bots opened with a
Power Plant in every pair. The 2-tick bot accepted that order between
4.98 and 5.34 seconds earlier, and the time from queue acceptance to
readiness was 3.60 s in all 12 runs. The 2-tick bot completed more
orders in each of these pairs. Four pairs recorded both first attack
orders, all earlier at interval 2. An em dash marks an attack order
that was still unobserved at the cutoff.

| Seed | Queued, 2 / 4 | Completed, 2 / 4 | Gross paid, 2 / 4 | First attack in seconds, 2 / 4 | Import logs |
|---:|---:|---:|---:|---:|---|
| 42 | 62 / 54 | 59 / 52 | 27,040 / 21,918 | 39.76 / 127.52 | [2 ticks](production-runs/seed42-interval2.json) · [4 ticks](production-runs/seed42-interval4.json) |
| 43 | 73 / 57 | 71 / 56 | 32,177 / 26,539 | 59.28 / 148.56 | [2 ticks](production-runs/seed43-interval2.json) · [4 ticks](production-runs/seed43-interval4.json) |
| 44 | 77 / 68 | 73 / 65 | 31,746 / 26,877 | 66.04 / 72.08 | [2 ticks](production-runs/seed44-interval2.json) · [4 ticks](production-runs/seed44-interval4.json) |
| 45 | 66 / 3 | 64 / 2 | 28,658 / 3,214 | 74.56 / — | [2 ticks](production-runs/seed45-interval2.json) · [4 ticks](production-runs/seed45-interval4.json) |
| 46 | 24 / 11 | 22 / 9 | 18,496 / 8,601 | 142.60 / — | [2 ticks](production-runs/seed46-interval2.json) · [4 ticks](production-runs/seed46-interval4.json) |
| 47 | 73 / 58 | 68 / 55 | 31,434 / 25,295 | 42.80 / 151.60 | [2 ticks](production-runs/seed47-interval2.json) · [4 ticks](production-runs/seed47-interval4.json) |

A clean checkout reproduced all 12 logs byte for byte. The per-order
cash and ore debits and refunds reconcile with every production
checkpoint. Safari opened the seed 42 pair and displayed both balances
and order counts at the 39.76 s cursor position.

## Match log version 1

Ticks are elapsed simulation ticks since match start. The viewer uses
`timestepMs` for the exact conversion when present and falls back to
`tickRate` for older logs. The exporter updates the same JSON file
atomically as milestones arrive. It includes the map checksum, seeds, bot
profiles, and lobby options for comparison.

New logs also carry optional `observation` metadata. Older version 1 logs
continue to open in the viewer, which shows that their observation endpoint
is unavailable. A normal match end, milestone stop, or
simulation cap records an exact final tick. An abrupt exit or wall-clock
timeout carries the last confirmed checkpoint. The viewer shows the stop
reason and marks the observation boundary on each timeline.

When present, `economy.samples` contains time-ordered balance snapshots
with cumulative `productionPaid` and `productionRefunded` values.
`economy.jobs` contains accepted entries in queueing order. A payment
slice records the actual cash and ore charged from its `firstTick`
through the checkpoint in `tick`. The optional `startedAt`, `readyAt`,
`completedAt`, and `cancelledAt` fields record lifecycle transitions.
Funding waits start on a failed charge and record the required payment
and funds available at that tick. They end at the next successful
charge or cancellation. A wait that is still open appears up to the
observation boundary. A pause or slowdown can extend the time between
payment attempts.

When present, `squadTimeline.squads` contains the squad kind, registry
tick, formation reason, optional initial target and disband tick,
ordered membership changes, and the optional first attack. An attack
records the queue and issue ticks, its order code, triggering decision,
target, participating actors, and the number of enemies assessed when
the decision supplied that count. Its `sequence` resolves orders issued
on the same tick. Participants reflect the actors the bot could still
order when it issued the command. Each actor record contains an actor ID,
internal type, and display name. `squadTimeline.decisions` records the scheduled
Assault and Rush evaluations, including the number of unassigned units
and the result. A decision that created or reinforced a squad also
identifies that squad.

When present, `combatTimeline.events` is sorted by tick and preserves the
recorded order of events within a tick. `afterOpeningOrder` records whether
the bot's first attack order had already been issued, even when the event
shares its tick. `openingUnit` follows a participating actor across roster
changes. For retreat decisions, it indicates that at least one opening
participant was in the squad when it decided to retreat.

The exporter records a squad's first contact in each observed phase.
Those phases are before the bot's opening attack order, after that order
but before this squad's own first attack order, and after this squad's
first attack order. `firstSquadContact` identifies those rows.
`openingContact` identifies the first qualifying damage involving any
participant in the bot's opening attack. One event can carry both flags.
`retreatId` joins each retreat decision to any commands issued for it.
Actor IDs are unique within a run.

```json
{
  "version": 1,
  "label": "Cadence 2",
  "setup": {
    "map": "Example map",
    "seed": 42,
    "faction": "Allies",
    "opponent": "Normal",
    "spawn": "1",
    "tickRate": 25,
    "timestepMs": 40,
    "botTickInterval": 2,
    "botOrderQuotient": 4,
    "difficulty": "classic-normal"
  },
  "events": [
    { "type": "production_building", "tick": 625 },
    { "type": "combat_unit", "tick": 1100 },
    { "type": "attack_order", "tick": 1800 },
    { "type": "enemy_contact", "tick": 2100 }
  ],
  "observation": {
    "observedThroughTick": 2400,
    "stopReason": "tick_limit",
    "exact": true,
    "tickLimit": 2400
  }
}
```

| Event | Recorded when |
|---|---|
| `production_building` | The bot places its first production building with a rally point. |
| `combat_unit` | The bot produces its first armed non-building actor. |
| `attack_order` | The bot issues its first offensive squad order against an enemy. |
| `enemy_contact` | A unit in that first attack order deals or receives positive enemy damage. |

Events can arrive out of order or repeat in imported logs. The viewer displays
the earliest tick for each event. The order-to-contact interval can include
order latency and travel. Units that are already fighting can register
contact immediately after the order.

## Blitz pilot results

The pilot used six matched seeds on Blitz with the included Rush-vs-Normal
profile. The Normal opponent used its built-in reactive AI. Each pair
held the exported controls fixed and changed the Rush bot's tick interval
from 2 to 4. Matches ran in a local test harness with a headless renderer.
Runs stopped at the fourth milestone or the wall-clock cap. The cap was
six minutes for seeds 42–44 and eight minutes for seeds 45–47. The
interval-4 run for seed 44 was repeated with a twelve-minute cap and
ended after recording production and combat-unit milestones.

On seed 42, the first measured gap appeared at production building placement
(53.24 s for interval 2 and 24.92 s for interval 4). The
4-tick bot issued its first offensive order 71.22 s earlier.
An [independent repeat](runs/seed42-interval2-repeat.json) of the interval-2
run reproduced all four milestone ticks exactly. The packaged runner also
reproduced both logs for seeds 42 and 45 byte for byte.

Both runs issued an offensive order within the observation window on 5 of
6 seeds. Interval 4 was earlier in 2 pairs and later in 3.
The median paired change was +9.84 s.

Times are in simulation seconds. Negative changes mean the event happened
earlier at interval 4. A dash marks an unresolved comparison.

| Seed | Attack at interval 2 | Attack at interval 4 | Attack change | Contact change | Logs |
|---:|---:|---:|---:|---:|---|
| 42 | 240.82 | 169.60 | -71.22 | -76.62 | [2 ticks](runs/seed42-interval2.json) · [4 ticks](runs/seed42-interval4.json) |
| 43 | 212.92 | 173.84 | -39.08 | -33.10 | [2 ticks](runs/seed43-interval2.json) · [4 ticks](runs/seed43-interval4.json) |
| 44 | 124.44 | — | — | — | [2 ticks](runs/seed44-interval2.json) · [4 ticks](runs/seed44-interval4.json) |
| 45 | 191.96 | 239.92 | +47.96 | +67.52 | [2 ticks](runs/seed45-interval2.json) · [4 ticks](runs/seed45-interval4.json) |
| 46 | 171.84 | 181.68 | +9.84 | +3.10 | [2 ticks](runs/seed46-interval2.json) · [4 ticks](runs/seed46-interval4.json) |
| 47 | 168.48 | 204.96 | +36.48 | +30.30 | [2 ticks](runs/seed47-interval2.json) · [4 ticks](runs/seed47-interval4.json) |

An exploratory [1-tick run](runs/seed42-interval1.json) on seed 42 issued its
first attack at 201.40 s. The 4-tick
run took 169.60 s and the 2-tick run took 240.82 s.

## First release verification

The exporter patch applied to the pinned checkout, and the Apple Silicon
build succeeded. Two local Blitz matches ran through a native Mac test launcher with the SDL/OpenGL
renderer. Their observer windows reached the exact 13,500-tick cap. Safari
opened the resulting [interval-2 log](runs/mac-blitz-interval2.json) and
[interval-4 log](runs/mac-blitz-interval4.json), including their observation
endpoints. The paired launcher was also checked from the clean build in
headless mode. Run-end probes covered a match ending on its own, a wall-clock
timeout, a user interruption, and a fatal map-script error.

The Mac Blitz pair issued its first attack orders at 120.80 s and 229.60 s.

## Fixed benchmark results

Three headless pairs on Observatory Range reached exactly tick 12,000.
Each run dispatched the four scripted waves at ticks 750, 2000, 3500,
and 5200. The runs also passed the boundary check at ticks 749 and 750.
The first wave appeared at the cutoff in the 750-tick runs. A separate test
edited the scenario sources between matches and confirmed both matches
used the one saved package. The results below use the headless renderer.

| Seed | Attack at interval 2 (s) | Attack at interval 4 (s) | Attack change (s) | Contact change (s) | Logs |
|---:|---:|---:|---:|---:|---|
| 42 | 39.76 | 127.52 | +87.76 | +94.40 | [2 ticks](benchmark-runs/seed42-interval2.json) · [4 ticks](benchmark-runs/seed42-interval4.json) |
| 43 | 59.28 | 148.56 | +89.28 | +82.18 | [2 ticks](benchmark-runs/seed43-interval2.json) · [4 ticks](benchmark-runs/seed43-interval4.json) |
| 45 | 74.56 | — | — | — | [2 ticks](benchmark-runs/seed45-interval2.json) · [4 ticks](benchmark-runs/seed45-interval4.json) |

A negative change means interval 4 recorded the milestone earlier. A dash
marks an event that remained unobserved at the common cutoff.

Both runs issued an attack order on two of three seeds. Interval 4 was
later in both pairs, with a median change of +88.52 s. Seed 45 remained
unresolved at the cutoff.

An independent headless repeat of seed 42 reproduced both benchmark logs
byte for byte.
