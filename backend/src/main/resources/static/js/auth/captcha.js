/**
 * 演示级图形验证码（Canvas），非生产防刷方案。
 */

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randInt(n) {
  return Math.floor(Math.random() * n);
}

export function createCaptcha(canvas, length = 4) {
  if (!canvas) return { code: '', refresh: () => {} };
  const ctx = canvas.getContext('2d');
  let code = '';

  function draw() {
    const w = canvas.width;
    const h = canvas.height;
    code = '';
    for (let i = 0; i < length; i++) code += CHARS[randInt(CHARS.length)];

    ctx.fillStyle = '#0d1a2c';
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 5; i++) {
      ctx.strokeStyle = `rgba(${80 + randInt(100)},${120 + randInt(80)},${180 + randInt(60)},0.45)`;
      ctx.beginPath();
      ctx.moveTo(randInt(w), randInt(h));
      ctx.lineTo(randInt(w), randInt(h));
      ctx.stroke();
    }

    for (let i = 0; i < code.length; i++) {
      const ch = code[i];
      ctx.save();
      ctx.font = `bold ${22 + randInt(6)}px Consolas, monospace`;
      ctx.fillStyle = `rgb(${140 + randInt(100)},${180 + randInt(60)},${220 + randInt(35)})`;
      ctx.translate(18 + i * 26, 28 + randInt(6));
      ctx.rotate(((randInt(50) - 25) * Math.PI) / 180);
      ctx.fillText(ch, 0, 0);
      ctx.restore();
    }

    for (let i = 0; i < 24; i++) {
      ctx.fillStyle = `rgba(200,220,255,${0.2 + Math.random() * 0.4})`;
      ctx.fillRect(randInt(w), randInt(h), 2, 2);
    }
  }

  draw();

  return {
    get code() {
      return code;
    },
    refresh: draw,
    /** 忽略大小写 */
    verify(input) {
      return String(input || '').trim().toUpperCase() === code.toUpperCase();
    },
  };
}
