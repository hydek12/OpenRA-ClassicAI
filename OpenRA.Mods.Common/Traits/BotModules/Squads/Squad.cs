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

using System.Collections.Generic;
using System.Linq;
using OpenRA.Support;
using OpenRA.Traits;

namespace OpenRA.Mods.Common.Traits.BotModules.Squads
{
	public enum SquadType { Assault, Air, Rush, Protection, Naval }

	public class Squad
	{
		public HashSet<Actor> Units = [];
		public SquadType Type;

		internal IBot Bot;
		internal World World;
		internal SquadManagerBotModule SquadManager;
		internal MersenneTwister Random;
		internal StateMachine FuzzyStateMachine;

		/// <summary>
		/// Target location to attack. This will be either the targeted actor,
		/// or a position close to that actor sufficient to get within weapons range.
		/// </summary>
		internal Target Target { get; set; }

		/// <summary>
		/// Actor that is targeted, for any actor based checks. Use <see cref="Target"/> for a targeting location.
		/// </summary>
		internal Actor TargetActor;

		public Squad(IBot bot, SquadManagerBotModule squadManager, SquadType type)
			: this(bot, squadManager, type, default) { }

		public Squad(IBot bot, SquadManagerBotModule squadManager, SquadType type, (Actor Actor, WVec Offset) target)
		{
			Bot = bot;
			SquadManager = squadManager;
			World = bot.Player.PlayerActor.World;
			Random = World.BotRandom;
			Type = type;
			SetActorToTarget(target);
			FuzzyStateMachine = new StateMachine();

			switch (type)
			{
				case SquadType.Assault:
				case SquadType.Rush:
				case SquadType.Naval:
					FuzzyStateMachine.ChangeState(this, new GroundUnitsIdleState());
					break;
				case SquadType.Air:
					FuzzyStateMachine.ChangeState(this, new AirIdleState());
					break;
				case SquadType.Protection:
					FuzzyStateMachine.ChangeState(this, new UnitsForProtectionIdleState());
					break;
			}
		}

		BotObservatory observatory;
		BotCombatEvent.Retreat retreat;
		internal BotSquadTrace ObservatoryTrace { get; private set; }

		internal void Observe(BotObservatory recorder, string reason)
		{
			if (ObservatoryTrace != null || recorder?.Recording != true)
				return;

			ObservatoryTrace = recorder.SquadCreated(Type.ToString(), reason, TargetActor);
			if (ObservatoryTrace == null)
				return;

			observatory = recorder;
			foreach (var unit in Units)
				observatory.SquadMemberChanged(ObservatoryTrace, unit, true, reason);
		}

		internal void AddUnit(Actor unit, string reason)
		{
			if (Units.Add(unit) && ObservatoryTrace != null)
				observatory.SquadMemberChanged(ObservatoryTrace, unit, true, reason);
		}

		internal void AddUnits(IEnumerable<Actor> units, string reason)
		{
			if (ObservatoryTrace == null)
				Units.UnionWith(units);
			else
				foreach (var unit in units)
					AddUnit(unit, reason);
		}

		internal void RemoveUnavailable(System.Predicate<Actor> unavailable)
		{
			if (ObservatoryTrace == null)
				Units.RemoveWhere(unavailable);
			else
				Units.RemoveWhere(unit =>
				{
					if (!unavailable(unit))
						return false;

					if (unit != null)
					{
						var reason = unit.IsDead ? "destroyed" : unit.IsInWorld ? "owner_changed" : "left_world";
						observatory.SquadMemberChanged(ObservatoryTrace, unit, false, reason);
					}

					return true;
				});
		}

		internal void ReleaseUnits()
		{
			if (ObservatoryTrace != null)
				foreach (var unit in Units)
					observatory.SquadMemberChanged(ObservatoryTrace, unit, false, "released");

			Units.Clear();
		}

		internal void Retire()
		{
			if (ObservatoryTrace != null)
				observatory.SquadDisbanded(ObservatoryTrace);
		}

		internal void SetRetreat(string reason)
		{
			retreat = reason == null || ObservatoryTrace == null ? null : observatory.RetreatDecided(ObservatoryTrace, Units, reason);
		}

		internal void QueueRetreatOrder(Order order)
		{
			if (retreat != null && Bot is ModularBot modularBot)
				modularBot.QueueRetreatOrder(order, retreat);
			else
				Bot.QueueOrder(order);
		}

