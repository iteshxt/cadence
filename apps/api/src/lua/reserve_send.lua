-- Atomic send-slot reservation for one sender (tech-spec §9.2).
--
-- KEYS[1]  gap:s:{senderId}      the sender's next free slot (ms)
-- ARGV[1]  nowMs
-- ARGV[2]  senderId              used to build the hourly counter keys
-- ARGV[3]  campaignId
-- ARGV[4]  senderLimit           sends per sender per UTC hour
-- ARGV[5]  campaignLimit         sends per campaign per UTC hour
-- ARGV[6]  minGapMs              minimum gap between two sends from the sender
-- ARGV[7]  ttlSec                base TTL for the counters
--
-- Returns {'OK', slotMs} or {'LIMIT', scope, hourIndex}. The counters are charged against the
-- UTC hour of the slot, not of `now`. Counter keys are derived from the slot, so this script
-- assumes a single-node Redis (it would need hash tags on Redis Cluster).

local now = tonumber(ARGV[1])
local senderLimit = tonumber(ARGV[4])
local campaignLimit = tonumber(ARGV[5])
local minGap = tonumber(ARGV[6])
local ttl = tonumber(ARGV[7])

local nextAllowed = tonumber(redis.call('GET', KEYS[1]) or '0')
local slot = math.max(now, nextAllowed)
local hour = math.floor(slot / 3600000)
local sKey = 'rl:s:' .. ARGV[2] .. ':' .. hour
local cKey = 'rl:c:' .. ARGV[3] .. ':' .. hour

if tonumber(redis.call('GET', sKey) or '0') >= senderLimit then
  return {'LIMIT', 'sender', hour}
end
if tonumber(redis.call('GET', cKey) or '0') >= campaignLimit then
  return {'LIMIT', 'campaign', hour}
end

local keyTtl = ttl + math.ceil((slot - now) / 1000)
redis.call('INCR', sKey)
redis.call('EXPIRE', sKey, keyTtl)
redis.call('INCR', cKey)
redis.call('EXPIRE', cKey, keyTtl)
redis.call('SET', KEYS[1], slot + minGap, 'PX', (slot - now) + minGap * 10)
return {'OK', slot}
