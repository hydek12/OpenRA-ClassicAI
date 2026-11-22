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
using System;
using System.Collections.Frozen;
using System.Collections.Generic;
using System.Linq;
using OpenRA.Traits;

namespace OpenRA.Mods.Common.Traits
{
	public sealed class CustomDifficultyModifiers
	{
		public static readonly CustomDifficultyModifiers Default = new();

		[Desc("Optional condition granted to the PlayerActor when this target block is active.")]
		public readonly string Condition = null;

		[Desc("Optional condition granted to actors with CustomDifficultyActorModifier owned by a matching player.")]
		public readonly string ActorCondition = null;

		[Desc("Tick interval for ModularBot module updates (1 = every tick, 2 = every 2nd tick, etc.).")]
		public readonly int BotTickInterval = 1;

		[Desc("Overrides ModularBotInfo.MinOrderQuotientPerTick when > 0 (1 = flush all pending bot orders immediately).")]
		public readonly int BotOrderQuotient = 0;

		[Desc("Percentage multiplier applied to weapon damage dealt (100 = 1.0x).")]
		public readonly int Firepower = 100;

		[Desc("Percentage multiplier applied to effective armor/toughness (100 = 1.0x, 120 = ~83% damage taken, 80 = 125% damage taken).")]
		public readonly int Armor = 100;

		[Desc("Percentage multiplier applied to ground and naval movement speed (100 = 1.0x).")]
		public readonly int Groundspeed = 100;

		[Desc("Percentage multiplier applied to aircraft movement speed (100 = 1.0x).")]
		public readonly int Airspeed = 100;

		[Desc("Percentage multiplier applied to weapon reload delay (100 = 1.0x; lower values fire faster).")]
		public readonly int ROF = 100;

		[Desc("Percentage multiplier applied to ammo reload delay (100 = 1.0x).")]
		public readonly int ReloadAmmo = 100;

		[Desc("Percentage multiplier applied to weapon inaccuracy (100 = 1.0x).")]
		public readonly int Inaccuracy = 100;

		[Desc("Percentage multiplier applied to weapon range (100 = 1.0x).")]
		public readonly int Range = 100;

		[Desc("Percentage multiplier applied to production cost (100 = 1.0x).")]
		public readonly int Cost = 100;

		[Desc("Percentage multiplier applied to production build duration (100 = 1.0x).")]
		public readonly int BuildTime = 100;

		[Desc("Percentage multiplier applied to actor power generation/consumption (100 = 1.0x).")]
		public readonly int Power = 100;

		[Desc("Percentage multiplier applied to cash trickler income (100 = 1.0x).")]
		public readonly int CashTrickler = 100;

		[Desc("Percentage multiplier applied to delivered resource value (100 = 1.0x).")]
		public readonly int ResourceValue = 100;

		[Desc("Percentage multiplier applied to experience granted on kill (100 = 1.0x).")]
		public readonly int GivesExperience = 100;

		[Desc("Percentage multiplier applied to experience gained (100 = 1.0x).")]
		public readonly int GainsExperience = 100;

		[Desc("Percentage multiplier applied to shroud creation radius (100 = 1.0x).")]
		public readonly int CreatesShroud = 100;

		[Desc("Percentage multiplier applied to shroud reveal radius (100 = 1.0x).")]
		public readonly int RevealsShroud = 100;

		[Desc("Percentage multiplier applied to cloak detection radius (100 = 1.0x).")]
		public readonly int DetectCloaked = 100;

		public CustomDifficultyModifiers() { }

		public CustomDifficultyModifiers(MiniYaml yaml)
		{
			FieldLoader.Load(this, yaml);
		}

		public int GetByKey(string key)
		{
			return key switch
			{
				nameof(Firepower) => Firepower,
				nameof(Armor) => Armor,
				nameof(Groundspeed) => Groundspeed,
				nameof(Airspeed) => Airspeed,
				nameof(ROF) => ROF,
				nameof(ReloadAmmo) => ReloadAmmo,
				nameof(Inaccuracy) => Inaccuracy,
				nameof(Range) => Range,
				nameof(Cost) => Cost,
				nameof(BuildTime) => BuildTime,
				nameof(Power) => Power,
				nameof(CashTrickler) => CashTrickler,
				nameof(ResourceValue) => ResourceValue,
				nameof(GivesExperience) => GivesExperience,
				nameof(GainsExperience) => GainsExperience,
				nameof(CreatesShroud) => CreatesShroud,
				nameof(RevealsShroud) => RevealsShroud,
				nameof(DetectCloaked) => DetectCloaked,
				nameof(BotTickInterval) => BotTickInterval,
				nameof(BotOrderQuotient) => BotOrderQuotient,
				_ => 100
			};
		}
	}

