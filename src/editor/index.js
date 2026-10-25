// Public API of the layout editor core (pure functions, no DOM, no three.js).
export {
  HISTORY_LIMIT, MATERIAL_KEYS, createState, emptyLayout, findPiece, selectedPiece, selectPiece, pieceAt, pieceCount, canUndo, canRedo,
  addPiece, movePiece, rotatePiece, turnPiece, deletePiece, resizePiece, recolorPiece, resetToAuto, loadLayout, undo, redo, sizeFrom, cleanColor, cleanRoomColor,
  recolorRoom, roomColorsOf, ROOM_PARTS, ROOM_LIMIT, validRoomId, duplicatePiece, DUPLICATE_OFFSET, COORD_LIMIT, ELEV_LIMIT,
} from './state.js';
export { SNAP_DEFAULTS, HARD_KINDS, placeAt, placementProblems, hardProblems, roomAt, roomsOf, roomInfoAt, supportAt, normRot, clearBox, keepBackOnWall } from './rules.js';
export { FURNITURE_COLOR_KEYS, readColor } from './colors.js';
export { IO_LIMITS, serializeLayout, parseLayout } from './io.js';
