export function bodyClockPose(hour, aspect, { minuteSide = hour === 9 ? 'right' : 'left', minuteDegrees = 0 } = {}) {
  const points = Array.from({ length: 33 }, () => ({ x: .5, y: .44, z: 0, visibility: 1 }));
  const set = (index, x, y) => Object.assign(points[index], { x, y });
  set(0, .5, .22);
  set(2, .52, .21);
  set(5, .48, .21);
  set(7, .54, .23);
  set(8, .46, .23);
  for (const [side, offset, sign] of [['left', 0, 1], ['right', 1, -1]]) {
    const x = .5 + sign * .085, y = .42;
    const angle = (side === minuteSide ? minuteDegrees : hour * 30) * Math.PI / 180;
    const dx = -Math.sin(angle) * .25 / aspect, dy = -Math.cos(angle) * .25;
    set(11 + offset, x, y);
    set(13 + offset, x + dx * .52, y + dy * .52);
    set(15 + offset, x + dx, y + dy);
    set(23 + offset, .5 + sign * .065, .60);
    set(25 + offset, .5 + sign * .075, .74);
    set(27 + offset, .5 + sign * .079, .88);
  }
  return points;
}
