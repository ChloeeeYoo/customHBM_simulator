'use strict';

// Polyfill roundRect for older Safari
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    this.beginPath();
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
  };
}

let visualizer = null;
let lastResults = null;
let currentLevel = 'multipe';

// ── Initialization ─────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', () => {
  visualizer = new ArchVisualizer(document.getElementById('arch-svg-container'));
  document.getElementById('viz-placeholder').style.display = 'flex';

  // HBM computed BW listeners
  ['hbmDataRateGbps', 'hbmNumIO', 'numHBMBanks'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateHBMComputedBW);
  });
  updateHBMComputedBW();

  // PE hierarchy listeners
  ['pesPerMultiPE', 'multiPEsPerSiP', 'numSiPs'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', updateTotalPEs);
  });
  updateTotalPEs();

  // Component click handler (PE drill-down modal)
  window.onComponentClick = function(type, index, results) {
    openDetailModal(type, index, results);
  };
});

// ── PE Hierarchy ──────────────────────────────────────────────────────────

function updateTotalPEs() {
  const ppe  = parseInt(document.getElementById('pesPerMultiPE').value)  || 8;
  const mpe  = parseInt(document.getElementById('multiPEsPerSiP').value) || 16;
  const sips = parseInt(document.getElementById('numSiPs').value)        || 1;
  const total = ppe * mpe * sips;
  const el = document.getElementById('total-pes-display');
  if (el) {
    // e.g. "128  (8 PE × 16 mPE × 1 SiP)"
    el.textContent = total.toLocaleString()
      + '  (' + ppe + ' PE × ' + mpe + ' mPE × ' + sips + ' SiP)';
  }
}

// ── HBM Computed BW ────────────────────────────────────────────────────────

function updateHBMComputedBW() {
  const dataRate = parseFloat(document.getElementById('hbmDataRateGbps').value) || 6.4;
  const numIO = parseInt(document.getElementById('hbmNumIO').value) || 1024;
  const numBanks = parseInt(document.getElementById('numHBMBanks').value) || 4;
  const bwPerStack = dataRate * numIO / 8; // GB/s per stack
  const totalBW = bwPerStack * numBanks;
  const el = document.getElementById('hbm-computed-bw');
  if (el) {
    el.textContent = totalBW.toFixed(0) + ' GB/s';
  }
}

// ── Hierarchy Level ────────────────────────────────────────────────────────

function setHierarchyLevel(level) {
  currentLevel = level;
  document.querySelectorAll('.level-btn').forEach(b => b.classList.remove('active'));
  const btn = document.querySelector('[data-level="' + level + '"]');
  if (btn) btn.classList.add('active');
  if (lastResults) {
    const p = lastResults.params;
    visualizer.render(lastResults, p.numPE, p.numHBMBanks, level);
  }
}

// ── Input Reading ──────────────────────────────────────────────────────────

function readParams() {
  const g  = id => parseFloat(document.getElementById(id).value) || 0;
  const gi = id => parseInt(document.getElementById(id).value) || 1;
  const gs = id => document.getElementById(id).value;

  return {
    clockFreqGHz:        g('clockFreqGHz'),
    pesPerMultiPE:       gi('pesPerMultiPE'),
    multiPEsPerSiP:      gi('multiPEsPerSiP'),
    numSiPs:             gi('numSiPs'),
    numPE:               gi('pesPerMultiPE') * gi('multiPEsPerSiP') * gi('numSiPs'),
    macsPerPE:           gi('macsPerPE'),
    numHBMBanks:         gi('numHBMBanks'),
    dataType:            gs('dataType'),

    numLayers:           gi('numLayers'),
    hiddenDim:           gi('hiddenDim'),
    numHeads:            gi('numHeads'),
    ffnRatio:            g('ffnRatio'),
    seqLen:              gi('seqLen'),
    batchSize:           gi('batchSize'),

    TP:                  gi('TP'),
    PP:                  gi('PP'),
    DP:                  gi('DP'),
    EP:                  gi('EP'),

    hbmBandwidthGBs:     g('hbmBandwidthGBs'),
    hbmLatencyNs:        g('hbmLatencyNs'),
    hbmDataRateGbps:     g('hbmDataRateGbps'),
    hbmNumIO:            gi('hbmNumIO'),
    hbmCapPerDieGB:      g('hbmCapPerDieGB'),
    hbmNumStackDie:      gi('hbmNumStackDie'),

    sramBandwidthGBs:    g('sramBandwidthGBs'),
    sramLatencyNs:       g('sramLatencyNs'),
    sramCapacityMB:      g('sramCapacityMB'),
    sramNumBanks:        gi('sramNumBanks'),

    networkBandwidthGBs: g('networkBandwidthGBs'),
    networkLatencyUs:    g('networkLatencyUs'),

    busWidthBits:        gi('busWidthBits'),
    burstLength:         gi('burstLength'),
  };
}