	public sealed class CustomDifficultyPreset
	{
		[Desc("Display label (or Fluent key) shown in the lobby dropdown.")]
		public readonly string Label = null;

		[Desc("Condition granted on every combatant PlayerActor while this preset is active.")]
		public readonly string PlayerCondition = null;

		[Desc("Condition granted on human PlayerActors while this preset is active.")]
		public readonly string HumanCondition = null;

		[Desc("Condition granted on AI bot PlayerActors while this preset is active.")]
		public readonly string BotCondition = null;

		[FieldLoader.LoadUsing(nameof(LoadHuman))]
		[Desc("Modifier overrides applied to human players.")]
		public readonly CustomDifficultyModifiers Human = null;

		[FieldLoader.LoadUsing(nameof(LoadBot))]
		[Desc("Modifier overrides applied to AI bot players unless matched by BotTypes.")]
		public readonly CustomDifficultyModifiers Bot = null;

		[FieldLoader.LoadUsing(nameof(LoadBotTypes))]
		[Desc("Per-bot-type modifier and condition overrides keyed by ModularBot Type (e.g. rush, normal, turtle, naval, campaign).")]
		public readonly FrozenDictionary<string, CustomDifficultyModifiers> BotTypes = FrozenDictionary<string, CustomDifficultyModifiers>.Empty;

		[FieldLoader.LoadUsing(nameof(LoadPlayers))]
		[Desc("Per-player modifier and condition overrides keyed by player InternalName.")]
		public readonly FrozenDictionary<string, CustomDifficultyModifiers> Players = FrozenDictionary<string, CustomDifficultyModifiers>.Empty;

		readonly CustomDifficultyModifiers fallback;

		public CustomDifficultyPreset()
		{
			fallback = CustomDifficultyModifiers.Default;
		}

		public CustomDifficultyPreset(MiniYaml yaml)
		{
			FieldLoader.Load(this, yaml);
			fallback = new CustomDifficultyModifiers(yaml);
		}

		static object LoadHuman(MiniYaml yaml)
		{
			var node = yaml.NodeWithKeyOrDefault("Human");
			return node != null ? new CustomDifficultyModifiers(node.Value) : null;
		}

		static object LoadBot(MiniYaml yaml)
		{
			var node = yaml.NodeWithKeyOrDefault("Bot");
			return node != null ? new CustomDifficultyModifiers(node.Value) : null;
		}

		static object LoadBotTypes(MiniYaml yaml)
		{
			return LoadModifierDictionary(yaml, "BotTypes");
		}

		static object LoadPlayers(MiniYaml yaml)
		{
			return LoadModifierDictionary(yaml, "Players");
		}

		static FrozenDictionary<string, CustomDifficultyModifiers> LoadModifierDictionary(MiniYaml yaml, string sectionName)
		{
			var section = yaml.NodeWithKeyOrDefault(sectionName);
			if (section == null)
				return FrozenDictionary<string, CustomDifficultyModifiers>.Empty;

			var dict = new Dictionary<string, CustomDifficultyModifiers>(section.Value.Nodes.Length);
			foreach (var node in section.Value.Nodes)
				dict[node.Key] = new CustomDifficultyModifiers(node.Value);

			return dict.ToFrozenDictionary();
		}

		public CustomDifficultyModifiers ResolveFor(Player player)
		{
			if (player == null || player.NonCombatant)
				return CustomDifficultyModifiers.Default;

			if (!string.IsNullOrEmpty(player.InternalName) && Players.TryGetValue(player.InternalName, out var playerOverride))
				return playerOverride;

			if (player.IsBot)
			{
				if (!string.IsNullOrEmpty(player.BotType) && BotTypes.TryGetValue(player.BotType, out var botTypeOverride))
					return botTypeOverride;

				if (Bot != null)
					return Bot;
			}
			else if (Human != null)
			{
				return Human;
			}

			return fallback;
		}

