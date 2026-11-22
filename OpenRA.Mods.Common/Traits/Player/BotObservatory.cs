#region Copyright & License Information
/*
 * Copyright (c) The OpenRA Developers and Contributors
 * This file is part of OpenRA, which is free software. It is made
 * available to you under the terms of the GNU General Public License
 * as published by the Free Software Foundation, either version 3 of
 * the License, or (at your option) any later version. For more
 * information, see COPYING.
 */
#endregion

using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Serialization;
using OpenRA.Mods.Common.Scripting;
using OpenRA.Primitives;
using OpenRA.Traits;

namespace OpenRA.Mods.Common.Traits
{
	[Desc("Exports match milestones, resources and production for ModularBot players in opted-in local skirmishes.")]
	[TraitLocation(SystemActors.Player)]
	public sealed class BotObservatoryInfo : TraitInfo
	{
		public override object Create(ActorInitializer init) { return new BotObservatory(init.World); }
	}

	public sealed class BotObservatory : INotifyBuildingPlaced, INotifyOtherProduction, INotifyDamage, INotifyAppliedDamage, INotifyKilled, INotifyActorDisposing
	{
		static readonly JsonSerializerOptions JsonOptions = new()
		{
			WriteIndented = true,
			PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
			DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
		};
		readonly World world;
		readonly List<Milestone> events = [];
		readonly List<BotProductionTrace> production = [];
		readonly List<EconomySample> economy = [];
		readonly List<BotSquadTrace> squads = [];
		readonly List<BotSquadTrace.Decision> squadDecisions = [];
		readonly Dictionary<uint, BotSquadTrace> activeSquads = [];
		readonly List<BotCombatEvent> combatEvents = [];
		readonly HashSet<(int SquadId, bool AfterOpeningOrder, bool AfterSquadOrder)> squadContacts = [];
		readonly HashSet<uint> recordedLosses = [];
		bool openingContactRecorded;
		int retreatSequence;
		readonly HashSet<uint> attackingActors = [];
		readonly string outputDirectory;
		readonly int selectedSpawn;
		readonly int? tickIntervalOverride;
		readonly int tickLimit;
		readonly bool autoStop;

		Player bot;
		PlayerResources resources;
		PowerManager power;
		MatchSetup setup;
		string path;
		bool started;
		bool exportFailed;
		int? savedMilestones;
		int squadAttackSequence;
		Observation observation;

		public BotObservatory(World world)
		{
			this.world = world;
			if (!Game.IsLocalSkirmish(world))
				return;

			outputDirectory = Environment.GetEnvironmentVariable("OPENRA_OBSERVATORY_DIR");
			if (int.TryParse(Environment.GetEnvironmentVariable("OPENRA_OBSERVATORY_SPAWN"), out var spawn) && spawn > 0)
				selectedSpawn = spawn;
			if (!string.IsNullOrWhiteSpace(outputDirectory) && selectedSpawn > 0 &&
				int.TryParse(Environment.GetEnvironmentVariable("OPENRA_OBSERVATORY_INTERVAL"), out var interval) && interval > 0)
				tickIntervalOverride = interval;

			autoStop = selectedSpawn > 0 && Environment.GetEnvironmentVariable("OPENRA_OBSERVATORY_AUTOSTOP") == "1";
			if (autoStop && int.TryParse(Environment.GetEnvironmentVariable("OPENRA_OBSERVATORY_MAX_TICKS"), out var limit) && limit > 0)
				tickLimit = limit;
		}

		internal int? TickIntervalOverride(Player player) => player.SpawnPoint == selectedSpawn ? tickIntervalOverride : null;

		internal void Start(Player player, int interval, int quotient, string difficulty)
		{
			if (started || string.IsNullOrWhiteSpace(outputDirectory) || (selectedSpawn > 0 && player.SpawnPoint != selectedSpawn))
				return;

			started = true;
			bot = player;
			resources = bot.PlayerActor.TraitOrDefault<PlayerResources>();
			power = bot.PlayerActor.TraitOrDefault<PowerManager>();
			var opponents = world.Players.Where(p => !p.NonCombatant && IsEnemy(p))
				.Select(p => $"{p.BotType ?? "human"}/{p.Faction.InternalName}/{p.SpawnPoint}")
				.OrderBy(p => p, StringComparer.Ordinal);
			var opponent = string.Join(", ", opponents);
			setup = new MatchSetup(world.Map.Title, world.Map.Uid, world.LobbyInfo.GlobalSettings.RandomSeed,
				world.ObservatoryLocalSeed, world.ObservatoryBotSeed,
				player.Faction.InternalName, opponent.Length > 0 ? opponent : "None", player.SpawnPoint.ToStringInvariant(),
				(int)Math.Round(1000d / world.Timestep), world.Timestep, interval, quotient,
				string.IsNullOrEmpty(difficulty) ? "default" : difficulty, player.BotType,
				world.LobbyInfo.GlobalSettings.LobbyOptions.ToDictionary(e => e.Key, e => e.Value.Value));

			path = Path.Combine(outputDirectory, $"match-{Guid.NewGuid():N}.json");
			observation = new Observation(world.WorldTick, "in_progress", true, tickLimit > 0 ? tickLimit : null);
			world.TickCompleted += TickCompleted;
			world.GameOver += GameOver;
			Game.OnQuit += OnQuit;
		}

