/**
 * 气象大屏动画与自动刷新模块
 * 包含：风险预警滚动、倒计时刷新、KPI数字滚动、刷新闪光
 * ────────────────────────────────────────────────
 * 需配合 dashboard.html 一起使用
 * 约定：HTML 中各图表容器 ID 如下：
 *   trendChart / hourlyChart / pieChart / radarChart
 *   heatmapChart / comboChart / adviceChart
 *   alertList / countdownBadge / refreshFlash
 */

const Dashboard = (() => {
  // ── 全局状态 ──
  let charts = {};
  let currentData = null;
  let scrollTimer = null;
  let countdownTimer = null;
  let remaining = 60;   // 秒
  const REFRESH_INTERVAL = 60;

  // ────────────────────────────────────────────────
  // 1. 倒计时徽章 & 刷新触发
  // ────────────────────────────────────────────────
  function startCountdown() {
    remaining = REFRESH_INTERVAL;
    const badge = document.getElementById('countdownBadge');
    const secEl = document.getElementById('cdSeconds');

    if (countdownTimer) clearInterval(countdownTimer);
    countdownTimer = setInterval(() => {
      remaining--;
      if (secEl) secEl.textContent = remaining + 's';

      // 最后 5 秒高亮
      if (badge) {
        if (remaining <= 5) {
          badge.classList.add('refreshing');
          badge.style.color = '#00ffb2';
          badge.style.borderColor = 'rgba(0,255,180,.55)';
        } else {
          badge.classList.remove('refreshing');
          badge.style.color = '';
          badge.style.borderColor = '';
        }
      }

      if (remaining <= 0) {
        triggerRefresh();
      }
    }, 1000);
  }

  function triggerRefresh() {
    const flash = document.getElementById('refreshFlash');
    if (flash) { flash.classList.add('active'); setTimeout(() => flash.classList.remove('active'), 600); }
    fetchLiveData();
  }

  // ────────────────────────────────────────────────
  // 2. 风险预警无限滚动
  // ────────────────────────────────────────────────
  function initAlertScroll(alerts) {
    const track = document.getElementById('alertTrack');
    if (!track || !alerts || alerts.length === 0) return;

    // 先清空
    while (track.firstChild) track.removeChild(track.firstChild);

    // 创建 2 套，用于无缝循环
    const createItems = (offset) => {
      return alerts.map((a, i) => {
        const isDanger = a.tags.includes('强降水') || a.tags.includes('高温体感');
        const div = document.createElement('div');
        div.className = 'alert-item' + (isDanger ? ' danger' : '');
        div.style.animationDelay = (i * 0.07) + 's';
        div.innerHTML = `
          <div>
            <div class="alert-date">${a.date} ${a.type === 'trend' ? '｜趋势' : '｜预报'}</div>
            <div class="alert-sub">重点关注现场作业、防汛排水与高温暴晒风险</div>
          </div>
          <div class="alert-tag">${a.tags}</div>
        `;
        return div;
      });
    };

    const list1 = createItems(0);
    const list2 = createItems(0);
    list1.forEach(el => track.appendChild(el));
    list2.forEach(el => track.appendChild(el));

    let pos = 0;
    const itemH = track.firstChild ? track.firstChild.offsetHeight + 10 : 70;

    if (scrollTimer) clearInterval(scrollTimer);
    scrollTimer = setInterval(() => {
      pos += 0.55; // 速度：px/帧
      const total = itemH * alerts.length;
      if (pos >= total) pos = 0;
      track.style.transform = `translateY(${-pos}px)`;
    }, 16); // ~60fps

    // 鼠标悬停暂停
    track.addEventListener('mouseenter', () => clearInterval(scrollTimer));
    track.addEventListener('mouseleave', () => {
      if (scrollTimer) clearInterval(scrollTimer);
      scrollTimer = setInterval(() => {
        pos += 0.55;
        const total = itemH * alerts.length;
        if (pos >= total) pos = 0;
        track.style.transform = `translateY(${-pos}px)`;
      }, 16);
    });
  }

  // ────────────────────────────────────────────────
  // 3. KPI 数字滚动动画
  // ────────────────────────────────────────────────
  function animateKpiUpdate(newValues) {
    // newValues = { avgMax, avgMin, totalRain, maxTemp, minTemp, riskDays, heatDays }
    const mapping = [
      { id: 'kpi-avgmax',  key: 'avgMax' },
      { id: 'kpi-avgmin',  key: 'avgMin' },
      { id: 'kpi-rain',    key: 'totalRain' },
      { id: 'kpi-maxtemp', key: 'maxTemp' },
      { id: 'kpi-mintemp', key: 'minTemp' },
      { id: 'kpi-risk',    key: 'riskDays' },
      { id: 'kpi-heat',    key: 'heatDays' },
    ];
    mapping.forEach(({ id, key }) => {
      const el = document.getElementById(id);
      if (!el || newValues[key] === undefined) return;
      const newVal = String(newValues[key]);
      if (el.textContent.trim() !== newVal) {
        el.textContent = newVal;
        el.classList.remove('roll');
        void el.offsetWidth; // reflow
        el.classList.add('roll');
        el.classList.add('updated');
        setTimeout(() => { el.classList.remove('updated'); }, 2000);
      }
    });
  }

  // ────────────────────────────────────────────────
  // 4. 面板刷新闪烁效果
  // ────────────────────────────────────────────────
  function flashPanels() {
    document.querySelectorAll('.panel').forEach((p, i) => {
      p.classList.remove('data-refresh');
      void p.offsetWidth;
      p.classList.add('data-refresh');
      setTimeout(() => p.classList.remove('data-refresh'), 600 + i * 40);
    });
  }

  // ────────────────────────────────────────────────
  // 5. 从 Open-Meteo 获取实时数据（小时级）
  // ────────────────────────────────────────────────
  async function fetchLiveData() {
    try {
      const params = new URLSearchParams({
        latitude: '23.135',
        longitude: '113.361',
        hourly: 'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation_probability,precipitation,weather_code,surface_pressure,wind_speed_10m',
        daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max',
        timezone: 'Asia/Shanghai',
        forecast_days: '2',
      });
      const resp = await fetch('https://api.open-meteo.com/v1/forecast?' + params);
      if (!resp.ok) throw new Error('Network response was not ok');
      const raw = await resp.json();
      processAndRender(raw);
      // 更新页脚时间
      const ts = document.getElementById('dataTime');
      if (ts) ts.textContent = new Date().toLocaleString('zh-CN');
    } catch (e) {
      console.warn('[Dashboard] 实时数据获取失败，使用缓存数据。', e);
      // 重启倒计时（网络失败不阻塞）
      startCountdown();
    }
  }

  // ────────────────────────────────────────────────
  // 6. 处理数据 & 更新各图表
  // ────────────────────────────────────────────────
  function processAndRender(raw) {
    const h = raw.hourly;
    const d = raw.daily;
    const WMO_TEXT = {0:'晴',1:'晴间多云',2:'多云',3:'阴',45:'雾',51:'毛毛雨',53:'小雨',55:'中雨',61:'小雨',63:'中雨',65:'大雨',80:'阵雨',81:'强阵雨',82:'暴雨',95:'雷暴'};

    const now = new Date();
    const curH = now.getHours();
    // 取当前小时附近的索引
    const hIdx = Math.min(curH, h.time.length - 1);

    const next72 = [];
    for (let i = 0; i < Math.min(72, h.time.length); i++) {
      const t = h.time[i];
      const txt = WMO_TEXT[h.weather_code[i]] || '未知';
      next72.push({
        time: t.slice(5).replace('T', ' '),
        temp:    +h.temperature_2m[i].toFixed(1),
        feel:    +h.apparent_temperature[i].toFixed(1),
        humid:   +h.relative_humidity_2m[i],
        rainProb:+h.precipitation_probability[i],
        rain:    +h.precipitation[i],
        pressure:+h.surface_pressure[i],
        wind:    +h.wind_speed_10m[i],
        weather: txt,
      });
    }

    // 更新 hero 数字（如果 DOM 存在）
    const heroTemp  = document.getElementById('heroTemp');
    const heroRange = document.getElementById('heroRange');
    const heroFeel  = document.getElementById('heroFeel');
    const heroProb  = document.getElementById('heroProb');
    const heroWind  = document.getElementById('heroWind');
    const heroUv    = document.getElementById('heroUv');
    const heroCity  = document.getElementById('heroCity');

    if (heroTemp && next72[0]) {
      heroTemp.textContent  = next72[0].temp;
      if (heroRange) heroRange.textContent  = '/ ' + next72[0].feel + '℃';
      heroCity.textContent  = '广州 · 天河区 ' + getWeatherEmoji(next72[0].weather);
    }
    if (heroFeel)  heroFeel.textContent  = next72[0].feel + '℃';
    if (heroProb)  heroProb.textContent  = next72[0].rainProb + '%';
    if (heroWind)  heroWind.textContent  = next72[0].wind.toFixed(1) + ' km/h';
    if (heroUv)    heroUv.textContent    = '—';

    // 更新 72h 图表
    if (charts.hourly) {
      charts.hourly.setOption({
        series: [
          { name: '气温',     data: next72.map(x => x.temp) },
          { name: '湿度',     data: next72.map(x => x.humid) },
          { name: '降雨概率', data: next72.map(x => x.rainProb) },
        ]
      });
    }

    // 更新 KPI（基于 daily 数据）
    if (d && d.time.length > 0) {
      const allMax = d.temperature_2m_max.map(x => +x);
      const allMin = d.temperature_2m_min.map(x => +x);
      const allRain = d.precipitation_sum.map(x => +x);
      const avgMax  = (allMax.reduce((a, b) => a + b, 0) / allMax.length).toFixed(1);
      const avgMin  = (allMin.reduce((a, b) => a + b, 0) / allMin.length).toFixed(1);
      const totalRain = allRain.reduce((a, b) => a + b, 0).toFixed(1);
      animateKpiUpdate({ avgMax, avgMin, totalRain });
    }

    // 更新所有 charts
    flashPanels();
    startCountdown();
  }

  function getWeatherEmoji(type) {
    const map = { '晴':'☀','多云':'☁','阴':'☁','小雨':'🌦','中雨':'🌧','大雨':'🌧','阵雨':'🌦','雷暴':'⛈','暴雨':'⛈','未知':'☁' };
    return map[type] || '☁';
  }

  // ────────────────────────────────────────────────
  // 7. 全局 ECharts 图表实例注册（供外部调用）
  // ────────────────────────────────────────────────
  function registerCharts(chs) { charts = chs; }

  // ────────────────────────────────────────────────
  // 8. 初始化入口
  // ────────────────────────────────────────────────
  function init(data) {
    currentData = data;
    // 初始化预警滚动
    if (data.alerts && data.alerts.length > 0) {
      initAlertScroll(data.alerts);
    } else {
      // 无预警时显示提示
      const list = document.getElementById('alertList');
      if (list) {
        list.innerHTML = '<div style="text-align:center;padding-top:60px;color:#5ab4d8;font-size:14px;">当前无显著天气风险<br>建议持续监控</div>';
      }
    }

    // 启动倒计时
    startCountdown();
  }

  return { init, registerCharts, fetchLiveData, initAlertScroll };
})();

// ────────────────────────────────────────────────
// 页面加载完成后初始化
// ────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  if (window._dashboardInit) {
    window._dashboardInit();  // 由 HTML 中的内联脚本调用，传入 data
  }
});