		internal void QueueAttackOrder(Order order, string trigger, int? assessedEnemies = null)
		{
			if (Bot is ModularBot modularBot)
				modularBot.QueueAttackOrder(order, TargetActor, ObservatoryTrace, trigger, assessedEnemies);
			else
				Bot.QueueOrder(order);
		}

		public void Update()
		{
			if (IsValid)
				FuzzyStateMachine.Update(this);
		}

		public bool IsValid => Units.Count > 0;

		public void SetActorToTarget((Actor Actor, WVec Offset) target)
		{
			TargetActor = target.Actor;
			if (TargetActor == null)
			{
				Target = Target.Invalid;
				return;
			}

			if (target.Offset == WVec.Zero)
				Target = Target.FromActor(TargetActor);
			else
				Target = Target.FromPos(TargetActor.CenterPosition + target.Offset);
		}

		/// <summary>
		/// Checks the target is still valid, and updates the <see cref="Target"/> location if it is still valid.
		/// </summary>
		public bool IsTargetValid(Actor squadUnit)
		{
			var valid =
				TargetActor != null &&
				TargetActor.IsInWorld &&
				!TargetActor.IsDead &&
				Units.Any(Target.IsValidFor) &&
				!TargetActor.Info.HasTraitInfo<HuskInfo>();
			if (!valid)
				return false;

			// Refresh the target location.
			// If the actor moved out of reach then we'll mark it invalid.
			// e.g. a ship targeting a land unit that moves inland out of weapons range.
			// or the target crossed a bridge which is then destroyed.
			// If it is still in range but we have to target a nearby location, we can update that location.
			// e.g. a ship targeting a land unit, but the land unit moved north.
			// We need to update our location to move north as well.
			// If we can reach the actor directly, we'll just target it directly.
			var target = SquadManager.FindEnemies([TargetActor], squadUnit).FirstOrDefault();
			SetActorToTarget(target);
			return target.Actor != null;
		}

		public bool IsTargetVisible =>
			TargetActor != null &&
			TargetActor.CanBeViewedByPlayer(Bot.Player);

		public WPos CenterPosition()
		{
			return Units.Select(a => a.CenterPosition).Average();
		}

		public Actor CenterUnit()
		{
			var centerPosition = CenterPosition();
			return Units.MinByOrDefault(a => (a.CenterPosition - centerPosition).LengthSquared);
		}

		public MiniYaml Serialize()
		{
			var nodes = new List<MiniYamlNode>()
			{
				new("Type", FieldSaver.FormatValue(Type)),
				new("Units", FieldSaver.FormatValue(Units.Select(a => a.ActorID).ToArray()))
			};

			if (Target.Type != TargetType.Invalid)
			{
				nodes.Add(new MiniYamlNode("ActorToTarget", FieldSaver.FormatValue(TargetActor.ActorID)));
				nodes.Add(new MiniYamlNode("TargetOffset", FieldSaver.FormatValue(Target.CenterPosition - TargetActor.CenterPosition)));
			}

			return new MiniYaml("", nodes);
		}

		public static Squad Deserialize(IBot bot, SquadManagerBotModule squadManager, MiniYaml yaml)
		{
			var type = SquadType.Rush;
			var target = ((Actor)null, WVec.Zero);

			var typeNode = yaml.NodeWithKeyOrDefault("Type");
			if (typeNode != null)
				type = FieldLoader.GetValue<SquadType>("Type", typeNode.Value.Value);

			var actorToTargetNode = yaml.NodeWithKeyOrDefault("ActorToTarget");
			var targetOffsetNode = yaml.NodeWithKeyOrDefault("TargetOffset");
			if (actorToTargetNode != null && targetOffsetNode != null)
			{
				var actorToTarget = squadManager.World.GetActorById(FieldLoader.GetValue<uint>("ActorToTarget", actorToTargetNode.Value.Value));
				var targetOffset = FieldLoader.GetValue<WVec>("TargetOffset", targetOffsetNode.Value.Value);
				target = (actorToTarget, targetOffset);
			}

			var squad = new Squad(bot, squadManager, type, target);

			var unitsNode = yaml.NodeWithKeyOrDefault("Units");
			if (unitsNode != null)
				squad.Units.UnionWith(FieldLoader.GetValue<uint[]>("Units", unitsNode.Value.Value)
					.Select(squadManager.World.GetActorById));

			return squad;
		}
	}
}