// ── Simulation Run ─────────────────────────────────────────────────────────

function runSimulation() {
  const params = readParams();

  if (params.numHeads <= 0 || params.hiddenDim % params.numHeads !== 0) {
    alert('Hidden dim (' + params.hiddenDim + ') must be divisible by num heads (' + params.numHeads + ').');
    return;
  }
  if (params.numLayers % params.PP !== 0) {
    alert('Number of layers (' + params.numLayers + ') must be divisible by PP (' + params.PP + ').');
    return;
  }

  const sim = new HBMSimulator(params);
  const results = sim.simulate();
  lastResults = results;

  const placeholder = document.getElementById('viz-placeholder');
  if (placeholder) placeholder.style.display = 'none';

  visualizer.render(results, params.numPE, params.numHBMBanks, currentLevel);

  document.getElementById('flow-legend').classList.remove('hidden');

  updateBottleneckBanner(results);
  updateKeyMetrics(results);
  updateAnalysis(results);
  updateTransactions(results);
}

// ── Bottleneck Banner ──────────────────────────────────────────────────────

function updateBottleneckBanner(r) {
  const banner = document.getElementById('bottleneck-banner');
  const icon = document.getElementById('bn-icon');
  const title = document.getElementById('bn-title');
  const detail = document.getElementById('bn-detail');
  const ratio = document.getElementById('bn-ratio');

  banner.classList.remove('hidden', 'memory', 'compute', 'balanced');

  if (r.bottleneck === 'MEMORY') {
    banner.classList.add('memory');
    icon.textContent = '!';
    title.textContent = 'MEMORY BOTTLENECK';
    detail.textContent = 'HBM transfer dominates. Memory time ' + r.bottleneckRatio.toFixed(1) + 'x compute time. Consider increasing HBM BW, reducing model size, or using INT4/FP8.';
    ratio.textContent = 'mem/compute = ' + r.bottleneckRatio.toFixed(2) + 'x';
  } else if (r.bottleneck === 'COMPUTE') {
    banner.classList.add('compute');
    icon.textContent = '+';
    title.textContent = 'COMPUTE BOTTLENECK';
    detail.textContent = 'PE compute dominates. Compute time ' + r.bottleneckRatio.toFixed(1) + 'x memory time. Consider more PEs, higher frequency, or larger MAC arrays.';
    ratio.textContent = 'compute/mem = ' + r.bottleneckRatio.toFixed(2) + 'x';
  } else {
    banner.classList.add('balanced');
    icon.textContent = 'OK';
    title.textContent = 'BALANCED';
    detail.textContent = 'Compute and memory times are balanced (within 15%). Good utilization!';
    ratio.textContent = 'ratio ~ ' + r.bottleneckRatio.toFixed(2) + 'x';
  }
}

// ── Key Metrics ────────────────────────────────────────────────────────────