		void TickCompleted()
		{
			if (observation.StopReason != "in_progress")
				return;

			if (tickLimit > 0 && world.WorldTick >= tickLimit)
				Finish("tick_limit");
			else if (autoStop && tickLimit == 0 && events.Count == 4)
				Finish("milestones_complete");
			else if (events.Count != savedMilestones ||
				world.WorldTick - observation.ObservedThroughTick >= BotProductionTrace.SampleInterval)
				Save();
		}

		void GameOver()
		{
			var scriptFailed = world.WorldActor.TraitOrDefault<LuaScript>()?.Context?.FatalErrorOccurred == true;
			Finish(scriptFailed ? "script_error" : world.IsOutOfSync ? "out_of_sync" : "match_ended");
		}

		void OnQuit() { Finish("client_closed"); }

		void INotifyActorDisposing.Disposing(Actor self)
		{
			if (observation != null)
				Finish("world_closed");
		}

		void Finish(string reason)
		{
			if (observation?.StopReason is not "in_progress")
				return;

			world.TickCompleted -= TickCompleted;
			world.GameOver -= GameOver;
			Game.OnQuit -= OnQuit;
			Save(reason);
			if (autoStop)
				Game.Exit();
		}

		internal BotProductionTrace ProductionQueued(ProductionItem item)
		{
			// A bulk delivery has a separate lifecycle after it leaves the production queue.
			if (!Recording || item.Queue is BulkProductionQueue)
				return null;

			var actor = world.Map.Rules.Actors[item.Item];
			var nameKey = actor.TraitInfoOrDefault<TooltipInfo>()?.Name;
			var name = !string.IsNullOrEmpty(nameKey) && FluentProvider.TryGetMessage(nameKey, out var display) ? display : item.Item;
			var trace = new BotProductionTrace(production.Count + 1, item.Queue.Info.Type, item.Item, name,
				actor.HasTraitInfo<BuildingInfo>(), item.TotalCost, world.WorldTick);
			production.Add(trace);
			return trace;
		}

		void SampleEconomy()
		{
			if (resources == null)
				return;

			foreach (var job in production)
				job.FlushPayments(world.WorldTick);

			var enabledQueues = world.ActorsWithTrait<ProductionQueue>()
				.Where(pair => pair.Actor.Owner == bot && pair.Trait.Enabled)
				.Select(pair => pair.Trait.Info.Type)
				.Distinct(StringComparer.Ordinal)
				.OrderBy(queue => queue, StringComparer.Ordinal)
				.ToArray();
			var sample = new EconomySample(world.WorldTick, resources.Cash, resources.Resources,
				resources.Earned, resources.Spent, power?.PowerProvided, power?.PowerDrained,
				production.Sum(job => (long)job.CashPaid + job.OrePaid),
				production.Sum(job => (long)job.CashRefunded + job.OreRefunded), enabledQueues);
			if (economy.Count > 0 && economy[^1].Tick == sample.Tick)
				economy[^1] = sample;
			else
				economy.Add(sample);
		}

		internal BotSquadTrace SquadCreated(string kind, string reason, Actor target)
		{
			if (!Recording)
				return null;

			var squad = new BotSquadTrace(squads.Count + 1, kind, world.WorldTick, reason,
				target == null ? null : SquadUnit(target));
			squads.Add(squad);
			return squad;
		}

		internal void SquadMemberChanged(BotSquadTrace squad, Actor actor, bool joined, string reason)
		{
			if (!Recording || actor == null)
				return;

			squad.MembershipChanges.Add(new BotSquadTrace.Membership(world.WorldTick,
				joined ? "joined" : "left", SquadUnit(actor), reason));
			if (joined)
				activeSquads[actor.ActorID] = squad;
			else if (activeSquads.GetValueOrDefault(actor.ActorID) == squad)
				activeSquads.Remove(actor.ActorID);
		}

		internal void SquadDisbanded(BotSquadTrace squad)
		{
			if (Recording)
				squad.DisbandedAt ??= world.WorldTick;
		}

