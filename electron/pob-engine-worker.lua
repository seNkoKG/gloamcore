-- GloamCore authoritative Path of Building calculation worker.
-- This file runs inside a fresh LuaJIT process for every request.

local RESULT_PREFIX = "GLOAMCORE_POB_RESULT:"
local MAX_SCALAR_STATS = 4096
local MAX_WARNINGS = 32
local MAX_CHARACTER_BYTES = 8 * 1024 * 1024
local MAX_IMPORTED_XML_BYTES = 8 * 1024 * 1024

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
if operation == "calculate" then
	if type(request.xml) ~= "string" or not request.xml:find("<PathOfBuilding", 1, true) then
		fail("POB_XML_INVALID", "The calculation request has no PathOfBuilding XML root.")
		return
	end
elseif operation == "import-character" then
	if type(loadBuildFromJSON) ~= "function" then
		fail("POB_CHARACTER_IMPORT_UNAVAILABLE", "This verified Path of Building engine has no JSON character importer.")
		return
	end
	if type(request.characterJson) ~= "string" or #request.characterJson == 0 or #request.characterJson > MAX_CHARACTER_BYTES then
		fail("POB_CHARACTER_INVALID", "The character import JSON is empty or exceeds the safety limit.")
		return
	end
else
	fail("POB_OPERATION_INVALID", "The requested Path of Building operation is not supported.")
	return
end

local startedAt = os.clock()
local ok, result = xpcall(function()
	if operation == "import-character" then
		-- Use PoB's own ImportTab implementation. This is the authoritative path for
		-- slot names, jewel ordinals, item properties, linked sockets, transfigured
		-- gems, Abyss jewels and main-skill selection; none of those are inferred by
		-- GloamCore.
		loadBuildFromJSON(request.characterJson)
		-- ImportTab marks the build dirty but does not synchronously refresh the
		-- PlayerStat snapshot that SaveDB embeds. Rebuild it now so the editable UI
		-- never labels pre-import values as current PoB output.
		wipeGlobalCache()
		build.calcsTab:BuildOutput()
		if fatalDataWarning then
			error(fatalDataWarning)
		end
		local importedXml = build:SaveDB("code")
		if type(importedXml) ~= "string"
			or #importedXml == 0
			or #importedXml > MAX_IMPORTED_XML_BYTES
			or not importedXml:find("<PathOfBuilding", 1, true) then
			error("Path of Building produced invalid or oversized imported XML.")
		end
		return {
			ok = true,
			authoritative = true,
			operation = operation,
			engineVersion = launch and launch.versionNumber or nil,
			engineBranch = launch and launch.versionBranch or nil,
			enginePlatform = launch and launch.versionPlatform or nil,
			importedXml = importedXml,
			warnings = warnings,
			importMilliseconds = math.floor((os.clock() - startedAt) * 1000),
			readOnly = true,
			freshProcess = true,
		}
	end

	loadBuildFromXML(request.xml, request.name or "GloamCore calculation")
	-- Required even in a fresh process: it preserves the same safe ordering if
	-- PoB initialization populated a globally keyed trigger cache.
	wipeGlobalCache()
	build.calcsTab:BuildOutput()

	if fatalDataWarning then
		error(fatalDataWarning)
	end
	local output = build.calcsTab and build.calcsTab.mainOutput
	if type(output) ~= "table" then
		error("Path of Building produced no main calculation output.")
	end

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

	local mainGroup = build.skillsTab
		and build.skillsTab.socketGroupList
		and build.skillsTab.socketGroupList[build.mainSocketGroup]
	local mainSkillName = mainGroup and (mainGroup.displayLabel or mainGroup.label) or nil

	return {
		ok = true,
		authoritative = true,
		engineVersion = launch and launch.versionNumber or nil,
		engineBranch = launch and launch.versionBranch or nil,
		enginePlatform = launch and launch.versionPlatform or nil,
		outputRevision = build.outputRevision,
		targetVersion = build.targetVersion,
		className = build.spec and build.spec.curClassName or nil,
		ascendancyName = build.spec and build.spec.curAscendClassName or nil,
		mainSocketGroup = build.mainSocketGroup,
		mainSkillName = mainSkillName,
		scalarCount = scalarCount,
		stats = stats,
		warnings = warnings,
		calculationMilliseconds = math.floor((os.clock() - startedAt) * 1000),
		readOnly = true,
		freshProcess = true,
	}
end, debug.traceback)

if not ok then
	if operation == "import-character" then
		fail("POB_CHARACTER_IMPORT_FAILED", "Path of Building could not import this character.", result)
	else
		fail("POB_CALCULATION_FAILED", "Path of Building could not calculate this build.", result)
	end
	return
end
emit(result)
