// Public API of the layout engine (pure functions, no DOM, no three.js).
export { autoFurnish, mulberry32, defaultAllowed, LIMITS } from './engine.js';
export { checkLayout, countsByRoom, REQUIRED_SETS } from './check.js';
export { roomType, roomZones, roomTypeFromName, normalizeName, ROOM_TYPES, OTHER } from './rooms.js';
export { roomInterior } from './geometry.js';