		internal static IEnumerable<string> SplitConditions(string raw)
		{
			if (string.IsNullOrWhiteSpace(raw))
				yield break;

			foreach (var part in raw.Split(','))
			{
				var trimmed = part.Trim();
				if (!string.IsNullOrEmpty(trimmed))
					yield return trimmed;
			}
		}

		public IEnumerable<string> ResolveConditions(Player player)
		{
			if (player == null || player.NonCombatant)
				yield break;

			foreach (var condition in SplitConditions(PlayerCondition))
				yield return condition;

			if (player.IsBot)
			{
				foreach (var condition in SplitConditions(BotCondition))
					yield return condition;
			}
			else
			{
				foreach (var condition in SplitConditions(HumanCondition))
					yield return condition;
			}

			var resolved = ResolveFor(player);
			foreach (var condition in SplitConditions(resolved.Condition))
				yield return condition;
		}
	}

	[TraitLocation(SystemActors.World)]
	[Desc("Defines extensible, mod-driven difficulty presets in MiniYAML and exposes lobby and Lua selection.")]
	public class CustomDifficultyRulesInfo : TraitInfo, ILobbyOptions
	{
		[Desc("Internal lobby option ID for selecting the active custom difficulty preset.")]
		public readonly string LobbyOptionId = "custom-difficulty";

		[FluentReference]
		[Desc("Lobby dropdown label (Fluent key).")]
		public readonly string LobbyDropdownLabel = "dropdown-custom-difficulty.label";

		[FluentReference]
		[Desc("Lobby dropdown description (Fluent key).")]
		public readonly string LobbyDropdownDescription = "dropdown-custom-difficulty.description";

		[Desc("Default preset key active when no lobby or Lua override is selected.")]
		public readonly string DefaultPreset = "default";

		[Desc("Whether to show the difficulty dropdown in the lobby.")]
		public readonly bool LobbyDropdownVisible = true;

		[Desc("Whether to lock the difficulty dropdown in the lobby.")]
		public readonly bool LobbyDropdownLocked = false;

		[Desc("Display order for the difficulty dropdown in the lobby.")]
		public readonly int LobbyDropdownDisplayOrder = 10;

		[FieldLoader.LoadUsing(nameof(LoadPresets))]
		[Desc("Named difficulty presets defined in MiniYAML.")]
		public readonly FrozenDictionary<string, CustomDifficultyPreset> Presets = FrozenDictionary<string, CustomDifficultyPreset>.Empty;

		static object LoadPresets(MiniYaml yaml)
		{
			var presetsNode = yaml.NodeWithKeyOrDefault("Presets");
			if (presetsNode == null)
				return FrozenDictionary<string, CustomDifficultyPreset>.Empty;

			var result = new Dictionary<string, CustomDifficultyPreset>(presetsNode.Value.Nodes.Length);
			foreach (var node in presetsNode.Value.Nodes)
				result[node.Key] = new CustomDifficultyPreset(node.Value);

			return result.ToFrozenDictionary();
		}

		IEnumerable<LobbyOption> ILobbyOptions.LobbyOptions(MapPreview map)
		{
			if (Presets.Count == 0 || string.IsNullOrEmpty(LobbyOptionId))
				yield break;

			var values = new Dictionary<string, string>(Presets.Count);
			foreach (var kv in Presets)
			{
				var labelKey = kv.Value.Label;
				values[kv.Key] = string.IsNullOrEmpty(labelKey) ? kv.Key : labelKey;
			}

			var defaultKey = Presets.ContainsKey(DefaultPreset) ? DefaultPreset : string.Empty;
			yield return new LobbyOption(map, LobbyOptionId, LobbyDropdownLabel, LobbyDropdownDescription,
				LobbyDropdownVisible, LobbyDropdownDisplayOrder, values, defaultKey, LobbyDropdownLocked);
		}

		public override object Create(ActorInitializer init) { return new CustomDifficultyRules(init.Self, this); }
	}

	public class CustomDifficultyRules : INotifyCreated
	{
		readonly Actor worldActor;
		readonly CustomDifficultyRulesInfo info;
		readonly Dictionary<string, string> playerPresetOverrides = [];

		public string ActivePreset { get; private set; }

		public CustomDifficultyRules(Actor worldActor, CustomDifficultyRulesInfo info)
		{
			this.worldActor = worldActor;
			this.info = info;
			ActivePreset = info.DefaultPreset;
		}