		internal void SquadDecision(string kind, int available, int required, int unassigned, string outcome, BotSquadTrace squad = null)
		{
			if (Recording)
				squadDecisions.Add(new BotSquadTrace.Decision(world.WorldTick, kind, available, required,
					unassigned, outcome, squad?.Id));
		}

		static BotSquadTrace.Unit SquadUnit(Actor actor)
		{
			var key = actor.Info.TraitInfoOrDefault<TooltipInfo>()?.Name;
			var name = !string.IsNullOrEmpty(key) && FluentProvider.TryGetMessage(key, out var display) && !string.IsNullOrWhiteSpace(display)
				? display : actor.Info.Name;
			return new BotSquadTrace.Unit(actor.ActorID, actor.Info.Name, name);
		}

		internal void OrderIssued(Order order, Actor target, BotSquadTrace.PendingAttack attack)
		{
			if (!Recording || target == null || !IsEnemy(target.Owner))
				return;

			if (attack?.Squad is { FirstAttack: null } squad)
			{
				var participants = (order.GroupedActors ?? []).Append(order.Subject)
					.Where(IsAttacker).Distinct().Select(SquadUnit).ToArray();
				if (participants.Length > 0)
					squad.FirstAttack = new BotSquadTrace.Attack(++squadAttackSequence, attack.QueuedAt, world.WorldTick, order.OrderString,
						attack.Trigger, attack.AssessedEnemies, SquadUnit(target), participants);
			}

			if (attackingActors.Count > 0)
				return;

			if (order.GroupedActors != null)
				foreach (var actor in order.GroupedActors)
					TrackAttacker(actor);

			TrackAttacker(order.Subject);
			if (attackingActors.Count > 0)
				Record("attack_order");
		}

		bool IsAttacker(Actor actor) => actor != null && actor.Owner == bot && actor.IsInWorld && !actor.IsDead;

		void TrackAttacker(Actor actor)
		{
			if (IsAttacker(actor))
				attackingActors.Add(actor.ActorID);
		}

		bool IsEnemy(Player other) => bot.RelationshipWith(other) == PlayerRelationship.Enemy;

		internal bool Recording => setup != null && !exportFailed && observation?.StopReason == "in_progress" && !world.IsGameOver;

		void INotifyBuildingPlaced.BuildingPlaced(Actor self, Actor building)
		{
			if (Recording && building.Owner == bot &&
				building.Info.HasTraitInfo<ProductionInfo>() && building.Info.HasTraitInfo<RallyPointInfo>())
				Record("production_building");
		}

		void INotifyOtherProduction.UnitProducedByOther(Actor self, Actor producer, Actor produced, string productionType, TypeDictionary init)
		{
			if (Recording && produced.Owner == bot &&
				!produced.Info.HasTraitInfo<BuildingInfo>() && produced.Info.HasTraitInfo<ArmamentInfo>())
				Record("combat_unit");
		}

		void INotifyDamage.Damaged(Actor self, AttackInfo e)
		{
			if (Recording && e.Attacker != null && e.Damage.Value > 0 && IsEnemy(e.Attacker.Owner))
				ObserveContact(self, e.Attacker, e.Damage.Value, "received");
		}

		void INotifyAppliedDamage.AppliedDamage(Actor self, Actor damaged, AttackInfo e)
		{
			if (Recording && e.Damage.Value > 0 && IsEnemy(damaged.Owner))
				ObserveContact(self, damaged, e.Damage.Value, "dealt");
		}

		void ObserveContact(Actor unit, Actor opponent, int damage, string direction)
		{
			var openingUnit = attackingActors.Contains(unit.ActorID);
			var firstOpening = openingUnit && !openingContactRecorded;
			var squad = activeSquads.GetValueOrDefault(unit.ActorID);
			var afterOpeningOrder = attackingActors.Count > 0;
			var afterSquadOrder = squad?.FirstAttack != null;
			var firstInPhase = squad != null && squadContacts.Add((squad.Id, afterOpeningOrder, afterSquadOrder));
			if (firstOpening)
			{
				openingContactRecorded = true;
				Record("enemy_contact");
			}

			if (firstOpening || firstInPhase)
				combatEvents.Add(new BotCombatEvent(world.WorldTick, "contact", squad?.Id,
					SquadUnit(unit), SquadUnit(opponent), direction, Damage: damage,
					OpeningUnit: openingUnit, OpeningContact: firstOpening, AfterOpeningOrder: afterOpeningOrder,
					AfterSquadOrder: afterSquadOrder, FirstSquadContact: firstInPhase));
		}

