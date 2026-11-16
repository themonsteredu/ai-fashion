export function movementPose(id) {
  const image = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: 1 }));
  const set = (index, x, y) => Object.assign(image[index], { x, y });
  set(0, .5, .22);
  for (const [i, sign] of [[0, 1], [1, -1]]) {
    const x = amount => .5 + sign * amount;
    set(11 + i, x(.08), .35);
    set(13 + i, x(.10), .49);
    set(15 + i, x(.11), .63);
    set(23 + i, x(.06), .59);
    set(25 + i, x(.06), .75);
    set(27 + i, x(.06), .92);
    if (id === 'stretch' || id === 'bend') {
      set(13 + i, x(.17), .35);
      set(15 + i, x(id === 'stretch' ? .27 : .17), id === 'stretch' ? .35 : .21);
    }
    if (id === 'waist') set(15 + i, x(.17), .59);
    if (id === 'above-head' || (id === 'raise-arm' && i === 0)) {
      set(13 + i, x(.12), .23);
      set(15 + i, x(.16), .11);
    }
    if (id === 'crouch') {
      set(23 + i, x(.06), .67);
      set(25 + i, x(.14), .75);
    }
    if (id === 'raise-leg' && i === 0) {
      set(25, x(.08), .50);
      set(27, x(.10), .65);
    }
    if (id === 'lean') set(11 + i, x(.08) + .10, .35);
  }
  const world = image.map(point => ({ ...point, x: 1.5 * (point.x - .5), y: point.y - .6 }));
  if (id === 'crouch') for (const index of [25, 26]) world[index].z = -.12;
  return { image, world };
}
