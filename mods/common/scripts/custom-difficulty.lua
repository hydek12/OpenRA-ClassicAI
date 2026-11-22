--[[
   Copyright (c) The OpenRA Developers and Contributors
   This file is part of OpenRA, which is free software. It is made
   available to you under the terms of the GNU General Public License
   as published by the Free Software Foundation, either version 3 of
   the License, or (at your option) any later version. For more
   information, see COPYING.
]]

-- Agentic Gemini 4 Hydrogen High
--- Apply a map-selected difficulty preset if the lobby dropdown was left at "default".
---@param prefix? string Optional prefix prepended to the map's "difficulty" option (e.g. "classic-")
---@param fallbackPreset? string
SyncCustomDifficultyWithMapOption = function(prefix, fallbackPreset)
	if not CustomDifficulty.IsEnabled() then
		return
	end

	if CustomDifficulty.GetPreset() == "default" then
		local mapDifficulty = Map.LobbyOptionOrDefault("difficulty", fallbackPreset or "normal")
		local targetPreset = (prefix or "") .. mapDifficulty
		CustomDifficulty.SetPreset(targetPreset)
	end
end
