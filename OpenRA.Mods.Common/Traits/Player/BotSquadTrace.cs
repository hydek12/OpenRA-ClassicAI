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

namespace OpenRA.Mods.Common.Traits
{
	sealed class BotSquadTrace(int id, string kind, int createdAt, string reason, BotSquadTrace.Unit initialTarget)
	{
		public int Id { get; } = id;
		public string Kind { get; } = kind;
		public int CreatedAt { get; } = createdAt;
		public string Reason { get; } = reason;
		public Unit InitialTarget { get; } = initialTarget;
		public int? DisbandedAt { get; set; }
		public List<Membership> MembershipChanges { get; } = [];
		public Attack FirstAttack { get; set; }

		internal sealed record Unit(uint Id, string Type, string Name);
		internal sealed record Membership(int Tick, string Action, Unit Unit, string Reason);
		internal sealed record Attack(int Sequence, int QueuedAt, int IssuedAt, string Order, string Trigger,
			int? AssessedEnemies, Unit Target, Unit[] Units);
		internal sealed record Decision(int Tick, string Kind, int Available, int Required,
			int Unassigned, string Outcome, int? SquadId);
		internal sealed record PendingAttack(BotSquadTrace Squad, int QueuedAt, string Trigger, int? AssessedEnemies);
	}
}