function updateKeyMetrics(r) {
  const metricsEl = document.getElementById('key-metrics');
  metricsEl.classList.remove('hidden');

  document.getElementById('v-total-cycles').textContent = formatCycles(r.totalCycles);
  document.getElementById('v-latency').textContent = formatCycles(r.weightTxn.latencyCycles);
  document.getElementById('v-burst').textContent = formatCycles(r.weightTxn.transferCycles);
  document.getElementById('v-bus-eff').textContent = (r.busEfficiency * 100).toFixed(1);

  const tv = r.timeValue, tu = r.timeUnit;
  document.getElementById('v-time').textContent = tv;
  document.getElementById('v-time-unit').textContent = tu;

  const bw = r.effectiveBWBs / 1e9;
  document.getElementById('v-eff-bw').textContent = bw.toFixed(1);

  const db = formatBytes(r.totalHBMBytes);
  document.getElementById('v-data').textContent = db.value;
  document.getElementById('v-data-unit').textContent = db.unit;
}

// ── Analysis Charts ────────────────────────────────────────────────────────

function updateAnalysis(r) {
  const roofCanvas = document.getElementById('rooflineCanvas');
  const breakCanvas = document.getElementById('breakdownCanvas');
  drawRoofline(roofCanvas, r);
  drawBreakdown(breakCanvas, r);
  renderDetailTable(r);
}

function renderDetailTable(r) {
  const container = document.getElementById('detail-table');
  const p = r.params;

  // Fix 3: Proper parameter and FLOPs formatting
  const sections = [
    {
      title: 'Model & Compute',
      rows: [
        ['Total Parameters',  (r.totalParams / 1e9).toFixed(2) + 'B (billion)'],
        ['Params / Device',   (r.paramsPerDevice / 1e9).toFixed(2) + 'B (billion)'],
        ['Total FLOPs',       (r.totalFLOPs / 1e12).toFixed(2) + ' TFLOPs'],
        ['Peak Compute',      (r.peakFLOPsPerSec / 1e12).toFixed(2) + ' TFLOPs/s'],
        ['Arith. Intensity',  r.arithmeticIntensity.toFixed(2) + ' FLOPs/Byte'],
        ['Ridge Point',       r.ridgePoint.toFixed(2) + ' FLOPs/Byte'],
        ['Compute Cycles',    formatCycles(r.computeCycles) + ' cycles'],
        ['Compute Time',      formatT(r.computeTimeS)],
      ]
    },
    {
      title: 'Memory Transactions',
      rows: [
        ['Weight Load (HBM->SRAM)', formatBytes(r.weightBytes).value + ' ' + formatBytes(r.weightBytes).unit],
        ['  Latency cycles',        formatCycles(r.weightTxn.latencyCycles) + ' cyc/txn'],
        ['  Burst transfer',        formatCycles(r.weightTxn.transferCycles) + ' cycles'],
        ['  Bursts needed',         r.weightTxn.burstsNeeded.toLocaleString()],
        ['  Beats needed',          r.weightTxn.beatsNeeded.toLocaleString()],
        ['  Bus efficiency',        (r.weightTxn.busEfficiency * 100).toFixed(1) + '%'],
        ['KV Cache (HBM)',          formatBytes(r.kvTotalBytes).value + ' ' + formatBytes(r.kvTotalBytes).unit],
        ['Activation (SRAM)',       formatBytes(r.activationTotal).value + ' ' + formatBytes(r.activationTotal).unit],
        ['Total HBM Bytes',         formatBytes(r.totalHBMBytes).value + ' ' + formatBytes(r.totalHBMBytes).unit],
        ['Total Data Moved',        formatBytes(r.totalDataBytes).value + ' ' + formatBytes(r.totalDataBytes).unit],
      ]
    },
    {
      title: 'Bandwidth',
      rows: [
        ['Peak HBM BW',       p.hbmBandwidthGBs + ' GB/s'],
        ['Effective HBM BW',  (r.effectiveBWBs / 1e9).toFixed(1) + ' GB/s'],
        ['BW Utilization',    (r.bwUtilization * 100).toFixed(1) + '%'],
        ['Bus Width',         p.busWidthBits + ' bits = ' + (p.busWidthBits / 8) + ' bytes'],
        ['Burst Length',      p.burstLength + ' beats'],
        ['Bytes/Burst',       ((p.busWidthBits / 8) * p.burstLength) + ' bytes'],
      ]
    },
    {
      title: 'Parallelism & Timing',
      rows: [
        ['Tensor Parallel',   'TP = ' + p.TP + (r.tpTotalBytes > 0 ? ' (AllReduce: ' + formatBytes(r.tpTotalBytes).value + ' ' + formatBytes(r.tpTotalBytes).unit + ')' : '')],
        ['Pipeline Parallel', 'PP = ' + p.PP + ', Layers/stage = ' + r.layersPerStage],
        ['Data Parallel',     'DP = ' + p.DP],
        ['Network Cycles',    formatCycles(r.networkCycles) + ' cycles'],
        ['HBM Cycles',        formatCycles(r.hbmCycles) + ' cycles'],
        ['SRAM Cycles',       formatCycles(r.sramCycles) + ' cycles'],
        ['Total Cycles',      formatCycles(r.totalCycles) + ' cycles'],
        ['Total Time',        r.timeValue + ' ' + r.timeUnit],
      ]
    },
  ];

  let html = '<div class="metrics-grid">';
  sections.forEach(s => {
    html += '<div>';
    html += '<div class="metric-section-title">' + s.title + '</div>';
    s.rows.forEach(function(row) {
      html += '<div class="metric-row">' +
        '<span class="metric-row-label">' + row[0] + '</span>' +
        '<span class="metric-row-value">' + row[1] + '</span>' +
        '</div>';
    });
    html += '</div>';
  });
  html += '</div>';
  container.innerHTML = html;
}

