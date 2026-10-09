-- usage: lua tojson.lua in.lua out.json   (combined Forever DB file -> JSON {id:[...]})
local t=dofile(arg[1])
local function isarr(v) local n=0 for k in pairs(v) do if type(k)~="number" or k<1 or k~=math.floor(k) then return false end if k>n then n=k end end return true,n end
local function enc(v,out)
  local tv=type(v)
  if tv=="nil" then out[#out+1]="null"
  elseif tv=="boolean" then out[#out+1]=tostring(v)
  elseif tv=="number" then if v~=v or v==math.huge or v==-math.huge then out[#out+1]="null" elseif v==math.floor(v) and math.abs(v)<1e15 then out[#out+1]=string.format("%d",v) else out[#out+1]=string.format("%.4f",v) end
  elseif tv=="string" then out[#out+1]='"'..v:gsub('[%c"\\]',function(c) return string.format("\\u%04x",c:byte()) end)..'"'
  elseif tv=="table" then local a,n=isarr(v)
    if a then out[#out+1]="[" for i=1,n do if i>1 then out[#out+1]="," end enc(v[i],out) end out[#out+1]="]"
    else out[#out+1]="{" local f=true for k,x in pairs(v) do if not f then out[#out+1]="," end f=false out[#out+1]='"'..tostring(k)..'":' enc(x,out) end out[#out+1]="}" end
  else out[#out+1]="null" end
end
local out={"{"} local f=true
for id,row in pairs(t) do if not f then out[#out+1]="," end f=false out[#out+1]='"'..id..'":' enc(row,out) end
out[#out+1]="}"
local fh=io.open(arg[2],"w") fh:write(table.concat(out)) fh:close()
