#!/usr/bin/env python3
"""Run two local OpenRA skirmishes with one changed bot cadence."""

import argparse
from dataclasses import dataclass
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

from benchmark_map import MAP_NAME, wave_schedule, write_benchmark_map

MILESTONES = ("production_building", "combat_unit", "attack_order", "enemy_contact")
PROFILE = Path(__file__).with_name("blitz.settings.yaml")


@dataclass(frozen=True)
class MatchProfile:
    settings: str
    map_name: str
    opponent: str
    map_uid: str = None
    archive: Path = None
    map_version: str = None
    wave_ticks: tuple = ()


def prepare_profile(args, session):
    settings = PROFILE.read_text(encoding="utf-8")
    if not args.benchmark:
        return MatchProfile(settings, "blitz.oramap", "normal/russia/2")

    archive = session / MAP_NAME
    waves = wave_schedule()
    uid = write_benchmark_map(archive, waves)
    settings = "\n".join(
        f"\tMap: {uid}" if line.startswith("\tMap: ") else line
        for line in settings.splitlines()
    ) + "\n"
    settings = settings.replace("normal: Multi1", "observatory-fixed: Multi1")
    version = (args.engine / "VERSION").read_text(encoding="utf-8").strip()
    return MatchProfile(settings, MAP_NAME, "observatory-fixed/russia/2",
                        uid, archive, version, tuple(sorted(waves)))


