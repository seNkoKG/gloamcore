-- GloamCore authoritative Path of Building calculation worker.
-- This file runs inside a fresh LuaJIT process for every request.

local RESULT_PREFIX = "GLOAMCORE_POB_RESULT:"
local MAX_SCALAR_STATS = 4096
local MAX_WARNINGS = 32
local MAX_CONFIG_INPUTS = 4096
local MAX_CONFIG_OPTIONS = 2048

local json = require("dkjson")

local function emit(payload)
	local encoded, err = json.encode(payload)
	if not encoded then
		encoded = json.encode({
			ok = false,
			authoritative = false,
			code = "POB_RESULT_ENCODING_FAILED",
			message = tostring(err or "Path of Building result encoding failed."),
		})
	end
	print(RESULT_PREFIX .. encoded)
end

local function fail(code, message, detail)
	emit({
		ok = false,
		authoritative = false,
		code = code,
		message = message,
		detail = detail and tostring(detail):sub(1, 4000) or nil,
	})
end

if type(build) ~= "table" or type(loadBuildFromXML) ~= "function" then
	fail("POB_INITIALIZATION_FAILED", "Path of Building did not finish headless initialization.")
	return
end

local pobRoot = os.getenv("GLOAMCORE_POB_ROOT")
if type(pobRoot) ~= "string" or pobRoot == "" then
	fail("POB_ROOT_MISSING", "The headless worker did not receive a Path of Building root.")
	return
end
pobRoot = pobRoot:gsub("\\", "/"):gsub("/+$", "")

-- The installed application remains read-only. Timeless-jewel decompression may
-- use data in memory, but its normal cache-write attempt is explicitly denied.
local originalOpen = io.open
io.open = function(fileName, mode)
	mode = mode or "r"
	if mode:find("[wa+]") then
		return nil, "GloamCore opens the installed PoB engine read-only"
	end
	return originalOpen(fileName, mode)
end
os.remove = function()
	return nil, "GloamCore opens the installed PoB engine read-only"
end
os.rename = function()
	return nil, "GloamCore opens the installed PoB engine read-only"
end

function GetScriptPath()
	return pobRoot
end
function GetRuntimePath()
	return pobRoot
end
function GetUserPath()
	return pobRoot
end
function GetWorkDir()
	return pobRoot
end
function GetTime()
	return math.floor(os.clock() * 1000)
end

local searchHandle = { }
searchHandle.__index = searchHandle
function searchHandle:GetFileName()
	local item = self.items[self.index]
	return item and item.name or nil
end
function searchHandle:GetFileModifiedTime()
	local item = self.items[self.index]
	return item and item.modified or 0
end
function searchHandle:NextFile()
	self.index = self.index + 1
	return self.items[self.index] ~= nil
end
function searchHandle:Close()
	self.items = { }
	self.index = 1
end

function NewFileSearch(specification, directoriesOnly)
	if type(HostFileSearch) ~= "function" or type(specification) ~= "string" then
		return nil
	end
	-- Generated timeless-jewel .bin files are mutable caches. Never trust or
	-- mutate them: always use the version-gated official zip/part inputs below.
	local normalizedSpecification = specification:gsub("\\", "/")
	if normalizedSpecification:find("/Data/TimelessJewelData/", 1, true)
		and normalizedSpecification:lower():match("%.bin$") then
		return nil
	end
	local records = HostFileSearch(specification, directoriesOnly and true or false)
	if type(records) ~= "string" or records == "" then
		return nil
	end
	local items = { }
	for line in records:gmatch("[^\r\n]+") do
		local modified, name = line:match("^(%-?%d+)%s+(.+)$")
		if modified and name then
			table.insert(items, { modified = tonumber(modified) or 0, name = name })
		end
	end
	if not items[1] then
		return nil
	end
	return setmetatable({ items = items, index = 1 }, searchHandle)
end

local ffi
local zlib
local function getZlib()
	if zlib then
		return ffi, zlib
	end
	local ok
	ok, ffi = pcall(require, "ffi")
	if not ok then
		error("LuaJIT FFI is unavailable; compressed PoB data cannot be loaded.")
	end
	pcall(ffi.cdef, [[
		unsigned long compressBound(unsigned long sourceLen);
		int compress2(unsigned char *dest, unsigned long *destLen,
			const unsigned char *source, unsigned long sourceLen, int level);
		int uncompress(unsigned char *dest, unsigned long *destLen,
			const unsigned char *source, unsigned long sourceLen);
	]])
	zlib = ffi.load(pobRoot .. "/zlib1.dll")
	return ffi, zlib
end