		void INotifyCreated.Created(Actor self)
		{
			if (!string.IsNullOrEmpty(info.LobbyOptionId))
			{
				var selected = self.World.LobbyInfo.GlobalSettings.OptionOrDefault(info.LobbyOptionId, info.DefaultPreset);
				if (HasPreset(selected))
					ActivePreset = selected;
			}
		}

		public string[] GetPresetNames()
		{
			return info.Presets.Keys.ToArray();
		}

		public bool HasPreset(string presetName)
		{
			return !string.IsNullOrEmpty(presetName) && info.Presets.ContainsKey(presetName);
		}

		public bool SetPreset(string presetName)
		{
			if (!HasPreset(presetName))
				return false;

			ActivePreset = presetName;
			RefreshAllPlayerConditions();
			RefreshAllActorConditions();
			return true;
		}

		public bool SetPlayerPreset(Player player, string presetName)
		{
			if (player == null)
				return false;

			if (string.IsNullOrEmpty(presetName))
			{
				playerPresetOverrides.Remove(player.InternalName);
				RefreshPlayerCondition(player);
				RefreshActorConditionsForPlayer(player);
				return true;
			}

			if (!HasPreset(presetName))
				return false;

			playerPresetOverrides[player.InternalName] = presetName;
			RefreshPlayerCondition(player);
			RefreshActorConditionsForPlayer(player);
			return true;
		}

		public string GetPlayerPresetName(Player player)
		{
			if (player != null && !string.IsNullOrEmpty(player.InternalName) && playerPresetOverrides.TryGetValue(player.InternalName, out var overridePreset))
				return overridePreset;

			return ActivePreset;
		}

		public CustomDifficultyModifiers GetModifiers(Player player)
		{
			var presetName = GetPlayerPresetName(player);
			if (!string.IsNullOrEmpty(presetName) && info.Presets.TryGetValue(presetName, out var preset))
				return preset.ResolveFor(player);

			return CustomDifficultyModifiers.Default;
		}

		public IEnumerable<string> GetConditions(Player player)
		{
			var presetName = GetPlayerPresetName(player);
			if (!string.IsNullOrEmpty(presetName) && info.Presets.TryGetValue(presetName, out var preset))
				return preset.ResolveConditions(player);

			return [];
		}

		void RefreshAllPlayerConditions()
		{
			foreach (var p in worldActor.World.Players)
				RefreshPlayerCondition(p);
		}

		static void RefreshPlayerCondition(Player player)
		{
			player?.PlayerActor?.TraitOrDefault<CustomDifficultyPlayerCondition>()?.Refresh(player.PlayerActor);
		}

		void RefreshAllActorConditions()
		{
			foreach (var pair in worldActor.World.ActorsWithTrait<CustomDifficultyActorModifier>())
				pair.Trait.RefreshCondition();
		}

		void RefreshActorConditionsForPlayer(Player player)
		{
			foreach (var pair in worldActor.World.ActorsWithTrait<CustomDifficultyActorModifier>())
				if (pair.Actor.Owner == player)
					pair.Trait.RefreshCondition();
		}
	}

	[TraitLocation(SystemActors.Player)]
	[Desc("Grants PlayerActor conditions configured by CustomDifficultyRules so any BotModule or player trait can react in MiniYAML.")]
	public class CustomDifficultyPlayerConditionInfo : TraitInfo
	{
		public override object Create(ActorInitializer init) { return new CustomDifficultyPlayerCondition(); }
	}

	public class CustomDifficultyPlayerCondition : INotifyCreated
	{
		readonly List<int> activeTokens = [];

		void INotifyCreated.Created(Actor self)
		{
			Refresh(self);
		}

		public void Refresh(Actor self)
		{
			foreach (var token in activeTokens)
				if (self.TokenValid(token))
					self.RevokeCondition(token);

			activeTokens.Clear();

			var rules = self.World.WorldActor.TraitOrDefault<CustomDifficultyRules>();
			if (rules == null)
				return;

			foreach (var condition in rules.GetConditions(self.Owner))
				activeTokens.Add(self.GrantCondition(condition));
		}
	}

