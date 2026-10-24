// Public API of the layout editor core (pure functions, no DOM, no three.js).
export {
  HISTORY_LIMIT, MATERIAL_KEYS, createState, emptyLayout, findPiece, selectedPiece, selectPiece, pieceAt, pieceCount, canUndo, canRedo,
  addPiece, movePiece, rotatePiece, turnPiece, deletePiece, resizePiece, recolorPiece, resetToAuto, loadLayout, undo, redo, sizeFrom, cleanColor,
} from './state.js';
export { SNAP_DEFAULTS, HARD_KINDS, placeAt, placementProblems, hardProblems, roomAt, supportAt, normRot } from './rules.js';
export { IO_LIMITS, serializeLayout, parseLayout } from './io.js';
