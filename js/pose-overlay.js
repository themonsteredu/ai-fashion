const connections = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28],
];
const joints = [...new Set(connections.flat())];
const usable = point => point && (point.visibility ?? 1) >= .55
  && Number.isFinite(point.x) && Number.isFinite(point.y)
  && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;

export function drawPoseOverlay(canvas, video, people = []) {
  // Both layers use the video's intrinsic ratio and object-fit: contain.
  const width = video.videoWidth || 960, height = video.videoHeight || 720;
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d'), scale = width / 480;
  ctx.clearRect(0, 0, width, height);
  const x = point => (1 - point.x) * width;
  const y = point => point.y * height;
  ctx.lineCap = 'round';
  for (const { points, color = '#71f0ba', label } of people) {
    if (!points) continue;
    ctx.setLineDash([6 * scale, 5 * scale]);
    for (const [a, b] of connections) {
      if (!usable(points[a]) || !usable(points[b])) continue;
      ctx.beginPath();
      ctx.moveTo(x(points[a]), y(points[a]));
      ctx.lineTo(x(points[b]), y(points[b]));
      ctx.strokeStyle = 'rgba(10, 28, 35, .8)';
      ctx.lineWidth = 5 * scale;
      ctx.stroke();
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5 * scale;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const index of joints) {
      if (!usable(points[index])) continue;
      ctx.beginPath();
      ctx.arc(x(points[index]), y(points[index]), 3.5 * scale, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#173548';
      ctx.lineWidth = 1.5 * scale;
      ctx.stroke();
    }
    if (label && usable(points[11]) && usable(points[12])) {
      ctx.font = `700 ${14 * scale}px sans-serif`;
      const labelWidth = ctx.measureText(label).width + 16 * scale, labelHeight = 24 * scale;
      const left = Math.max(0, Math.min(width - labelWidth, (x(points[11]) + x(points[12])) / 2 - labelWidth / 2));
      const top = Math.max(0, Math.min(height - labelHeight, Math.min(y(points[11]), y(points[12])) - 32 * scale));
      ctx.fillStyle = '#173548';
      ctx.fillRect(left, top, labelWidth, labelHeight);
      ctx.fillStyle = color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, left + labelWidth / 2, top + labelHeight / 2);
    }
  }
}
