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

// Agentic Gemini 4 Hydrogen High
using OpenRA.Mods.Common.Traits;
using OpenRA.Scripting;

namespace OpenRA.Mods.Common.Scripting
{
	[ScriptGlobal("CustomDifficulty")]
	public class CustomDifficultyGlobal : ScriptGlobal
	{
		readonly CustomDifficultyRules rules;

		public CustomDifficultyGlobal(ScriptContext context)
			: base(context)
		{
			rules = context.World.WorldActor.TraitOrDefault<CustomDifficultyRules>();
		}

		[Desc("Returns true when CustomDifficultyRules is loaded on the World actor.")]
		public bool IsEnabled()
		{
			return rules != null;
		}

		[Desc("Returns the list of all preset names defined in MiniYAML.")]
		public string[] GetPresetNames()
		{
			return rules != null ? rules.GetPresetNames() : [];
		}

		[Desc("Returns the active difficulty preset name, or nil if disabled.")]
		public string GetPreset()
		{
			return rules?.ActivePreset;
		}

		[Desc("Sets the active difficulty preset by name and updates player conditions. Returns true on success.")]
		public bool SetPreset(string presetName)
		{
			return rules != null && rules.SetPreset(presetName);
		}

		[Desc("Returns the effective difficulty preset name for a specific player.")]
		public string GetPlayerPreset(Player player)
		{
			return rules?.GetPlayerPresetName(player);
		}

		[Desc("Sets or clears (when nil) a per-player difficulty preset override and updates that player's conditions.")]
		public bool SetPlayerPreset(Player player, string presetName = null)
		{
			return rules != null && rules.SetPlayerPreset(player, presetName);
		}

		[Desc("Returns the effective percentage multiplier (100 = 1.0x) for a modifier key (e.g. 'Firepower', 'Armor', 'Groundspeed', 'Airspeed', 'ROF', 'Cost', 'BuildTime') on a player.")]
		public int GetMultiplier(Player player, string modifierKey)
		{
			return rules != null ? rules.GetModifiers(player).GetByKey(modifierKey) : 100;
		}
	}
}