	[Desc("Applies active CustomDifficultyRules multipliers to actors and their production entries.")]
	public class CustomDifficultyActorModifierInfo : TraitInfo, IProductionCostModifierInfo, IProductionTimeModifierInfo
	{
		int IProductionCostModifierInfo.GetProductionCostModifier(TechTree techTree, string queue)
		{
			var rules = techTree?.Owner?.World.WorldActor.TraitOrDefault<CustomDifficultyRules>();
			return rules != null ? rules.GetModifiers(techTree.Owner).Cost : 100;
		}

		int IProductionTimeModifierInfo.GetProductionTimeModifier(TechTree techTree, string queue)
		{
			var rules = techTree?.Owner?.World.WorldActor.TraitOrDefault<CustomDifficultyRules>();
			return rules != null ? rules.GetModifiers(techTree.Owner).BuildTime : 100;
		}

		public override object Create(ActorInitializer init) { return new CustomDifficultyActorModifier(init.Self); }
	}

	public class CustomDifficultyActorModifier :
		INotifyCreated,
		INotifyOwnerChanged,
		IFirepowerModifier,
		IDamageModifier,
		ISpeedModifier,
		IReloadModifier,
		IReloadAmmoModifier,
		IInaccuracyModifier,
		IRangeModifier,
		IPowerModifier,
		ICashTricklerModifier,
		IResourceValueModifier,
		IGivesExperienceModifier,
		IGainsExperienceModifier,
		ICreatesShroudModifier,
		IRevealsShroudModifier,
		IDetectCloakedModifier
	{
		readonly Actor self;
		readonly CustomDifficultyRules rules;
		readonly bool isAircraft;
		readonly List<int> actorConditionTokens = [];

		public CustomDifficultyActorModifier(Actor self)
		{
			this.self = self;
			rules = self.World.WorldActor.TraitOrDefault<CustomDifficultyRules>();
			isAircraft = self.Info.HasTraitInfo<AircraftInfo>();
		}

		void INotifyCreated.Created(Actor self)
		{
			RefreshCondition();
		}

		void INotifyOwnerChanged.OnOwnerChanged(Actor self, Player oldOwner, Player newOwner)
		{
			RefreshCondition();
		}

		public void RefreshCondition()
		{
			foreach (var token in actorConditionTokens)
				if (self.TokenValid(token))
					self.RevokeCondition(token);

			actorConditionTokens.Clear();

			if (rules == null)
				return;

			var condition = rules.GetModifiers(self.Owner).ActorCondition;
			foreach (var cond in CustomDifficultyPreset.SplitConditions(condition))
				actorConditionTokens.Add(self.GrantCondition(cond));
		}

		int IFirepowerModifier.GetFirepowerModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).Firepower : 100;
		}

		int IDamageModifier.GetDamageModifier(Actor attacker, Damage damage)
		{
			if (rules == null)
				return 100;

			var armor = Math.Max(1, rules.GetModifiers(self.Owner).Armor);
			return 10000 / armor;
		}

		int ISpeedModifier.GetSpeedModifier()
		{
			if (rules == null)
				return 100;

			var mods = rules.GetModifiers(self.Owner);
			return isAircraft ? mods.Airspeed : mods.Groundspeed;
		}

		int IReloadModifier.GetReloadModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).ROF : 100;
		}

		int IReloadAmmoModifier.GetReloadAmmoModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).ReloadAmmo : 100;
		}

		int IInaccuracyModifier.GetInaccuracyModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).Inaccuracy : 100;
		}

		int IRangeModifier.GetRangeModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).Range : 100;
		}

		int IPowerModifier.GetPowerModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).Power : 100;
		}

		int ICashTricklerModifier.GetCashTricklerModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).CashTrickler : 100;
		}

		int IResourceValueModifier.GetResourceValueModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).ResourceValue : 100;
		}

		int IGivesExperienceModifier.GetGivesExperienceModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).GivesExperience : 100;
		}

		int IGainsExperienceModifier.GetGainsExperienceModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).GainsExperience : 100;
		}

		int ICreatesShroudModifier.GetCreatesShroudModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).CreatesShroud : 100;
		}

		int IRevealsShroudModifier.GetRevealsShroudModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).RevealsShroud : 100;
		}

		int IDetectCloakedModifier.GetDetectCloakedModifier()
		{
			return rules != null ? rules.GetModifiers(self.Owner).DetectCloaked : 100;
		}
	}
}
