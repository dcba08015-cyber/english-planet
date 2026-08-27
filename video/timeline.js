/* 智寶網路急救室 — 逐格時間軸。setT(t) 為純函式：同一個 t 永遠畫出同一格。 */
const DUR = 36.0;

const $ = (id) => document.getElementById(id);
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const seg = (t, s, d) => clamp((t - s) / d);
const eOut = (x) => 1 - Math.pow(1 - x, 3);
const eInOut = (x) => (x < .5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const eBack = (x) => { const c = 2.2; return 1 + (c + 1) * Math.pow(x - 1, 3) + c * Math.pow(x - 1, 2); };
const lerp = (a, b, x) => a + (b - a) * x;

/* 進場 / 出場：p 為 0→1 進場進度，q 為 0→1 出場進度 */
function show(el, p, q, dy = 40, sc = 1) {
  const o = eOut(p) * (1 - q);
  el.style.opacity = o;
  el.style.transform = `translateY(${lerp(dy, 0, eOut(p)) + q * -24}px) scale(${lerp(sc, 1, eOut(p))})`;
}
const hide = (el) => { el.style.opacity = 0; };

const STEPS = [
  {
    s: 4.2, e: 13.4, num: 'STEP 1', title: '先確認：你到分享器',
    cmd: 'ping 192.168.1.1',
    out: [
      ['dim', '正在 Ping 192.168.1.1 (你家分享器)'],
      ['ok', '回覆自 192.168.1.1: 時間=2ms TTL=64'],
      ['ok', '回覆自 192.168.1.1: 時間=1ms TTL=64'],
      ['dim', '已傳送 4，已收到 4，遺失 0 (0% 遺失)'],
    ],
    bad: false, vico: '✅',
    vtxt: '通了 → 你到分享器這段沒問題<br>（網路線、WiFi、實體層全部 OK）',
    caps: [[.3, '滿格 ≠ 有網路，先查<u>最近的一段</u>'],
           [3.4, 'ping 你家分享器，通常是 <u>192.168.1.1</u>'],
           [7.0, '秒回 → 這段沒事，<em>往外一層</em>查']],
    say: [1.0, 2.4, '先查最近的！'], eye: 'normal',
  },
  {
    s: 13.4, e: 22.4, num: 'STEP 2', title: '再確認：分享器到外面',
    cmd: 'ping 8.8.8.8',
    out: [
      ['dim', '正在 Ping 8.8.8.8 (Google 公用 DNS)'],
      ['ok', '回覆自 8.8.8.8: 時間=14ms TTL=115'],
      ['ok', '回覆自 8.8.8.8: 時間=13ms TTL=115'],
      ['dim', '已傳送 4，已收到 4，遺失 0 (0% 遺失)'],
    ],
    bad: false, vico: '✅',
    vtxt: '也通了 → 對外線路正常<br>兇手<b>不是</b>中華電信、也不是你家網路',
    caps: [[.3, '這次直接 ping <u>外面的 IP</u>'],
           [3.4, '注意：這裡打的是 <em>IP</em>，不是網址'],
           [7.0, '外面也通 → 那到底是誰壞了？']],
    say: [1.0, 2.4, '再往外一層～'], eye: 'normal',
  },
  {
    s: 22.4, e: 31.4, num: 'STEP 3', title: '那就只剩下它了',
    cmd: 'nslookup google.com',
    out: [
      ['dim', '伺服器:  UnKnown'],
      ['dim', 'Address:  192.168.1.1'],
      ['err', '*** UnKnown 找不到 google.com:'],
      ['err', '    Server failed  ← 就是這行！'],
    ],
    bad: true, vico: '🚨',
    vtxt: '有網路，只是<b>沒人幫你把網址翻成 IP</b><br>兇手就是 <b>DNS 掛了</b>',
    caps: [[.3, '打<u>網址</u>試試看，這次用 nslookup'],
           [3.6, 'IP 通、網址不通 → 一定是 <em>DNS</em>'],
           [6.6, '這就是「滿格卻打不開」的真相']],
    say: [4.6, 3.0, '抓到兇手了！'], eye: 'alert',
  },
];

function drawChar(t, x, y, s, mode) {
  const c = $('char');
  const bob = Math.sin(t * 2.3) * 7;
  c.style.transformOrigin = '0 0';
  c.style.transform = `translate(${x}px, ${y + bob}px) scale(${s})`;
  c.style.opacity = 1;

  /* 眨眼：每 2.7 秒一次，0.13 秒 */
  const ph = (t % 2.7) / 0.13;
  const blink = ph < 1 ? Math.abs(Math.sin(ph * Math.PI)) : 0;
  const happy = mode === 'happy';
  $('eyeL').style.opacity = $('eyeR').style.opacity = happy ? 0 : 1;
  $('eyeLh').style.opacity = $('eyeRh').style.opacity = happy ? 1 : 0;
  const ry = mode === 'alert' ? 17 : 14;
  $('eyeL').setAttribute('ry', Math.max(1.5, ry * (1 - blink)));
  $('eyeR').setAttribute('ry', Math.max(1.5, ry * (1 - blink)));
  $('eyeL').setAttribute('rx', mode === 'alert' ? 16 : 14);
  $('eyeR').setAttribute('rx', mode === 'alert' ? 16 : 14);

  $('mouth').setAttribute('d',
    mode === 'alert' ? 'M194 300 q16 -14 32 0'
    : happy ? 'M188 292 q22 22 44 0'
    : 'M192 296 q18 12 36 0');

  /* 警示符號：alert 時脈動 */
  $('emo').style.opacity = mode === 'alert' ? (0.55 + 0.45 * Math.sin(t * 9)) : 0;

  /* 天線訊號波 */
  const pw = (t * 1.6) % 1;
  $('w1').style.opacity = 0.35 + 0.65 * Math.abs(Math.sin(t * 3.2));
  $('w2').style.opacity = 0.2 + 0.55 * Math.abs(Math.sin(t * 3.2 - 0.7));
  /* 手臂輕擺 */
  $('armL').setAttribute('transform', `rotate(${Math.sin(t * 2.3) * 8} 112 300)`);
  $('armR').setAttribute('transform', `rotate(${-Math.sin(t * 2.3) * 8} 308 300)`);
}

function setT(t) {
  const S = ['hook', 'hooksub', 'step', 'term', 'verdict', 'fix', 'cap', 'cta'].map($);
  S.forEach(hide);
  $('speech').style.opacity = 0;
  $('barfill').style.width = (clamp(t / DUR) * 100) + '%';
  show($('head'), seg(t, .1, .6), seg(t, DUR - .5, .5), 20);

  /* ---------- S1 HOOK ---------- */
  if (t < 4.2) {
    const q = seg(t, 3.7, .5);
    show($('h1'), seg(t, .45, .45), q, 70, .82);
    show($('h2'), seg(t, .95, .45), q, 70, .82);
    show($('hook'), 1, 0, 0);
    $('hook').style.opacity = 1; $('hook').style.transform = 'none';
    show($('hooksub'), seg(t, 2.0, .6), q, 30);
    const pop = eBack(seg(t, .15, .7));
    const sc = lerp(.35, 1.12, pop);
    drawChar(t, (1080 - 420 * sc) / 2, 1080, sc, t > 1.6 && t < 3.4 ? 'alert' : 'normal');
    $('char').style.opacity = (1 - q);
    return;
  }

  /* ---------- S2–S4 三個排錯步驟 ---------- */
  for (const st of STEPS) {
    if (t < st.s || t >= st.e) continue;
    const u = t - st.s, len = st.e - st.s;
    const q = seg(u, len - .55, .55);

    $('stepnum').textContent = st.num;
    $('steptxt').textContent = st.title;
    show($('step'), seg(u, .05, .45), q, 30);
    show($('term'), seg(u, .2, .5), q, 60, .96);

    /* 打字 */
    const tp = 0.62, td = st.cmd.length * 0.052;
    const n = Math.floor(seg(u, tp, td) * st.cmd.length + 1e-6);
    $('cmd').textContent = st.cmd.slice(0, n);
    const typing = u > tp && u < tp + td;
    $('caret').style.opacity = typing ? 1 : (u > tp + td ? (Math.floor(u * 2) % 2 ? .15 : 1) : 0);

    /* 輸出 */
    const o0 = tp + td + .35;
    st.out.forEach((o, i) => {
      const el = $('l' + (i + 1));
      el.className = 'ln ' + o[0];
      el.innerHTML = o[1];
      const p = seg(u, o0 + i * .42, .3);
      el.style.opacity = p * (1 - q);
      el.style.transform = `translateX(${lerp(-22, 0, eOut(p))}px)`;
    });

    /* 判讀 */
    const vs = o0 + st.out.length * .42 + .35;
    $('verdict').className = st.bad ? 'bad' : '';
    $('vico').textContent = st.vico;
    $('vtxt').innerHTML = st.vtxt;
    show($('verdict'), seg(u, vs, .55), q, 44, .96);

    /* 字幕 */
    let cap = st.caps[0][1];
    for (const c of st.caps) if (u >= c[0]) cap = c[1];
    $('captxt').innerHTML = cap;
    show($('cap'), seg(u, .3, .4), q, 26);

    /* 智寶 + 對話泡泡 */
    const alert = st.eye === 'alert' && u > vs - .5;
    drawChar(t, 782, 128, .58, alert ? 'alert' : 'normal');
    $('char').style.opacity = eOut(seg(u, .1, .45)) * (1 - q);
    const [ss, sd, stx] = st.say;
    const sp = seg(u, ss, .28) * (1 - seg(u, ss + sd, .3));
    $('speech').textContent = stx;
    $('speech').style.right = '320px';
    $('speech').style.left = 'auto';
    $('speech').style.top = '336px';
    $('speech').style.opacity = sp;
    $('speech').style.transform = `scale(${lerp(.75, 1, eBack(clamp(sp)))})`;
    return;
  }

  /* ---------- S5 解法 + CTA ---------- */
  const u = t - 31.4, q = seg(t, DUR - .45, .45);
  show($('fix'), seg(u, .1, .55), q, 70, .94);
  $('captxt').innerHTML = '收藏起來，<u>下次壞掉</u>照著做一次';
  show($('cap'), seg(u, 1.4, .5), q, 26);
  show($('cta'), seg(u, 2.4, .6), q, 20);
  drawChar(t, 646, 1006, .80, 'happy');
  $('char').style.opacity = eOut(seg(u, .35, .5)) * (1 - q);
  const sp = seg(u, .9, .3) * (1 - seg(u, 3.4, .4));
  $('speech').textContent = '三步驟就修好！';
  $('speech').style.right = '440px';
  $('speech').style.left = 'auto';
  $('speech').style.top = '1186px';
  $('speech').style.opacity = sp;
  $('speech').style.transform = `scale(${lerp(.75, 1, eBack(clamp(sp)))})`;
}
window.setT = setT;
window.VIDEO_DURATION = DUR;
setT(0);