def mark_interrupted(path, match, reason):
    observation = match.get("observation", {})
    if observation.get("stopReason") not in (None, "in_progress"):
        return match
    last_event = max((event["tick"] for event in match["events"]), default=0)
    match["observation"] = {
        **observation,
        "observedThroughTick": observation.get("observedThroughTick", last_event),
        "stopReason": reason,
        "exact": False,
    }
    temp = path.with_suffix(".runner-tmp")
    temp.write_text(json.dumps(match, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temp.replace(path)
    return match


def check_wave_schedule(log_path, tick_limit, wave_ticks):
    prefix = "Lua debug: Observatory scheduled wave at tick "
    lines = log_path.read_text(encoding="utf-8").splitlines() if log_path.is_file() else []
    observed = [int(line[len(prefix):]) for line in lines if line.startswith(prefix)]
    expected = [tick for tick in wave_ticks if tick <= tick_limit]
    if observed != expected:
        raise RuntimeError(f"Unexpected wave schedule in {log_path}. Expected {expected} and observed {observed}.")


def run_match(args, session, interval, profile):
    run = session / f"interval-{interval}"
    support = run / "support"
    support.mkdir(parents=True)
    if profile.archive is not None:
        map_dir = support / "maps" / "ra" / profile.map_version
        map_dir.mkdir(parents=True)
        shutil.copyfile(profile.archive, map_dir / profile.map_name)
    (support / "settings.yaml").write_text(profile.settings, encoding="utf-8")
    (support / "Content").symlink_to(args.content.resolve(), target_is_directory=True)
    env = dict(os.environ, OPENRA_OBSERVATORY_DIR=str(run), OPENRA_OBSERVATORY_SEED=str(args.seed),
               OPENRA_OBSERVATORY_SPAWN="1", OPENRA_OBSERVATORY_INTERVAL=str(interval),
               OPENRA_OBSERVATORY_AUTOSTOP="1", OPENRA_OBSERVATORY_MAX_TICKS=str(args.max_ticks),
               OPENRA_OBSERVATORY_BOT_RANDOM="isolated" if args.benchmark else "shared")
    command = [
        args.dotnet, str(args.engine.resolve() / "bin/OpenRA.dll"), "Engine.EngineDir=..",
        f"Engine.SupportDir={support}", "Game.Mod=ra-classic", f"Launch.Map={profile.map_name}",
        "Launch.ObservatorySkirmish=True", "Graphics.Mode=Windowed", "Sound.Mute=True",
    ]
    if args.platform:
        command.append(f"Game.Platform={args.platform}")

    log_file = run / "openra.log"
    print(f"Starting interval {interval}. Logs will appear in {run}", flush=True)
    with log_file.open("w", encoding="utf-8") as output, subprocess.Popen(
        command, cwd=args.engine, env=env, stdout=output, stderr=subprocess.STDOUT
    ) as process:
        interrupted = "client_exited"
        try:
            process.wait(timeout=args.timeout)
        except subprocess.TimeoutExpired:
            interrupted = "wall_timeout"
        except KeyboardInterrupt:
            interrupted = "interrupted"
            raise
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            files = list(run.glob("match-*.json"))
            if len(files) == 1:
                path = files[0]
                match = mark_interrupted(path, json.loads(path.read_text(encoding="utf-8")), interrupted)

    if len(files) != 1:
        raise RuntimeError(f"Expected one match log (OpenRA exit {process.returncode}). See {log_file}.")
    if interrupted == "client_exited" and process.returncode != 0:
        raise RuntimeError(f"OpenRA exited with status {process.returncode}. See {log_file}.")
    setup = match["setup"]
    actual = (setup["seed"], setup.get("localSeed"), setup.get("botRandomSeed"), setup["botTickInterval"],
              setup["spawn"], setup["difficulty"], setup["opponent"])
    bot_seed = ~args.seed if args.benchmark else None
    expected = (args.seed, ~args.seed, bot_seed, interval, "1", "classic-normal", profile.opponent)
    if actual != expected or (profile.map_uid is not None and setup["mapUid"] != profile.map_uid):
        raise RuntimeError(f"Unexpected match settings in {path}.")
    observation = match["observation"]
    if args.benchmark and observation["stopReason"] == "tick_limit":
        check_wave_schedule(log_file, args.max_ticks, profile.wave_ticks)
    print(f"Interval {interval} stopped at tick {observation['observedThroughTick']} "
          f"with reason {observation['stopReason']}.", flush=True)
    return match


def print_comparison(a, b, benchmark_limit=None):
    controls = [
        ({k: v for k, v in match["setup"].items() if k != "botTickInterval"},
         match["observation"].get("tickLimit"))
        for match in (a, b)
    ]
    if controls[0] != controls[1]:
        raise RuntimeError("The exported control settings differ. Inspect the two JSON logs.")

    observations = [match["observation"] for match in (a, b)]
    if benchmark_limit is None:
        stopped_as_planned = all(observation["stopReason"] in
                                 {"match_ended", "milestones_complete", "tick_limit"} for observation in observations)
    else:
        stopped_as_planned = all(observation["stopReason"] == "tick_limit" and observation["exact"] and
                                 observation["observedThroughTick"] == benchmark_limit for observation in observations)
        if not stopped_as_planned:
            print(f"Both benchmark runs must reach simulation tick {benchmark_limit}.")
    for milestone in MILESTONES:
        values = []
        for match in (a, b):
            ticks = [event["tick"] for event in match["events"] if event["type"] == milestone]
            values.append(min(ticks) * match["setup"]["timestepMs"] / 1000 if ticks else None)
        first, second = values
        first_text = "—" if first is None else f"{first:.2f} s"
        second_text = "—" if second is None else f"{second:.2f} s"
        delta = "—" if None in values else f"{second - first:+.2f} s"
        print(f"{milestone:>20}  A {first_text:>9}  B {second_text:>9}  Δ {delta:>9}")
    if a.get("economy") and b.get("economy"):
        print("Production through each recorded cutoff")
        for label, match in zip(("A", "B"), (a, b)):
            economy = match["economy"]
            sample = economy["samples"][-1]
            jobs = economy["jobs"]
            completed = sum(job.get("completedAt") is not None for job in jobs)
            print(f"  {label} {len(jobs):>3} queued  {completed:>3} completed  "
                  f"{sample['productionPaid']:>6,} paid  {sample['productionRefunded']:>5,} refunded")
    if a.get("squadTimeline") and b.get("squadTimeline"):
        print("Squads through each recorded cutoff")
        for label, match in zip(("A", "B"), (a, b)):
            squads = match["squadTimeline"]["squads"]
            formed = [squad for squad in squads if squad["reason"] != "existing_squad"
                      and any(change["action"] == "joined" for change in squad["membershipChanges"])]
            first = min((squad for squad in squads if "firstAttack" in squad),
                        key=lambda squad: squad["firstAttack"]["sequence"], default=None)
            if first is None:
                attack = "no squad attack recorded"
            else:
                order = first["firstAttack"]
                time = order["issuedAt"] * match["setup"]["timestepMs"] / 1000
                count = len(order["units"])
                noun = "unit" if count == 1 else "units"
                attack = f"{first['kind']} #{first['id']} at {time:.2f} s, {count} {noun}"
            print(f"  {label} {len(formed):>3} formed  {attack}")
    if a.get("combatTimeline") and b.get("combatTimeline"):
        print("Combat after each run's first attack order")
        for label, match in zip(("A", "B"), (a, b)):
            attack = min((e["tick"] for e in match["events"] if e["type"] == "attack_order"), default=None)
            cutoff = match["observation"]["observedThroughTick"]
            tick_seconds = match["setup"]["timestepMs"] / 1000
            if attack is None:
                print(f"  {label} first attack unobserved through {cutoff * tick_seconds:.2f} s match time")
                continue
            combat = [e for e in match["combatTimeline"]["events"] if e["afterOpeningOrder"]]
            contact = next((e["tick"] for e in combat if e["openingContact"]), None)
            elapsed = "—" if contact is None else f"+{(contact - attack) * tick_seconds:.2f} s"
            losses = [e for e in combat if e["kind"] == "loss"]
            opening_losses = sum(e["openingUnit"] for e in losses)
            retreat_decisions = [e for e in combat if e["kind"] == "retreat_decided"]
            retreat_orders = [e for e in combat if e["kind"] == "retreat_order"]
            follow_up = (cutoff - attack) * tick_seconds
            print(f"  {label} opening contact {elapsed}, {len(losses)} losses ({opening_losses} opening), "
                  f"{len(retreat_decisions)} retreat decisions, {len(retreat_orders)} unit orders through +{follow_up:.2f} s")
            retreat = next((e for e in retreat_decisions if e["openingUnit"]), None)
            if retreat is not None:
                decision_time = (retreat["tick"] - attack) * tick_seconds
                dispatch = next((e for e in retreat_orders if e["retreatId"] == retreat["retreatId"]), None)
                issued = "unobserved" if dispatch is None else f"+{(dispatch['tick'] - attack) * tick_seconds:.2f} s"
                print(f"    Opening-unit retreat decided +{decision_time:.2f} s, first command {issued}")
    return stopped_as_planned


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("engine", type=Path, help="Path to the built OpenRA-ClassicAI checkout")
    parser.add_argument("--content", type=Path, required=True, help="OpenRA Content directory containing ra/v2")
    parser.add_argument("--output", type=Path, required=True, help="Parent directory for the two runs")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--intervals", nargs=2, type=int, default=[2, 4], metavar=("A", "B"))
    parser.add_argument("--timeout", type=int, default=360, help="Maximum wall-clock seconds per match")
    parser.add_argument("--benchmark", action="store_true", help="Use the fixed opponent on Observatory Range")
    parser.add_argument("--max-ticks", type=int,
                        help="Stop at this simulation tick. Defaults to 12000 for the benchmark and zero for Blitz.")
    parser.add_argument("--dotnet", default="dotnet", help="Path to the .NET executable")
    parser.add_argument("--platform", help="Optional OpenRA platform assembly name")
    args = parser.parse_args()
    if args.max_ticks is None:
        args.max_ticks = 12000 if args.benchmark else 0
    if args.benchmark and args.max_ticks == 0:
        parser.error("The fixed benchmark requires a positive simulation tick limit.")
    if not 0 <= args.max_ticks < 2 ** 31:
        parser.error("The tick limit must be zero or a positive signed 32-bit integer.")
    if not (args.engine / "bin/OpenRA.dll").is_file():
        parser.error("OpenRA.dll is missing under the engine checkout's bin directory.")
    if not (args.content / "ra/v2").is_dir():
        parser.error("The content directory must contain ra/v2.")
    if not all(1 <= interval < 2 ** 31 for interval in args.intervals) or len(set(args.intervals)) != 2 or args.timeout < 1:
        parser.error("Provide two distinct positive intervals and a positive timeout.")
    if not -(2 ** 31) <= args.seed < 2 ** 31:
        parser.error("The seed must fit a signed 32-bit integer.")
    dotnet = shutil.which(args.dotnet)
    if dotnet is None:
        parser.error(f"Could not find the .NET executable {args.dotnet}.")
    args.dotnet = str(Path(dotnet).resolve())

    args.output.mkdir(parents=True, exist_ok=True)
    session = Path(tempfile.mkdtemp(prefix=f"seed-{args.seed}-", dir=args.output.resolve()))
    try:
        profile = prepare_profile(args, session)
        first, second = (run_match(args, session, interval, profile) for interval in args.intervals)
        benchmark_limit = args.max_ticks if args.benchmark else None
        return 0 if print_comparison(first, second, benchmark_limit) else 1
    except KeyboardInterrupt:
        parser.exit(130, f"Run interrupted. Partial output is in {session}\n")
    except (OSError, RuntimeError, ValueError) as error:
        parser.exit(1, f"{error}\nPartial output is in {session}\n")


if __name__ == "__main__":
    raise SystemExit(main())