function Inflate(data)
	if type(data) ~= "string" then
		return nil
	end
	local ffiLib, zlibLib = getZlib()
	local maximum = tonumber(os.getenv("GLOAMCORE_POB_MAX_INFLATE_BYTES")) or (256 * 1024 * 1024)
	maximum = math.max(1024 * 1024, math.min(maximum, 512 * 1024 * 1024))
	local size = math.max(1024 * 1024, #data * 3)
	while size <= maximum do
		local output = ffiLib.new("unsigned char[?]", size)
		local outputLength = ffiLib.new("unsigned long[1]", size)
		local status = zlibLib.uncompress(output, outputLength, data, #data)
		if status == 0 then
			return ffiLib.string(output, tonumber(outputLength[0]))
		elseif status ~= -5 then -- Z_BUF_ERROR means the destination must grow.
			error("zlib uncompress failed with status " .. tostring(status))
		end
		size = size * 2
	end
	error("Inflated PoB data exceeds the configured memory limit.")
end

function Deflate(data)
	if type(data) ~= "string" then
		return nil
	end
	local ffiLib, zlibLib = getZlib()
	local capacity = tonumber(zlibLib.compressBound(#data))
	local output = ffiLib.new("unsigned char[?]", capacity)
	local outputLength = ffiLib.new("unsigned long[1]", capacity)
	local status = zlibLib.compress2(output, outputLength, data, #data, 9)
	if status ~= 0 then
		error("zlib compress failed with status " .. tostring(status))
	end
	return ffiLib.string(output, tonumber(outputLength[0]))
end

local warnings = { }
local fatalDataWarning
local originalConPrintf = ConPrintf
function ConPrintf(format, ...)
	local ok, message = pcall(string.format, tostring(format), ...)
	message = ok and message or tostring(format)
	local expectedCompressedFallback = message:find("falling back to compressed file", 1, true) ~= nil
	if not expectedCompressedFallback
		and (message:find("[Ff]ailed") or message:find("[Ww]arning") or message:find("out of date")) then
		if #warnings < MAX_WARNINGS then
			table.insert(warnings, message)
		end
		if message:find("Failed to load either file", 1, true) then
			fatalDataWarning = message
		end
	end
	if originalConPrintf then
		originalConPrintf("%s", message)
	end
end

local requestText = io.read("*a")
local request, _, decodeError = json.decode(requestText or "", 1, nil)
if type(request) ~= "table" then
	fail("POB_REQUEST_INVALID", "The PoB worker request is not valid JSON.", decodeError)
	return
end
local operation = request.operation or "calculate"
if operation == "calculate" or operation == "analyze-nodes" or operation == "preview-timeless" or operation == "hunt-timeless" then
	if type(request.xml) ~= "string" or not request.xml:find("<PathOfBuilding", 1, true) then
		fail("POB_XML_INVALID", "The calculation request has no PathOfBuilding XML root.")
		return
	end
else
	fail("POB_OPERATION_INVALID", "The requested Path of Building operation is not supported.")
	return
end

local startedAt = os.clock()

local function collectSkillGroups()
	local groups = { }
	local socketGroups = build.skillsTab and build.skillsTab.socketGroupList or { }
	for groupIndex, group in ipairs(socketGroups) do
		local activeSkills = { }
		for skillIndex, activeSkill in ipairs(group.displaySkillList or { }) do
			local activeEffect = activeSkill.activeEffect
			local grantedEffect = activeEffect and activeEffect.grantedEffect
			local srcInstance = activeEffect and activeEffect.srcInstance
			local parts = { }
			for _, part in ipairs(grantedEffect and grantedEffect.parts or { }) do
				if type(part.name) == "string" and part.name ~= "" then table.insert(parts, part.name) end
			end
			local sourceGemIndex = 0
			for gemIndex, gem in ipairs(group.gemList or { }) do
				if gem == srcInstance then sourceGemIndex = gemIndex break end
			end
			local selectedPartIndex = math.max(1, math.floor(tonumber(srcInstance and (srcInstance.skillPartCalcs or srcInstance.skillPart)) or 1))
			local selectedPart = grantedEffect and grantedEffect.parts and grantedEffect.parts[selectedPartIndex]
			local stageData
			if (selectedPart and selectedPart.stages)
				or (activeSkill.skillFlags and activeSkill.skillFlags.multiStage and not (grantedEffect and grantedEffect.parts and #grantedEffect.parts > 1)) then
				local stageMin = math.max(1, math.floor(tonumber(selectedPart and selectedPart.stagesMin or activeSkill.skillData and activeSkill.skillData.stagesMin) or 1))
				local stageMax = math.max(stageMin, math.floor(tonumber(activeSkill.skillData and activeSkill.skillData.stagesMax or selectedPart and selectedPart.stagesMax) or stageMin))
				stageData = { min = stageMin, max = stageMax }
			end
			local minions = { }
			if grantedEffect and grantedEffect.minionHasItemSet then
				for _, itemSetId in ipairs(build.itemsTab and build.itemsTab.itemSetOrderList or { }) do
					local itemSet = build.itemsTab.itemSets[itemSetId]
					table.insert(minions, { label = tostring(itemSet and itemSet.title or "Default Item Set"), itemSetId = itemSetId })
				end
			else
				for _, minionId in ipairs(activeSkill.minionList or { }) do
					local minion = data.minions and data.minions[minionId]
					table.insert(minions, { label = tostring(minion and minion.name or minionId), minionId = tostring(minionId) })
				end
			end
			local minionSkills = { }
			for _, minionSkill in ipairs(activeSkill.minion and activeSkill.minion.activeSkillList or { }) do
				local minionEffect = minionSkill.activeEffect and minionSkill.activeEffect.grantedEffect
				if minionEffect and minionEffect.name then table.insert(minionSkills, tostring(minionEffect.name)) end
			end
			table.insert(activeSkills, {
				index = skillIndex,
				name = tostring(grantedEffect and grantedEffect.name or group.displayLabel or group.label or ("Skill " .. skillIndex)),
				parts = parts,
				sourceGemIndex = sourceGemIndex,
				stages = stageData,
				mine = activeSkill.skillFlags and activeSkill.skillFlags.mine or false,
				minions = minions,
				minionSkills = minionSkills,
			})
		end
		table.insert(groups, {
			index = groupIndex,
			label = tostring(group.displayLabel or group.label or ("Socket group " .. groupIndex)),
			mainActiveSkill = math.max(1, math.floor(tonumber(group.mainActiveSkill) or 1)),
			activeSkills = activeSkills,
		})
	end
	return groups
end

local function collectItems()
	local items = { }
	local itemsTab = build.itemsTab
	for _, itemId in ipairs(itemsTab and itemsTab.itemOrderList or { }) do
		local item = itemsTab.items and itemsTab.items[itemId]
		if item then
			local raw = item:BuildRaw()
			table.insert(items, {
				id = tonumber(item.id) or tonumber(itemId),
				raw = tostring(raw or item.raw or ""),
				primarySlot = type(item.GetPrimarySlot) == "function" and tostring(item:GetPrimarySlot() or "") or "",
			})
		end
	end
	return items
end

local function collectGemCatalog()
	local catalog = { }
	local seen = { }
	for _, gem in pairs(data and data.gems or { }) do
		local name = tostring(gem.nameSpec or gem.name or "")
		local skillId = tostring(gem.grantedEffectId or gem.grantedEffect and gem.grantedEffect.id or "")
		local gemId = tostring(gem.gameId or gem.id or "")
		local variantId = tostring(gem.variantId or "")
		local key = table.concat({ name, skillId, gemId, variantId }, "\0")
		if name ~= "" and skillId ~= "" and not seen[key] then
			seen[key] = true
			table.insert(catalog, {
				name = name,
				skillId = skillId,
				gemId = gemId,
				variantId = variantId,
				naturalMaxLevel = math.max(1, math.floor(tonumber(gem.naturalMaxLevel) or 20)),
				support = gem.grantedEffect and gem.grantedEffect.support == true or false,
			})
		end
	end
	table.sort(catalog, function(left, right)
		if left.name == right.name then return left.variantId < right.variantId end
		return left.name < right.name
	end)
	return catalog
end

local function plainControlText(value)
	if type(value) == "function" then
		local ok, resolved = pcall(value)
		if not ok then return "" end
		value = resolved
	end
	local text = tostring(value or "")
	if type(StripEscapes) == "function" then
		local ok, stripped = pcall(StripEscapes, text)
		if ok and type(stripped) == "string" then text = stripped end
	end
	return text:gsub("^%s+", ""):gsub("%s+$", ""):sub(1, 1000)
end

local function configControlLabel(configTab, control, name)
	if control._className == "CheckBoxControl" then
		local label = plainControlText(control.label)
		if label ~= "" then return label end
	end
	for _, candidate in pairs(configTab.controls or { }) do
		if type(candidate) == "table"
			and candidate._className == "LabelControl"
			and candidate.anchor
			and candidate.anchor.other == control then
			local label = plainControlText(candidate.label)
			if label ~= "" then return label end
		end
	end
	return tostring(name)
end

local function configControlEligible(control)
	if type(control.IsShown) == "function" then
		local ok, shown = pcall(control.IsShown, control)
		if ok then return shown ~= false end
	end
	if type(control.shown) == "function" then
		local ok, shown = pcall(control.shown)
		if ok then return shown ~= false end
	elseif control.shown ~= nil then
		return control.shown ~= false
	end
	return true
end

local function collectConfigCatalog()
	local configTab = build.configTab
	if type(configTab) ~= "table" then return { } end
	local catalog = { }
	for name, control in pairs(configTab.varControls or { }) do
		if type(name) == "string" and name ~= "" and type(control) == "table" and #catalog < MAX_CONFIG_INPUTS then
			local defaultValue = configTab.defaultState and configTab.defaultState[name]
			local controlType = control._className
			local inputType
			if controlType == "CheckBoxControl" then
				inputType = "boolean"
			elseif controlType == "DropDownControl" then
				inputType = "list"
			elseif type(defaultValue) == "number" then
				inputType = "number"
			else
				inputType = "string"
			end
			if defaultValue == nil then
				defaultValue = inputType == "boolean" and false or inputType == "number" and 0 or ""
			end
			local options = { }
			if inputType == "list" then
				for _, option in ipairs(control.list or { }) do
					if #options >= MAX_CONFIG_OPTIONS then break end
					local value = type(option) == "table" and option.val or option
					local valueType = type(value)
					if valueType == "string" or valueType == "number" or valueType == "boolean" then
						table.insert(options, {
							label = plainControlText(type(option) == "table" and (option.label or option[1] or option.val) or option),
							value = value,
						})
					end
				end
			end
			table.insert(catalog, {
				name = name,
				label = configControlLabel(configTab, control, name),
				type = inputType,
				defaultValue = defaultValue,
				eligible = configControlEligible(control),
				options = options,
			})
		end
	end
	table.sort(catalog, function(left, right)
		if left.label == right.label then return left.name < right.name end
		return left.label < right.label
	end)
	return catalog
end

local function collectCalculationOutput()
	local output = build.calcsTab and build.calcsTab.mainOutput
	if type(output) ~= "table" then error("Path of Building produced no main calculation output.") end
	local stats = { }
	local scalarCount = 0
	for key, value in pairs(output) do
		if type(key) == "string" and scalarCount < MAX_SCALAR_STATS then
			local valueType = type(value)
			if valueType == "number" then
				if value == value and value ~= math.huge and value ~= -math.huge then
					stats[key] = value
					scalarCount = scalarCount + 1
				end
			elseif valueType == "string" or valueType == "boolean" then
				stats[key] = value
				scalarCount = scalarCount + 1
			end
		end
	end
	-- PoB intentionally combines player and minion output for its comparison and
	-- sidebar damage stats. Preserve that exact behavior instead of leaking the
	-- raw mainOutput fallback used by older GloamCore releases.
	local combinedDamageStats = {
		FullDPS = true, CombinedDPS = true, TotalDPS = true, WithImpaleDPS = true,
		AverageDamage = true, TotalDot = true, TotalDotDPS = true, BleedDPS = true,
		IgniteDPS = true, PoisonDPS = true,
	}
	if data and data.powerStatList and type(data.powerStatList.GetFromOutput) == "function" then
		for _, statEntry in ipairs(data.powerStatList) do
			if statEntry.stat and combinedDamageStats[statEntry.stat] then
				local value = data.powerStatList.GetFromOutput(output, statEntry)
				if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
					if stats[statEntry.stat] == nil then scalarCount = scalarCount + 1 end
					stats[statEntry.stat] = value
				end
			end
		end
	end
	local skillGroups = collectSkillGroups()
	local items = collectItems()
	local gemCatalog = collectGemCatalog()
	local configCatalog = collectConfigCatalog()
	local mainGroup = skillGroups[build.mainSocketGroup]
	local mainActiveSkill = mainGroup and mainGroup.activeSkills[mainGroup.mainActiveSkill]
	return {
		outputRevision = build.outputRevision,
		targetVersion = build.targetVersion,
		className = build.spec and build.spec.curClassName or nil,
		ascendancyName = build.spec and build.spec.curAscendClassName or nil,
		mainSocketGroup = build.mainSocketGroup,
		mainSkillName = mainActiveSkill and mainActiveSkill.name or (mainGroup and mainGroup.label or nil),
		skillGroups = skillGroups,
		items = items,
		gemCatalog = gemCatalog,
		configCatalog = configCatalog,
		scalarCount = scalarCount,
		stats = stats,
	}
end

local ok, result = xpcall(function()
	loadBuildFromXML(request.xml, request.name or "GloamCore calculation")
	-- Required even in a fresh process: it preserves the same safe ordering if
	-- PoB initialization populated a globally keyed trigger cache.
	wipeGlobalCache()
	build.calcsTab:BuildOutput()

	if fatalDataWarning then
		error(fatalDataWarning)
	end

	if operation == "hunt-timeless" then
		local jewelType = math.max(1, math.min(6, math.floor(tonumber(request.jewelType) or 1)))
		local treeData = build.spec and build.spec.tree
		local selectedSockets = { }
		local selectedSocketIds = { }
		local seenSocketIds = { }
		local function addSocket(rawId)
			local id = tonumber(rawId)
			local socket = id and treeData and treeData.nodes and treeData.nodes[id]
			if id and not seenSocketIds[id] and socket and socket.isJewelSocket and socket.nodesInRadius and socket.nodesInRadius[3] then
				seenSocketIds[id] = true
				table.insert(selectedSockets, socket)
				table.insert(selectedSocketIds, id)
			end
		end
		if type(request.socketIds) == "table" then
			for index, id in ipairs(request.socketIds) do if index <= 64 then addSocket(id) end end
		end
		if #selectedSockets == 0 then addSocket(request.socketId) end
		if #selectedSockets == 0 then error("No selected passive is a large-radius jewel socket in this PoB tree.") end
		local socketId = #selectedSockets == 1 and selectedSocketIds[1] or 0
		local legionNodes = treeData.legion.nodes
		local legionAdditions = treeData.legion.additions
		local typePrefixes = { "vaal", "karui", "maraketh", "templar", "eternal", "kalguur" }
		local typePrefix = typePrefixes[jewelType]
		local catalogById = { }
		local catalog = { }
		local function addCatalog(entry, kind)
			if not entry or type(entry.id) ~= "string" or not entry.id:match("^" .. typePrefix .. "_.+") or entry.id:find("_keystone_", 1, true) or catalogById[entry.id] then return end
			local value = { id = entry.id, name = tostring(entry.dn or entry.id), stats = entry.sd or { }, kind = kind }
			catalogById[entry.id] = value
			table.insert(catalog, value)
		end
		for _, entry in ipairs(legionNodes) do addCatalog(entry, "replacement") end
		for _, entry in ipairs(legionAdditions) do addCatalog(entry, "augmentation") end
		table.sort(catalog, function(left, right) if left.name == right.name then return left.id < right.id end return left.name < right.name end)

		local requestedTargets = type(request.targets) == "table" and request.targets or { }
		local targets = { }
		for _, target in ipairs(requestedTargets) do
			if type(target) == "table" and catalogById[target.id] then
				targets[target.id] = {
					weight = math.max(-1000, math.min(1000, tonumber(target.weight) or 1)),
					weight2 = math.max(-1000, math.min(1000, tonumber(target.weight2) or 0)),
					minimum = math.max(0, math.min(100000, tonumber(target.minimum) or 0)),
				}
			end
		end
		local seedMultiplier = jewelType == 5 and 20 or 1
		local minimumSeed = data.timelessJewelSeedMin[jewelType] * seedMultiplier
		local maximumSeed = data.timelessJewelSeedMax[jewelType] * seedMultiplier
		if not next(targets) then
			return {
				ok = true, authoritative = true, operation = operation,
				engineVersion = launch and launch.versionNumber or nil, engineBranch = launch and launch.versionBranch or nil, enginePlatform = launch and launch.versionPlatform or nil,
				jewelType = jewelType, jewelName = data.timelessJewelTypes[jewelType], minimumSeed = minimumSeed, maximumSeed = maximumSeed, seedStep = seedMultiplier,
				socketId = socketId, socketIds = selectedSocketIds, socketCount = #selectedSockets, catalog = catalog, searchedSeeds = 0, candidateNodes = 0, results = { }, warnings = warnings,
				calculationMilliseconds = math.floor((os.clock() - startedAt) * 1000), readOnly = true, freshProcess = true,
			}
		end

		local scope = request.scope == "allocated" and "allocated" or request.scope == "reachable" and "reachable" or "radius"
		local maxPoints = math.max(0, math.min(30, math.floor(tonumber(request.maxPoints) or 5)))
		local maximumResults = math.max(1, math.min(250, math.floor(tonumber(request.maxResults) or 50)))
		local results = { }
		local function addResult(result)
			local inserted = false
			for index, current in ipairs(results) do
				if result.score > current.score or (result.score == current.score and (result.seed < current.seed or (result.seed == current.seed and result.socketId < current.socketId))) then table.insert(results, index, result); inserted = true; break end
			end
			if not inserted then table.insert(results, result) end
			if #results > maximumResults then table.remove(results) end
		end
		local searchedSeeds = 0
		local candidateNodeCount = 0
		for socketIndex, socket in ipairs(selectedSockets) do
			local candidateNodes = { }
			for nodeId in pairs(socket.nodesInRadius[3]) do
				local node = treeData.nodes[nodeId]
				local eligibleType = node and (node.type == "Notable" or (jewelType == 1 and node.type == "Normal"))
				local inScope = scope == "radius"
					or (scope == "allocated" and build.spec.allocNodes[nodeId])
					or (scope == "reachable" and (build.spec.allocNodes[nodeId] or (tonumber(node.pathDist) or 1000) <= maxPoints))
				if eligibleType and inScope then table.insert(candidateNodes, node) end
			end
			candidateNodeCount = candidateNodeCount + #candidateNodes
			for seed = minimumSeed, maximumSeed, seedMultiplier do
				searchedSeeds = searchedSeeds + 1
				local score = 0
				local hitsById = { }
				for _, node in ipairs(candidateNodes) do
				local jewelData = data.readLUT(seed, node.id, jewelType)
				if jewelType == 1 then
					local headerSize = #jewelData
					if headerSize == 2 or headerSize == 3 then
						local replacement = legionNodes[jewelData[1] + 1 - data.timelessJewelAdditions]
						local target = replacement and targets[replacement.id]
						if target then
							local statMod1 = replacement.stats and replacement.sortedStats and replacement.stats[replacement.sortedStats[1]]
							local statMod2 = replacement.stats and replacement.sortedStats and replacement.stats[replacement.sortedStats[2]]
							local primary = tonumber(jewelData[(statMod1 and statMod1.index or 1) + 1]) or 0
							local secondary = statMod2 and (tonumber(jewelData[(statMod2.index or 2) + 1]) or 0) or 0
							local roll = primary + secondary
							local contribution = target.weight * primary + target.weight2 * secondary
							score = score + contribution
							local hit = hitsById[replacement.id] or { id = replacement.id, name = replacement.dn, count = 0, value = 0, weightedValue = 0, nodes = { } }
							hit.count = hit.count + 1; hit.value = hit.value + roll; hit.weightedValue = hit.weightedValue + contribution; table.insert(hit.nodes, { id = tonumber(node.id), name = node.dn }); hitsById[replacement.id] = hit
						end
					elseif headerSize == 6 or headerSize == 8 then
						for index = 1, headerSize / 2 do
							local addition = legionAdditions[jewelData[index] + 1]
							local target = addition and targets[addition.id]
							if target then
								local roll = tonumber(jewelData[index + headerSize / 2]) or 0
								local contribution = target.weight * roll
								score = score + contribution
								local hit = hitsById[addition.id] or { id = addition.id, name = addition.dn, count = 0, value = 0, weightedValue = 0, nodes = { } }
								hit.count = hit.count + 1; hit.value = hit.value + roll; hit.weightedValue = hit.weightedValue + contribution; table.insert(hit.nodes, { id = tonumber(node.id), name = node.dn }); hitsById[addition.id] = hit
							end
						end
					end
				elseif jewelData[1] then
					local entry = jewelData[1] >= data.timelessJewelAdditions and legionNodes[jewelData[1] + 1 - data.timelessJewelAdditions] or legionAdditions[jewelData[1] + 1]
					local target = entry and targets[entry.id]
					if target then
						score = score + target.weight
						local hit = hitsById[entry.id] or { id = entry.id, name = entry.dn, count = 0, value = 0, weightedValue = 0, nodes = { } }
						hit.count = hit.count + 1; hit.value = hit.value + 1; hit.weightedValue = hit.weightedValue + target.weight; table.insert(hit.nodes, { id = tonumber(node.id), name = node.dn }); hitsById[entry.id] = hit
					end
				end
				end
				if score > 0 then
					local passes = true
					local hits = { }
					for targetId, target in pairs(targets) do
						local hit = hitsById[targetId]
						if target.minimum > 0 and (not hit or hit.weightedValue < target.minimum) then passes = false; break end
					end
					if passes then
						for _, hit in pairs(hitsById) do table.insert(hits, hit) end
						table.sort(hits, function(left, right) if left.weightedValue == right.weightedValue then return left.name < right.name end return left.weightedValue > right.weightedValue end)
						addResult({ seed = seed, socketId = selectedSocketIds[socketIndex], score = score, hits = hits })
					end
				end
			end
		end
		return {
			ok = true, authoritative = true, operation = operation,
			engineVersion = launch and launch.versionNumber or nil, engineBranch = launch and launch.versionBranch or nil, enginePlatform = launch and launch.versionPlatform or nil,
			jewelType = jewelType, jewelName = data.timelessJewelTypes[jewelType], minimumSeed = minimumSeed, maximumSeed = maximumSeed, seedStep = seedMultiplier,
			socketId = socketId, socketIds = selectedSocketIds, socketCount = #selectedSockets, catalog = catalog, searchedSeeds = searchedSeeds, candidateNodes = candidateNodeCount, results = results, scope = scope, maxPoints = maxPoints,
			warnings = warnings, calculationMilliseconds = math.floor((os.clock() - startedAt) * 1000), readOnly = true, freshProcess = true,
		}
	end

	if operation == "preview-timeless" then
		local jewelType = math.max(1, math.min(6, math.floor(tonumber(request.jewelType) or 1)))
		local socketId = tonumber(request.socketId)
		local requestedSeed = math.floor(tonumber(request.seed) or 0)
		local conquerorId = math.max(1, math.min(3, math.floor(tonumber(request.conquerorId) or 1)))
		local conquerorTypes = { "vaal", "karui", "maraketh", "templar", "eternal", "kalguur" }
		local conquerorType = conquerorTypes[jewelType]
		local treeData = build.spec and build.spec.tree
		local socket = treeData and treeData.nodes and treeData.nodes[socketId]
		if not socket or not socket.isJewelSocket or not socket.nodesInRadius or not socket.nodesInRadius[3] then
			error("The selected passive is not a large-radius jewel socket in this PoB tree.")
		end
		local seedMultiplier = jewelType == 5 and 20 or 1
		local minimumSeed = data.timelessJewelSeedMin[jewelType] * seedMultiplier
		local maximumSeed = data.timelessJewelSeedMax[jewelType] * seedMultiplier
		if requestedSeed < minimumSeed or requestedSeed > maximumSeed or requestedSeed % seedMultiplier ~= 0 then
			error("Seed " .. tostring(requestedSeed) .. " is outside the official range [" .. minimumSeed .. " - " .. maximumSeed .. "] or has an invalid step.")
		end

		local legionNodes = treeData.legion.nodes
		local legionAdditions = treeData.legion.additions
		local function rolledStat(statText, statKey, statMod, value)
			if not statMod or value == nil then return statText end
			if statMod.fmt == "g" then
				if statKey:find("per_minute") then value = round(value / 60, 1)
				elseif statKey:find("permyriad") then value = value / 100
				elseif statKey:find("_ms") then value = value / 1000 end
			end
			if statMod.min ~= statMod.max then
				return statText:gsub("%(" .. statMod.min .. "%-" .. statMod.max .. "%)", value)
			elseif statMod.min ~= value then
				return statText:gsub(statMod.min, value)
			end
			return statText
		end
		local function nodeView(sourceNode, transformedName, stats)
			return {
				id = tonumber(sourceNode.id),
				name = tostring(sourceNode.dn or sourceNode.name or ""),
				type = tostring(sourceNode.type or "Normal"),
				transformedName = tostring(transformedName or sourceNode.dn or sourceNode.name or ""),
				stats = stats or { },
				allocated = build.spec.allocNodes[sourceNode.id] and true or false,
			}
		end
		local affected = { }
		for nodeId in pairs(socket.nodesInRadius[3]) do
			local node = treeData.nodes[nodeId]
			if node and not node.isJewelSocket and node.type ~= "Mastery" and not node.classStartIndex then
				local transformedName
				local transformedStats = { }
				if node.type == "Notable" then
					local jewelData = data.readLUT(requestedSeed, node.id, jewelType)
					if jewelType == 1 and #jewelData > 0 then
						local headerSize = #jewelData
						if headerSize == 2 or headerSize == 3 then
							local replacement = legionNodes[jewelData[1] + 1 - data.timelessJewelAdditions]
							if replacement then
								transformedName = replacement.dn
								for index, statText in ipairs(replacement.sd or { }) do
									local statKey = replacement.sortedStats[index]
									local statMod = replacement.stats[statKey]
									table.insert(transformedStats, rolledStat(statText, statKey, statMod, jewelData[(statMod and statMod.index or index) + 1]))
								end
							end
						elseif headerSize == 6 or headerSize == 8 then
							local bias = 0
							for index = 1, headerSize / 2 do bias = bias + (jewelData[index] <= 21 and 1 or -1) end
							local replacement = legionNodes[bias >= 0 and 77 or 78]
							transformedName = replacement and replacement.dn or "Vaal notable"
							local additions = { }
							for index = 1, headerSize / 2 do additions[jewelData[index]] = (additions[jewelData[index]] or 0) + jewelData[index + headerSize / 2] end
							for additionId, value in pairs(additions) do
								local addition = legionAdditions[additionId + 1]
								for _, statText in ipairs(addition and addition.sd or { }) do
									for statKey, statMod in pairs(addition.stats or { }) do statText = rolledStat(statText, statKey, statMod, value) end
									table.insert(transformedStats, statText)
								end
							end
						end
					elseif jewelData[1] then
						if jewelData[1] >= data.timelessJewelAdditions then
							local replacement = legionNodes[jewelData[1] + 1 - data.timelessJewelAdditions]
							transformedName = replacement and replacement.dn or "Transformed notable"
							transformedStats = replacement and replacement.sd or { }
						else
							local addition = legionAdditions[jewelData[1] + 1]
							transformedName = node.dn
							transformedStats = addition and addition.sd or { }
						end
					end
				elseif node.type == "Keystone" then
					local matchId = conquerorType .. "_keystone_" .. conquerorId
					for _, replacement in ipairs(legionNodes) do
						if replacement.id == matchId then transformedName = replacement.dn; transformedStats = replacement.sd or { }; break end
					end
				elseif node.type == "Normal" then
					local attributes = node.dn == "Strength" or node.dn == "Dexterity" or node.dn == "Intelligence" or node.isTattoo
					if jewelType == 1 then
						local jewelData = data.readLUT(requestedSeed, node.id, jewelType)
						local replacement = jewelData[1] and legionNodes[jewelData[1] + 1 - data.timelessJewelAdditions]
						if replacement then transformedName = replacement.dn; transformedStats = replacement.sd or { } end
					elseif jewelType == 2 then transformedName = node.dn; transformedStats = { "+" .. (attributes and "2" or "4") .. " to Strength" }
					elseif jewelType == 3 then transformedName = node.dn; transformedStats = { "+" .. (attributes and "2" or "4") .. " to Dexterity" }
					elseif jewelType == 4 then
						if attributes then local replacement = legionNodes[91]; transformedName = replacement.dn; transformedStats = replacement.sd or { } else transformedName = node.dn; transformedStats = { "+5 to Devotion" } end
					elseif jewelType == 5 then local replacement = legionNodes[110]; transformedName = replacement.dn; transformedStats = replacement.sd or { }
					elseif jewelType == 6 then transformedName = node.dn; transformedStats = { (attributes and "1" or "2") .. "% increased Ward" } end
				end
				if transformedName then table.insert(affected, nodeView(node, transformedName, transformedStats)) end
			end
		end
		table.sort(affected, function(left, right)
			if left.allocated ~= right.allocated then return left.allocated end
			if left.type ~= right.type then return left.type < right.type end
			return left.name < right.name
		end)
		return {
			ok = true, authoritative = true, operation = operation,
			engineVersion = launch and launch.versionNumber or nil,
			engineBranch = launch and launch.versionBranch or nil,
			enginePlatform = launch and launch.versionPlatform or nil,
			jewelType = jewelType, jewelName = data.timelessJewelTypes[jewelType], seed = requestedSeed,
			minimumSeed = minimumSeed, maximumSeed = maximumSeed, seedStep = seedMultiplier,
			socketId = socketId, affectedNodes = affected, warnings = warnings,
			calculationMilliseconds = math.floor((os.clock() - startedAt) * 1000),
			readOnly = true, freshProcess = true,
		}
	end

	if operation == "analyze-nodes" then
		local requestedDepth = tonumber(request.maxPoints) or 5
		requestedDepth = math.max(1, math.min(30, math.floor(requestedDepth)))
		build.calcsTab.powerStat = nil
		build.calcsTab.nodePowerMaxDepth = requestedDepth
		build.calcsTab:PowerBuilder()

		local nodePowers = { }
		for nodeId, node in pairs(build.spec.nodes or { }) do
			local power = node.power
			if type(power) == "table" and type(power.distance) == "number" and power.distance <= requestedDepth then
				local offence = tonumber(power.offence) or 0
				local defence = tonumber(power.defence) or 0
				local singleStat = tonumber(power.singleStat) or offence
				local pathPower = tonumber(power.pathPower)
				if offence == offence and offence ~= math.huge and offence ~= -math.huge
					and defence == defence and defence ~= math.huge and defence ~= -math.huge
					and singleStat == singleStat and singleStat ~= math.huge and singleStat ~= -math.huge
					and (not pathPower or (pathPower == pathPower and pathPower ~= math.huge and pathPower ~= -math.huge)) then
					table.insert(nodePowers, {
						id = tonumber(nodeId) or tonumber(node.id),
						name = tostring(node.name or ""),
						type = tostring(node.type or "Normal"),
						distance = power.distance,
						allocated = node.alloc and true or false,
						offence = offence,
						defence = defence,
						singleStat = singleStat,
						pathPower = pathPower,
					})
				end
			end
		end
		table.sort(nodePowers, function(left, right)
			local leftScore = math.abs(left.offence) + math.abs(left.defence)
			local rightScore = math.abs(right.offence) + math.abs(right.defence)
			if leftScore == rightScore then
				return (left.id or 0) < (right.id or 0)
			end
			return leftScore > rightScore
		end)

		return {
			ok = true,
			authoritative = true,
			operation = operation,
			engineVersion = launch and launch.versionNumber or nil,
			engineBranch = launch and launch.versionBranch or nil,
			enginePlatform = launch and launch.versionPlatform or nil,
			maxPoints = requestedDepth,
			nodePowers = nodePowers,
			powerMax = build.calcsTab.powerMax or { },
			warnings = warnings,
			calculationMilliseconds = math.floor((os.clock() - startedAt) * 1000),
			readOnly = true,
			freshProcess = true,
		}
	end
	local calculation = collectCalculationOutput()

	return {
		ok = true,
		authoritative = true,
		engineVersion = launch and launch.versionNumber or nil,
		engineBranch = launch and launch.versionBranch or nil,
		enginePlatform = launch and launch.versionPlatform or nil,
		outputRevision = calculation.outputRevision,
		targetVersion = calculation.targetVersion,
		className = calculation.className,
		ascendancyName = calculation.ascendancyName,
		mainSocketGroup = calculation.mainSocketGroup,
		mainSkillName = calculation.mainSkillName,
		skillGroups = calculation.skillGroups,
		items = calculation.items,
		gemCatalog = calculation.gemCatalog,
		configCatalog = calculation.configCatalog,
		scalarCount = calculation.scalarCount,
		stats = calculation.stats,
		warnings = warnings,
		calculationMilliseconds = math.floor((os.clock() - startedAt) * 1000),
		readOnly = true,
		freshProcess = true,
	}
end, debug.traceback)

if not ok then
	if operation == "analyze-nodes" then
		fail("POB_NODE_ANALYSIS_FAILED", "Path of Building could not analyze passive power for this build.", result)
	elseif operation == "preview-timeless" then
		fail("POB_TIMELESS_PREVIEW_FAILED", "Path of Building could not preview this Timeless Jewel seed.", result)
	elseif operation == "hunt-timeless" then
		fail("POB_TIMELESS_HUNT_FAILED", "Path of Building could not rank Timeless Jewel seeds for this socket.", result)
	else
		fail("POB_CALCULATION_FAILED", "Path of Building could not calculate this build.", result)
	end
	return
end
emit(result)
