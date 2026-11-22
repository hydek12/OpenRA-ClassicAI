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
using System.Linq;
using NUnit.Framework;
using OpenRA.Mods.Common.Traits;

namespace OpenRA.Test
{
	[TestFixture]
	sealed class CustomDifficultyRulesTest
	{
		[Test]
		public void DefaultModifiersReturnNeutralValues()
		{
			var mods = CustomDifficultyModifiers.Default;
			Assert.That(mods.Firepower, Is.EqualTo(100));
			Assert.That(mods.Armor, Is.EqualTo(100));
			Assert.That(mods.Groundspeed, Is.EqualTo(100));
			Assert.That(mods.Airspeed, Is.EqualTo(100));
			Assert.That(mods.ROF, Is.EqualTo(100));
			Assert.That(mods.Cost, Is.EqualTo(100));
			Assert.That(mods.BuildTime, Is.EqualTo(100));
			Assert.That(mods.BotTickInterval, Is.EqualTo(1));
			Assert.That(mods.BotOrderQuotient, Is.EqualTo(0));
			Assert.That(mods.GetByKey("UnknownKey"), Is.EqualTo(100));
		}

		[Test]
		public void ParsesPresetWithHumanBotAndBotTypesOverrides()
		{
			var yaml = MiniYaml.FromString(@"
Label: Custom AI Test
BotCondition: ai-test-cond
Human:
	Firepower: 115
	ActorCondition: human-buff
Bot:
	BotTickInterval: 2
	BotOrderQuotient: 8
	Cost: 90
BotTypes:
	rush:
		BotTickInterval: 1
		BotOrderQuotient: 1
		Groundspeed: 120
Players:
	USSR:
		Armor: 130
", "test.yaml");

			var preset = new CustomDifficultyPreset(new MiniYaml(null, yaml));
			Assert.That(preset.Label, Is.EqualTo("Custom AI Test"));
			Assert.That(preset.BotCondition, Is.EqualTo("ai-test-cond"));
			Assert.That(preset.Human.Firepower, Is.EqualTo(115));
			Assert.That(preset.Human.ActorCondition, Is.EqualTo("human-buff"));
			Assert.That(preset.Bot.BotTickInterval, Is.EqualTo(2));
			Assert.That(preset.Bot.BotOrderQuotient, Is.EqualTo(8));
			Assert.That(preset.Bot.Cost, Is.EqualTo(90));
			Assert.That(preset.BotTypes["rush"].BotTickInterval, Is.EqualTo(1));
			Assert.That(preset.BotTypes["rush"].Groundspeed, Is.EqualTo(120));
			Assert.That(preset.Players["USSR"].Armor, Is.EqualTo(130));
		}

		[Test]
		public void LoadsPresetsIntoCustomDifficultyRulesInfo()
		{
			var yaml = MiniYaml.FromString(@"
DefaultPreset: off
Presets:
	off:
		Label: Off
	brutal:
		Label: Brutal
		Bot:
			Firepower: 125
			BotTickInterval: 1
", "rules.yaml");

			var info = FieldLoader.Load<CustomDifficultyRulesInfo>(new MiniYaml(null, yaml));
			Assert.That(info.DefaultPreset, Is.EqualTo("off"));
			Assert.That(info.Presets.ContainsKey("off"), Is.True);
			Assert.That(info.Presets.ContainsKey("brutal"), Is.True);
			Assert.That(info.Presets["brutal"].Bot.Firepower, Is.EqualTo(125));
		}

		[Test]
		public void SplitsCommaSeparatedConditions()
		{
			var parsed = CustomDifficultyPreset.SplitConditions(" classic-ai-override, , classic-hard-ai ").ToArray();
			Assert.That(parsed, Is.EqualTo(new[] { "classic-ai-override", "classic-hard-ai" }));
			Assert.That(CustomDifficultyPreset.SplitConditions(null).ToArray(), Is.Empty);
			Assert.That(CustomDifficultyPreset.SplitConditions("   ").ToArray(), Is.Empty);
		}
	}
}
