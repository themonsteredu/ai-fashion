export const CLOCK_PRACTICE_HOURS = [12, 3, 6, 9];
export const CLOCK_COLORS = { hour: '#bd571e', minute: '#2255ba' };

const ARM_INDICES = { left: [11, 13, 15], right: [12, 14, 16] };
const HOLD_MS = 300;
const FRAME_GAP_MS = 320;
const MINUTE_TOLERANCE = 25;

function visible(point) {
  return point && (point.visibility ?? 1) >= .55
    && point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1;
}

function distance(a, b, aspect) {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y);
}

function readArm(points, side, aspect, minimumReach) {
  const joints = ARM_INDICES[side].map(index => points[index]);
  if (!joints.every(visible)) return null;
  const [shoulder, elbow, wrist] = joints;
  const reach = distance(shoulder, wrist, aspect);
  const armLength = distance(shoulder, elbow, aspect) + distance(elbow, wrist, aspect);
  if (reach < minimumReach || reach < .82 * armLength) return null;

  // The webcam is mirrored on screen. Measure clockwise from the top of the dial.
  const x = (shoulder.x - wrist.x) * aspect;
  const y = wrist.y - shoulder.y;
  const angle = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
  return { side, joints, angle, distanceToTwelve: Math.min(angle, 360 - angle) };
}

export class BodyClockTracker {
  constructor() {
    this.reset();
  }

  reset() {
    this.minuteSide = null;
    this.candidate = null;
    this.since = 0;
    this.samples = 0;
    this.lastFrame = -Infinity;
  }

  update(points, aspect, now) {
    if (!visible(points?.[11]) || !visible(points?.[12]) || !Number.isFinite(aspect) || aspect <= 0) {
      this.reset();
      return null;
    }
    const minimumReach = Math.max(.035, distance(points[11], points[12], aspect) * .43);
    const left = readArm(points, 'left', aspect, minimumReach);
    const right = readArm(points, 'right', aspect, minimumReach);
    if (!left || !right) {
      this.reset();
      return null;
    }

    let minuteArm = left.distanceToTwelve <= right.distanceToTwelve ? left : right;
    const previous = this.minuteSide === 'left' ? left : right;
    if (this.minuteSide && now - this.lastFrame <= FRAME_GAP_MS
        && previous.distanceToTwelve <= MINUTE_TOLERANCE
        && previous.distanceToTwelve - minuteArm.distanceToTwelve < 8) {
      minuteArm = previous;
    }
    const hourArm = minuteArm === left ? right : left;
    const minuteAtTwelve = minuteArm.distanceToTwelve <= MINUTE_TOLERANCE;
    const candidate = minuteAtTwelve ? Math.round(hourArm.angle / 30) % 12 || 12 : null;

    if (candidate !== this.candidate || now - this.lastFrame > FRAME_GAP_MS) {
      this.since = now;
      this.samples = 0;
    }
    this.samples++;
    this.minuteSide = minuteArm.side;
    this.lastFrame = now;
    this.candidate = candidate;
    const hour = this.samples >= 3 && now - this.since >= HOLD_MS ? candidate : null;

    return {
      minuteArm, hourArm, minuteAtTwelve, hour,
      minuteDegrees: minuteAtTwelve ? 0 : minuteArm.angle,
      hourDegrees: hour === null ? hourArm.angle : hour * 30,
    };
  }
}

export function paintClock(canvas, hands) {
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(canvas.width / 400, canvas.height / 400);
  ctx.translate(200, 200);

  ctx.beginPath();
  ctx.arc(0, 0, 194, 0, Math.PI * 2);
  ctx.fillStyle = '#fffdf8';
  ctx.fill();
  ctx.strokeStyle = '#243f51';
  ctx.lineWidth = 5;
  ctx.stroke();

  ctx.font = '600 27px "S-Core Dream", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#183749';
  ctx.strokeStyle = '#74939d';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let hour = 1; hour <= 12; hour++) {
    const angle = hour * Math.PI / 6;
    const x = Math.sin(angle), y = -Math.cos(angle);
    ctx.moveTo(x * 174, y * 174);
    ctx.lineTo(x * 182, y * 182);
    ctx.fillText(String(hour), x * 151, y * 151 + 1);
  }
  ctx.stroke();

  function hand(degrees, length, width, color) {
    const angle = degrees * Math.PI / 180;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.sin(angle) * length, -Math.cos(angle) * length);
    ctx.stroke();
  }
  if (hands) {
    hand(hands.minuteDegrees, 125, 9, CLOCK_COLORS.minute);
    hand(hands.hourDegrees, 84, 13, CLOCK_COLORS.hour);
  }
  ctx.beginPath();
  ctx.arc(0, 0, 8, 0, Math.PI * 2);
  ctx.fillStyle = '#243f51';
  ctx.fill();
  ctx.restore();
}
