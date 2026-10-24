// The backdrop is one 16:9 picture that fills the screen. On a taller screen (a phone held upright) it would be stretched
// upwards and its round lights would turn into streaks, so only the middle part of it is shown, like CSS "cover": the sides
// are cropped on a tall screen, the top and bottom on a very wide one. Returns the texture repeat and offset for that part.
export function backdropCrop(aspect, textureAspect = 16 / 9) {
  const a = Number.isFinite(aspect) && aspect > 0 ? aspect : textureAspect;
  if (a < textureAspect) { const rx = a / textureAspect; return { repeat: [rx, 1], offset: [(1 - rx) / 2, 0] }; }
  const ry = textureAspect / a;
  return { repeat: [1, ry], offset: [0, (1 - ry) / 2] };
}
