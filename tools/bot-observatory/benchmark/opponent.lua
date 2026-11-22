Tick = function()
	local tick = DateTime.GameTime
	local wave = waves[tick]
	if not wave then
		return
	end

	local opponent = Player.GetPlayer("Multi1")
	for i, unitType in ipairs(wave) do
		local unit = Actor.Create(unitType, true, {
			Owner = opponent,
			Location = CPos.New(40, 20 + 2 * i)
		})
		unit.AttackMove(CPos.New(13, 24))
	end
	print("Observatory scheduled wave at tick " .. tick)
end