		void INotifyKilled.Killed(Actor self, AttackInfo e)
		{
			if (!Recording || self.Owner != bot || self.Info.HasTraitInfo<HuskInfo>())
				return;

			var squad = activeSquads.GetValueOrDefault(self.ActorID);
			var openingUnit = attackingActors.Contains(self.ActorID);
			if ((squad == null && !openingUnit && !self.Info.HasTraitInfo<IMoveInfo>()) || !recordedLosses.Add(self.ActorID))
				return;

			var attacker = e.Attacker;
			var cause = attacker == null ? "unknown" :
				IsEnemy(attacker.Owner) ? "enemy" :
				bot.RelationshipWith(attacker.Owner) == PlayerRelationship.Ally ? "allied" : "other";
			combatEvents.Add(new BotCombatEvent(world.WorldTick, "loss", squad?.Id, SquadUnit(self),
				attacker == null ? null : SquadUnit(attacker), cause, OpeningUnit: openingUnit,
				AfterOpeningOrder: attackingActors.Count > 0));
			activeSquads.Remove(self.ActorID);
		}

		internal BotCombatEvent.Retreat RetreatDecided(BotSquadTrace squad, IEnumerable<Actor> units, string reason)
		{
			if (!Recording)
				return null;

			var count = 0;
			var openingUnit = false;
			foreach (var unit in units)
			{
				count++;
				openingUnit |= attackingActors.Contains(unit.ActorID);
			}

			var id = ++retreatSequence;
			combatEvents.Add(new BotCombatEvent(world.WorldTick, "retreat_decided", squad.Id,
				Detail: reason, RetreatId: id, UnitCount: count, OpeningUnit: openingUnit,
				AfterOpeningOrder: attackingActors.Count > 0));
			return new BotCombatEvent.Retreat(id, squad.Id);
		}

		internal void RetreatOrderIssued(Order order, BotCombatEvent.Retreat retreat)
		{
			if (!Recording || !IsAttacker(order.Subject))
				return;

			combatEvents.Add(new BotCombatEvent(world.WorldTick, "retreat_order", retreat.SquadId,
				SquadUnit(order.Subject), Detail: order.OrderString, RetreatId: retreat.Id,
				OpeningUnit: attackingActors.Contains(order.Subject.ActorID), AfterOpeningOrder: attackingActors.Count > 0));
		}

		void Record(string type)
		{
			if (events.Exists(e => e.Type == type))
				return;

			events.Add(new Milestone(type, world.WorldTick));
		}

		void Save(string reason = "in_progress")
		{
			observation = new Observation(world.WorldTick, reason, true, tickLimit > 0 ? tickLimit : null);
			if (exportFailed)
				return;

			try
			{
				SampleEconomy();
				Directory.CreateDirectory(outputDirectory);
				var ledger = resources == null ? null : new EconomyTrace(BotProductionTrace.SampleInterval, economy, production);
				var data = new MatchLog(1, $"{bot.BotType} · spawn {setup.Spawn} · interval {setup.BotTickInterval}", setup, events, observation, ledger,
					new SquadTimeline(squads, squadDecisions), new CombatTimeline(combatEvents));
				var temporaryPath = path + ".tmp";
				using (var stream = File.Create(temporaryPath))
					JsonSerializer.Serialize(stream, data, JsonOptions);

				File.Move(temporaryPath, path, true);
				savedMilestones = events.Count;
			}
			catch (Exception e) when (e is IOException or UnauthorizedAccessException or ArgumentException or NotSupportedException)
			{
				exportFailed = true;
				Log.Write("debug", $"Bot Observatory could not write {path} ({e.Message}).");
			}
		}

		sealed record MatchLog(int Version, string Label, MatchSetup Setup, List<Milestone> Events, Observation Observation,
			EconomyTrace Economy, SquadTimeline SquadTimeline, CombatTimeline CombatTimeline);
		sealed record CombatTimeline(List<BotCombatEvent> Events);
		sealed record SquadTimeline(List<BotSquadTrace> Squads, List<BotSquadTrace.Decision> Decisions);
		sealed record EconomyTrace(int SampleEveryTicks, List<EconomySample> Samples, List<BotProductionTrace> Jobs);
		sealed record EconomySample(int Tick, int Cash, int Ore, int Earned, int NetSpent, int? PowerProvided, int? PowerDrained,
			long ProductionPaid, long ProductionRefunded, string[] EnabledQueues);
		sealed record Observation(int ObservedThroughTick, string StopReason, bool Exact, int? TickLimit);
		sealed record MatchSetup(string Map, string MapUid, int Seed, int? LocalSeed, int? BotRandomSeed, string Faction, string Opponent, string Spawn,
			int TickRate, int TimestepMs, int BotTickInterval, int BotOrderQuotient, string Difficulty, string BotType, Dictionary<string, string> LobbyOptions);
		sealed record Milestone(string Type, int Tick);
	}
}
