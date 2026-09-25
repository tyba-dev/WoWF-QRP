local config = dofile("src/config.lua")
local flavorLoader = dofile("generator/flavor.lua")
if io.open("src/corrections/manifest.lua") then config.correctionManifest = dofile("src/corrections/manifest.lua") end
local flavor; for _,f in ipairs(config.flavors) do if f.name=="Forever" then flavor=f end end
local loaded = flavorLoader.load(flavor, {Npc=true,Object=true}, true)
local function w(f,s) f:write(s) end
local function pts(f, sp)
  -- writes {"zone":[[x,y],...],...} flattening nested waypoint lists into segments marker
  if type(sp)~="table" then f:write("null") return end
  f:write("{") local first=true
  for z,lst in pairs(sp) do
    if not first then f:write(",") end first=false
    f:write('"'..z..'":[')
    local fp=true
    for _,p in ipairs(lst) do
      if type(p)=="table" then
        if type(p[1])=="table" then
          if not fp then f:write(",") end fp=false
          f:write("[") local f2=true
          for _,q in ipairs(p) do if type(q)=="table" and q[1] and q[2] then if not f2 then f:write(",") end f2=false f:write(string.format("[%.2f,%.2f]",q[1],q[2])) end end
          f:write("]")
        elseif p[1] and p[2] then
          if not fp then f:write(",") end fp=false
          f:write(string.format("[%.2f,%.2f]",p[1],p[2]))
        end
      end
    end
    f:write("]")
  end
  f:write("}")
end
for name,cfg in pairs({Npc={sp=7,wp=8,fr=13,fl=15},Object={sp=4,wp=7}}) do
  local f=io.open("/home/claude/work/raw_"..name..".json","w") f:write("{") local first=true
  for id,row in pairs(loaded[name].entities) do
    if not first then f:write(",") end first=false
    f:write('"'..id..'":{"s":') pts(f,row[cfg.sp]) f:write(',"w":') pts(f,row[cfg.wp])
    if cfg.fr then f:write(',"fr":'..(row[cfg.fr] and ('"'..row[cfg.fr]..'"') or 'null')..',"fl":'..tostring(row[cfg.fl] or 0)) end
    f:write("}")
  end
  f:write("}") f:close()
end