// ── Transactions Table ─────────────────────────────────────────────────────

function updateTransactions(r) {
  const timelineCanvas = document.getElementById('timelineCanvas');
  drawTimeline(timelineCanvas, r);

  const container = document.getElementById('txn-detail');
  const p = r.params;

  const txns = [
    {
      name: 'Weight Load', type: 'HBM', direction: 'HBM -> Control -> SRAM',
      bytes: r.weightBytes, latCyc: r.weightTxn.latencyCycles,
      txfCyc: r.weightTxn.transferCycles, total: r.weightTxn.totalCycles,
      eff: r.weightTxn.busEfficiency, bursts: r.weightTxn.burstsNeeded,
      bottleneck: r.bottleneck === 'MEMORY',
    },
    {
      name: 'KV Cache', type: 'HBM', direction: 'HBM -> Control -> SRAM',
      bytes: r.kvTotalBytes, latCyc: r.kvTxn.latencyCycles,
      txfCyc: r.kvTxn.transferCycles, total: r.kvTxn.totalCycles,
      eff: r.kvTxn.busEfficiency, bursts: r.kvTxn.burstsNeeded,
      bottleneck: false,
    },
    {
      name: 'Activation (R+W)', type: 'SRAM', direction: 'SRAM <-> MAC Array (Intra-PE)',
      bytes: r.activationTotal, latCyc: r.actTxn.latencyCycles,
      txfCyc: r.actTxn.transferCycles, total: r.actTxn.totalCycles,
      eff: null, bursts: null,
      bottleneck: false,
    },
    {
      name: 'Compute (MAC)', type: 'Compute', direction: 'MAC Array execution',
      bytes: r.totalFLOPs / 2, latCyc: 0,
      txfCyc: r.computeCycles, total: r.computeCycles,
      eff: null, bursts: null,
      bottleneck: r.bottleneck === 'COMPUTE',
    },
    {
      name: 'TP AllReduce', type: 'Network', direction: 'PE -> Network -> PE (ring)',
      bytes: r.tpTotalBytes, latCyc: r.tpTxn.latencyCycles,
      txfCyc: r.tpTxn.transferCycles, total: r.tpTxn.totalCycles,
      eff: null, bursts: null,
      bottleneck: false,
    },
    {
      name: 'PP Send/Recv', type: 'Network', direction: 'Stage N -> Stage N+1',
      bytes: r.ppBytes, latCyc: r.ppTxn.latencyCycles,
      txfCyc: r.ppTxn.transferCycles, total: r.ppTxn.totalCycles,
      eff: null, bursts: null,
      bottleneck: false,
    },
  ].filter(t => t.bytes > 0 || t.total > 0);

  const badgeClass = t =>
    t === 'HBM' ? 'txn-badge-hbm' :
    t === 'SRAM' ? 'txn-badge-sram' :
    t === 'Network' ? 'txn-badge-net' : 'txn-badge-compute';

  let html = '<table class="txn-table"><thead><tr>' +
    '<th>Transaction</th><th>Type</th><th>Path</th>' +
    '<th>Data</th><th>Lat. Cycles</th><th>Transfer Cycles</th>' +
    '<th>Total Cycles</th><th>Bus Eff.</th><th>Bursts</th>' +
    '</tr></thead><tbody>';

  txns.forEach(t => {
    const db = formatBytes(t.bytes);
    html += '<tr class="' + (t.bottleneck ? 'bottleneck-row' : '') + '">' +
      '<td>' + t.name + (t.bottleneck ? ' !' : '') + '</td>' +
      '<td><span class="txn-badge ' + badgeClass(t.type) + '">' + t.type + '</span></td>' +
      '<td style="font-size:11px;color:#64748b">' + t.direction + '</td>' +
      '<td>' + db.value + ' ' + db.unit + '</td>' +
      '<td>' + formatCycles(t.latCyc) + '</td>' +
      '<td>' + formatCycles(t.txfCyc) + '</td>' +
      '<td><strong>' + formatCycles(t.total) + '</strong></td>' +
      '<td>' + (t.eff !== null ? (t.eff * 100).toFixed(1) + '%' : '-') + '</td>' +
      '<td>' + (t.bursts !== null ? t.bursts.toLocaleString() : '-') + '</td>' +
      '</tr>';
  });

  html += '</tbody></table>';
  container.innerHTML = html;
}

