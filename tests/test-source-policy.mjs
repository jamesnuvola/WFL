import assert from 'node:assert/strict';
import { latestExpectedSlot, isOfficiallyConfirmed } from '../wfl-source-policy.mjs';

// 07:11 in Rome is 05:11 UTC on 19 October 2026 (CEST).
assert.equal(latestExpectedSlot(new Date('2026-10-19T05:11:00Z')), '2026-10-19T07:00',
  'the current-hour draw must not be rejected during the first 20 minutes');
// 06:55 in Rome is 04:55 UTC: the previous official slot is 23:00 yesterday.
assert.equal(latestExpectedSlot(new Date('2026-10-19T04:55:00Z')), '2026-10-18T23:00',
  'before the first daily draw, expected slot must remain yesterday at 23:00');

const officialDraw = { datetime:'2026-10-19T07:00', numero:4948, numbers:[1,2,3,6,9,10,12,13,17,18], numerone:19 };
const officialSets = [{label:'official-daily',draws:[officialDraw]}];
assert.equal(isOfficiallyConfirmed(officialDraw, officialSets), true,
  'a draw present in an official source must be accepted');
assert.equal(isOfficiallyConfirmed(officialDraw, [{label:'secondary-fallback',draws:[officialDraw]}]), false,
  'a secondary source alone must not count as official confirmation');
assert.equal(isOfficiallyConfirmed({...officialDraw,numerone:20}, officialSets), false,
  'a conflicting Numerone must not count as official confirmation');
assert.equal(isOfficiallyConfirmed({...officialDraw,numbers:[1,2,3,4,9,10,12,13,17,18]}, officialSets), false,
  'conflicting main numbers must not count as official confirmation');

console.log(JSON.stringify({status:'PASS',checks:6,case:'official latest draw accepted; previous slot retained before 07:00; secondary source cannot override official confirmation'},null,2));
