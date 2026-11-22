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

namespace OpenRA.Mods.Common.Traits
{
	sealed record BotCombatEvent(int Tick, string Kind, int? SquadId, BotSquadTrace.Unit Unit = null,
		BotSquadTrace.Unit Opponent = null, string Detail = null, int? Damage = null, int? RetreatId = null,
		int? UnitCount = null, bool OpeningUnit = false, bool OpeningContact = false,
		bool AfterOpeningOrder = false, bool AfterSquadOrder = false, bool FirstSquadContact = false)
	{
		internal sealed record Retreat(int Id, int SquadId);
	}
}