// ── Detail Modal ───────────────────────────────────────────────────────────

function openDetailModal(type, index, results) {
  if (!results) return;
  const modal = document.getElementById('detail-modal');
  const titleEl = document.getElementById('detail-modal-title');
  const canvas = document.getElementById('detail-canvas');
  const statsEl = document.getElementById('detail-stats');
  const params = results.params;

  if (type === 'pe') {
    titleEl.textContent = 'PE ' + index + ' Internal Architecture';
  } else if (type === 'hbm') {
    titleEl.textContent = 'HBM Stack ' + index + ' Detail';
  } else if (type === 'ctrl') {
    titleEl.textContent = 'Control Unit Detail';
  } else if (type === 'dma') {
    titleEl.textContent = 'DMA Engine Detail';
  } else if (type === 'sip') {
    titleEl.textContent = 'SiP ' + index + ' Detail';
  } else if (type === 'multipe') {
    titleEl.textContent = 'Multi-PE ' + index + ' Detail';
  } else {
    titleEl.textContent = 'Component Detail';
  }

  modal.classList.remove('hidden');

  // Ensure canvas is sized after modal is visible
  requestAnimationFrame(() => {
    if (type === 'pe') {
      renderPEDetail(canvas, statsEl, index, results, params);
    } else if (type === 'hbm') {
      renderHBMDetail(canvas, statsEl, index, results, params);
    } else if (type === 'ctrl') {
      renderCtrlDetail(canvas, statsEl, results, params);
    } else if (type === 'dma') {
      renderDMADetail(canvas, statsEl, results, params);
    } else if (type === 'sip') {
      renderSiPDetail(canvas, statsEl, index, results, params);
    } else if (type === 'multipe') {
      renderMPEDetail(canvas, statsEl, index, results, params);
    }
  });
}

