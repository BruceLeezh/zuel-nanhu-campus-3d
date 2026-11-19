// 罗盘：画在模板自带的 #cpc（224×224，CSS 112×112）上。
// 约定：heading 为「罗盘方位角」，0 = 正北，顺时针为正（弧度）。
// 页面里相机朝向 yaw 的换算见 hud.js：heading = PI - yaw。
// 画布背景保持透明，让模板 #compass.panel 的玻璃底透上来——不要自己再画一层黑盘。
const TAU = Math.PI * 2;
const RAD = Math.PI / 180;
const DIRS = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
const FONT = '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif';
const HALO = 'rgba(3, 8, 11, 0.55)'; // 亮天空下的暗描边，保证读数可辨

export function createCompass(canvas) {
  if (!canvas) return { draw() {} };
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const CX = W / 2;
  const CY = H / 2;
  const R = Math.min(W, H) / 2 - 6;

  function draw(heading) {
    const h = Number.isFinite(heading) ? heading : 0;
    ctx.clearRect(0, 0, W, H);

    // 外圈：一圈克制的亮线，代替原来的深色底盘
    ctx.beginPath();
    ctx.arc(CX, CY, R, 0, TAU);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(255,255,255,0.30)';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CX, CY, R * 0.715, 0, TAU);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.10)';
    ctx.stroke();

    // 刻度：每 10°，主刻度 30°，正方位 90° 用暖黄
    for (let i = 0; i < 36; i++) {
      const deg = i * 10;
      const sa = deg * RAD - h;
      const sx = Math.sin(sa);
      const sy = -Math.cos(sa);
      const major = deg % 30 === 0;
      const r1 = R * 0.925;
      const r2 = r1 - (major ? R * 0.085 : R * 0.042);
      const cardinal = deg % 90 === 0;
      ctx.beginPath();
      ctx.moveTo(CX + sx * r1, CY + sy * r1);
      ctx.lineTo(CX + sx * r2, CY + sy * r2);
      ctx.lineWidth = cardinal ? 2 : major ? 1.4 : 1;
      ctx.strokeStyle = cardinal
        ? 'rgba(255,212,121,0.78)'
        : major
          ? 'rgba(236,246,251,0.46)'
          : 'rgba(236,246,251,0.22)';
      ctx.stroke();
    }

    // 方位字 N / E / S / W
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cardinals = [['N', 0], ['E', 90], ['S', 180], ['W', 270]];
    for (const [text, deg] of cardinals) {
      const sa = deg * RAD - h;
      const r = R * 0.635;
      const x = CX + Math.sin(sa) * r;
      const y = CY - Math.cos(sa) * r;
      const isN = deg === 0;
      ctx.font = (isN ? '700 ' : '600 ') + (isN ? 31 : 25) + 'px ' + FONT;
      ctx.shadowColor = isN ? 'rgba(255,212,121,0.45)' : HALO;
      ctx.shadowBlur = isN ? 12 : 7;
      ctx.fillStyle = isN ? '#ffd479' : 'rgba(226,240,248,0.88)';
      ctx.fillText(text, x, y);
      ctx.shadowBlur = 0;
    }

    // 指针：北针暖黄，南针冷灰（随朝向旋转）
    const sa = -h;
    const nx = Math.sin(sa);
    const ny = -Math.cos(sa);
    const needle = (dirX, dirZ, len, halfW, fill) => {
      const px = -dirZ;
      const pz = dirX;
      ctx.beginPath();
      ctx.moveTo(CX + dirX * len, CY + dirZ * len);
      ctx.lineTo(CX + px * halfW, CY + pz * halfW);
      ctx.lineTo(CX - px * halfW, CY - pz * halfW);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.shadowColor = HALO;
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
    };
    needle(nx, ny, R * 0.50, R * 0.052, 'rgba(255,212,121,0.95)');
    needle(-nx, -ny, R * 0.46, R * 0.042, 'rgba(214,228,236,0.50)');

    // 中心轴
    ctx.beginPath();
    ctx.arc(CX, CY, R * 0.072, 0, TAU);
    ctx.fillStyle = 'rgba(12,20,26,0.92)';
    ctx.fill();
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(255,212,121,0.78)';
    ctx.stroke();

    // 顶部固定「视线」标记 + 视野弧（画面上方永远是你的正前方）
    ctx.beginPath();
    ctx.arc(CX, CY, R * 0.965, -Math.PI / 2 - 0.27, -Math.PI / 2 + 0.27);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = 'rgba(255,212,121,0.80)';
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(CX, CY - R * 0.90);
    ctx.lineTo(CX - R * 0.055, CY - R * 0.985);
    ctx.lineTo(CX + R * 0.055, CY - R * 0.985);
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,212,121,0.92)';
    ctx.fill();

    // 底部读数：方位 + 角度（细分隔线 + 带暗描边的字，避免压住方位字）
    const deg = ((h / RAD) % 360 + 360) % 360;
    const dir = DIRS[Math.round(deg / 45) % 8];
    const label = dir + ' ' + Math.round(deg) + '°';
    ctx.beginPath();
    ctx.moveTo(CX - R * 0.20, CY + R * 0.775);
    ctx.lineTo(CX + R * 0.20, CY + R * 0.775);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.stroke();
    ctx.font = '600 19px ' + FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = HALO;
    ctx.shadowBlur = 8;
    ctx.fillStyle = 'rgba(236,246,251,0.95)';
    ctx.fillText(label, CX, CY + R * 0.885);
    ctx.shadowBlur = 0;
  }

  return { draw };
}
