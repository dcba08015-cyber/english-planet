/* 住戶版模板 — 沒有終端機、沒有指令、只有看得懂的動作 */
const DUR = 48.0;
const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, s, d) => clamp((t - s) / d);
const eOut = (x) => 1 - Math.pow(1 - x, 3);
const eBack = (x) => { const c = 2.0; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = (a, b, x) => a + (b - a) * x;

function show(el, p, q, dy = 40) {
  el.style.opacity = eOut(p) * (1 - q);
  el.style.transform = `translateY(${lerp(dy, 0, eOut(p)) + q * -20}px)`;
}
const hide = (el) => { el.style.opacity = 0; };

function drawChar(t, x, y, s, happy) {
  const c = $('char');
  c.style.transform = `translate(${x}px, ${y + Math.sin(t * 2.2) * 8}px) scale(${s})`;
  const ph = (t % 2.9) / 0.14;
  const blink = ph < 1 ? Math.abs(Math.sin(ph * Math.PI)) : 0;
  $('eyeL').style.opacity = $('eyeR').style.opacity = happy ? 0 : 1;
  $('eyeLh').style.opacity = $('eyeRh').style.opacity = happy ? 1 : 0;
  $('eyeL').setAttribute('ry', Math.max(1.5, 14 * (1 - blink)));
  $('eyeR').setAttribute('ry', Math.max(1.5, 14 * (1 - blink)));
  $('mouth').setAttribute('d', happy ? 'M188 292 q22 22 44 0' : 'M192 296 q18 12 36 0');
  $('armL').setAttribute('transform', `rotate(${Math.sin(t * 2.2) * 8} 112 300)`);
  $('armR').setAttribute('transform', `rotate(${-Math.sin(t * 2.2) * 8} 308 300)`);
}

function bubble(text, p, x, y) {
  const b = $('bubble');
  b.textContent = text;
  b.style.left = x + 'px';
  b.style.top = y + 'px';
  b.style.opacity = p;
  b.style.transform = `scale(${lerp(.8, 1, eBack(clamp(p)))})`;
}

function setLamps(red) {
  ['lp1', 'lp2', 'lp3'].forEach((id) => $(id).setAttribute('fill', '#3FD68A'));
  $('lp4').setAttribute('fill', red ? '#E0533C' : '#3FD68A');
  $('ring').style.opacity = red ? 1 : 0;
}

function setT(t) {
  ['hook', 'stephead', 'acts', 'tel', 'cap'].map($).forEach(hide);
  ['svPhone', 'svModem', 'svClock'].map($).forEach(hide);
  $('bubble').style.opacity = 0;
  $('char').style.opacity = 1;
  $('barfill').style.width = (clamp(t / DUR) * 100) + '%';
  show($('logo'), seg(t, .1, .5), seg(t, DUR - .4, .4), 16);
  $('logo').style.transform = 'none';
  $('plug').setAttribute('transform', 'translate(0,0)');
  $('dial').setAttribute('stroke-dashoffset', 1144);
  $('clockNum').textContent = '30';

  /* ── 鉤子 0–6 ── */
  if (t < 6.0) {
    const q = seg(t, 5.5, .5);
    show($('hook'), 1, 0, 0);
    $('hook').style.transform = 'none';
    show($('h1'), seg(t, .5, .5), q, 50);
    show($('h2'), seg(t, 1.1, .5), q, 50);
    const p = seg(t, 1.9, .6);
    $('svPhone').style.opacity = p * (1 - q);
    $('svPhone').style.transform = `translate(-50%,-50%) scale(${lerp(.86, 1, eBack(p))})`;
    $('visual').style.top = '620px';
    drawChar(t, 90, 1290, .8, false);
    $('char').style.opacity = eOut(seg(t, 2.6, .5)) * (1 - q);
    bubble('我教你，很簡單', seg(t, 3.2, .35) * (1 - seg(t, 5.3, .3)), 470, 1330);
    return;
  }
  $('visual').style.top = '360px';

  /* ── 第一步 6–19：看燈 ── */
  if (t < 19.0) {
    const u = t - 6.0, q = seg(u, 12.5, .5);
    $('stepno').textContent = '1';
    $('steptxt').textContent = '先看牆邊那台機器';
    show($('stephead'), seg(u, .1, .45), q, 26);
    const p = seg(u, .35, .55);
    $('svModem').style.opacity = p * (1 - q);
    $('svModem').style.transform = `translate(-50%,-50%) scale(${lerp(.9, 1, eOut(p))})`;

    const red = u > 3.6 && u < 8.4;
    setLamps(red);
    let cap = '有沒有<em>紅色</em>的燈在亮？';
    if (u > 3.9) cap = '有紅燈 → <u>打電話</u>給我們就好';
    if (u > 8.6) cap = '全部都是綠燈 → 那就繼續下一步';
    $('captxt').innerHTML = cap;
    show($('cap'), seg(u, 1.4, .4), q, 22);

    drawChar(t, 806, 44, .48, false);
    $('char').style.opacity = eOut(seg(u, .5, .5)) * (1 - q);
    return;
  }

  /* ── 第二步 19–33：拔插頭、數 30 ── */
  if (t < 33.0) {
    const u = t - 19.0, q = seg(u, 13.5, .5);
    $('stepno').textContent = '2';
    $('steptxt').textContent = '拔插頭，數到 30';
    show($('stephead'), seg(u, .1, .45), q, 26);

    if (u < 5.2) {
      const p = seg(u, .3, .45);
      $('svModem').style.opacity = p;
      $('svModem').style.transform = 'translate(-50%,-50%) scale(1)';
      setLamps(false);
      const pull = seg(u, 1.8, 1.3);
      $('plug').setAttribute('transform', `translate(${pull * 130},${pull * 60})`);
      if (pull > 0) { ['lp1','lp2','lp3','lp4'].forEach(id=>$(id).setAttribute('fill', pull>.55?'#D8DFDD':'#3FD68A')); }
      $('captxt').innerHTML = pull > .6 ? '插頭<u>拔起來</u>就好，不會壞' : '把它的<u>插頭</u>拔起來';
    } else {
      const p = seg(u, 5.3, .4);
      $('svClock').style.opacity = p * (1 - q);
      $('svClock').style.transform = 'translate(-50%,-50%) scale(1)';
      const n = Math.max(0, Math.round(lerp(30, 0, seg(u, 5.6, 7.0))));
      $('clockNum').textContent = n;
      $('dial').setAttribute('stroke-dashoffset', 1144 * (n / 30));
      $('captxt').innerHTML = n > 2 ? '慢慢數到 <u>30</u>，不用急' : '好了，可以插回去了';
    }
    show($('cap'), seg(u, .6, .4), q, 22);
    show($('acts'), seg(u, .8, .5), q, 30);
    drawChar(t, 806, 44, .48, false);
    $('char').style.opacity = 1 - q;
    return;
  }

  /* ── 第三步 33–42：插回去等燈綠 ── */
  if (t < 42.0) {
    const u = t - 33.0, q = seg(u, 8.5, .5);
    $('stepno').textContent = '3';
    $('steptxt').textContent = '插回去，等燈變綠';
    show($('stephead'), seg(u, .1, .45), q, 26);
    const p = seg(u, .3, .45);
    $('svModem').style.opacity = p * (1 - q);
    $('svModem').style.transform = 'translate(-50%,-50%) scale(1)';
    const back = 1 - seg(u, .6, 1.0);
    $('plug').setAttribute('transform', `translate(${back * 130},${back * 60})`);
    const lit = Math.floor(seg(u, 2.0, 4.2) * 4 + 1e-6);
    ['lp1', 'lp2', 'lp3', 'lp4'].forEach((id, i) => {
      $(id).setAttribute('fill', i < lit ? '#3FD68A' : '#D8DFDD');
    });
    $('ring').style.opacity = 0;
    $('captxt').innerHTML = u < 2.2 ? '插回去，等它自己重新開機'
      : (lit < 4 ? '大約要等 <u>2 分鐘</u>，燈會一顆一顆亮'
                 : '燈全亮了 → 拿手機<u>再試一次</u>');
    show($('cap'), seg(u, .5, .4), q, 22);
    drawChar(t, 806, 44, .48, lit >= 4);
    $('char').style.opacity = 1 - q;
    return;
  }

  /* ── 還是不行 42–48 ── */
  const u = t - 42.0, q = seg(t, DUR - .4, .4);
  show($('tel'), seg(u, .2, .55), q, 46);
  drawChar(t, 700, 1370, .6, true);
  $('char').style.opacity = eOut(seg(u, .5, .5)) * (1 - q);
  bubble('別客氣，我們來處理', seg(u, 1.2, .35) * (1 - q), 120, 1430);
}
window.setT = setT;
window.VIDEO_DURATION = DUR;
setT(0);