function closeDetailModal() {
  document.getElementById('detail-modal').classList.add('hidden');
}

// Close on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeDetailModal();
  if (e.key === 'Enter' && e.target.matches('input, select')) runSimulation();
});

// ── UI Controls ────────────────────────────────────────────────────────────

function toggleSection(id) {
  document.getElementById(id).classList.toggle('open');
}

function switchTab(tab, btn) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-pane').forEach(p => {
    p.classList.remove('active');
    p.classList.add('hidden');
  });
  btn.classList.add('active');
  const pane = document.getElementById('tab-' + tab);
  pane.classList.remove('hidden');
  pane.classList.add('active');

  if (lastResults) {
    if (tab === 'analysis') updateAnalysis(lastResults);
    if (tab === 'transactions') updateTransactions(lastResults);
  }
}

function toggleAnimation() {
  const enabled = document.getElementById('animToggle').checked;
  if (visualizer) visualizer.setAnimEnabled(enabled);
}

function updateAnimSpeed() {
  const speed = parseFloat(document.getElementById('animSpeed').value);
  if (visualizer) visualizer.setSpeed(speed);
}

function applyModelPreset() {
  const preset = document.getElementById('modelPreset').value;
  if (preset === 'custom' || !MODEL_PRESETS[preset]) return;
  const m = MODEL_PRESETS[preset];
  document.getElementById('numLayers').value = m.numLayers;
  document.getElementById('hiddenDim').value = m.hiddenDim;
  document.getElementById('numHeads').value = m.numHeads;
  document.getElementById('ffnRatio').value = m.ffnRatio;
}

function resetToDefaults() {
  document.getElementById('clockFreqGHz').value = 2.0;
  document.getElementById('pesPerMultiPE').value = 8;
  document.getElementById('multiPEsPerSiP').value = 16;
  document.getElementById('numSiPs').value = 1;
  document.getElementById('macsPerPE').value = 256;
  document.getElementById('numHBMBanks').value = 4;
  document.getElementById('dataType').value = 'BF16';
  document.getElementById('modelPreset').value = 'llama7b';
  applyModelPreset();
  document.getElementById('seqLen').value = 2048;
  document.getElementById('batchSize').value = 1;
  document.getElementById('TP').value = 1;
  document.getElementById('PP').value = 1;
  document.getElementById('DP').value = 1;
  document.getElementById('EP').value = 1;
  document.getElementById('hbmBandwidthGBs').value = 1000;
  document.getElementById('hbmLatencyNs').value = 100;
  document.getElementById('hbmDataRateGbps').value = 6.4;
  document.getElementById('hbmNumIO').value = 1024;
  document.getElementById('hbmCapPerDieGB').value = 2;
  document.getElementById('hbmNumStackDie').value = 8;
  document.getElementById('sramBandwidthGBs').value = 10000;
  document.getElementById('sramLatencyNs').value = 1;
  document.getElementById('sramCapacityMB').value = 16;
  document.getElementById('sramNumBanks').value = 16;
  document.getElementById('networkBandwidthGBs').value = 100;
  document.getElementById('networkLatencyUs').value = 1;
  document.getElementById('busWidthBits').value = 256;
  document.getElementById('burstLength').value = 8;
  updateHBMComputedBW();
  updateTotalPEs();
}

// ── Formatters ─────────────────────────────────────────────────────────────

function formatNum2(n) {
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T ';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'G ';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M ';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K ';
  return n.toFixed(0) + ' ';
}

function formatT(s) {
  const { value, unit } = formatTime(s);
  return value + ' ' + unit;
}
