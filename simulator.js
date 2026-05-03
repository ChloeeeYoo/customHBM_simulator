'use strict';

const BYTES_PER_TYPE = { FP32: 4, BF16: 2, FP16: 2, FP8: 1, INT8: 1, INT4: 0.5 };

class HBMSimulator {
  constructor(p) { this.p = p; }

  bytesPerParam() { return BYTES_PER_TYPE[this.p.dataType] || 2; }

  // ── Model Size ──────────────────────────────────────────────────────────────
  totalParams() {
    // Attention: Q,K,V,O = 4H²  |  FFN: up+down = 2*r*H²  (per layer)
    const { numLayers, hiddenDim, ffnRatio } = this.p;
    return numLayers * (4 + 2 * ffnRatio) * hiddenDim * hiddenDim;
  }

  paramsPerDevice() {
    // With TP: each TP rank holds 1/TP of each matrix
    // With PP: each stage holds numLayers/PP layers
    return this.totalParams() / (this.p.TP * this.p.PP);
  }

  // ── FLOPs ──────────────────────────────────────────────────────────────────
  // Full prefill FLOPs for one forward pass on one TP rank
  totalFLOPs() {
    const { numLayers, hiddenDim, ffnRatio, seqLen, batchSize, numHeads, TP, PP } = this.p;

    // Per token per layer:
    //   Attn projections (Q,K,V,O): 4 * 2 * H² = 8H²
    //   Attn scores (causal): 2 * H * S  (avg across seqlen)
    //   Attn weighted sum:    2 * H * S
    //   FFN (up+down):        2 * 2r * H² = 4r·H²
    const flopsPerTokenPerLayer =
      8 * hiddenDim * hiddenDim +
      4 * hiddenDim * seqLen +
      4 * ffnRatio * hiddenDim * hiddenDim;

    const totalFlops = (numLayers / PP) * seqLen * batchSize * flopsPerTokenPerLayer;
    return totalFlops / TP;
  }

  computeCycles() {
    const peakFLOPsPerCycle = this.p.numPE * this.p.macsPerPE * 2;
    return Math.ceil(this.totalFLOPs() / peakFLOPsPerCycle);
  }

  peakFLOPs() {
    return this.p.numPE * this.p.macsPerPE * 2 * this.p.clockFreqGHz * 1e9;
  }

  // ── HBM Bus Transaction ────────────────────────────────────────────────────
  hbmTxn(dataBytes) {
    const { clockFreqGHz, hbmLatencyNs, busWidthBits, burstLength } = this.p;
    const busBytes = busWidthBits / 8;
    const latencyCycles = Math.ceil(hbmLatencyNs * clockFreqGHz);
    const beatsNeeded = Math.ceil(dataBytes / busBytes);
    const burstsNeeded = Math.ceil(beatsNeeded / burstLength);
    const transferCycles = burstsNeeded * burstLength;
    const busEfficiency = beatsNeeded / (burstsNeeded * burstLength);
    const totalCycles = latencyCycles + transferCycles;
    return { latencyCycles, beatsNeeded, burstsNeeded, transferCycles, busEfficiency, totalCycles, dataBytes };
  }

  // ── SRAM Bus Transaction ───────────────────────────────────────────────────
  sramTxn(dataBytes) {
    const { clockFreqGHz, sramLatencyNs, busWidthBits } = this.p;
    const busBytes = busWidthBits / 8;
    const latencyCycles = Math.ceil(sramLatencyNs * clockFreqGHz);
    const transferCycles = Math.ceil(dataBytes / busBytes);
    const totalCycles = latencyCycles + transferCycles;
    return { latencyCycles, transferCycles, totalCycles, dataBytes };
  }

  // ── Network Transaction ────────────────────────────────────────────────────
  networkTxn(dataBytes) {
    const { clockFreqGHz, networkLatencyUs, networkBandwidthGBs } = this.p;
    const latencyCycles = Math.ceil(networkLatencyUs * 1000 * clockFreqGHz);
    const transferTimeS = dataBytes / (networkBandwidthGBs * 1e9);
    const transferCycles = Math.ceil(transferTimeS * clockFreqGHz * 1e9);
    return { latencyCycles, transferCycles, totalCycles: latencyCycles + transferCycles, dataBytes };
  }

  // ── Main Simulation ────────────────────────────────────────────────────────
  simulate() {
    const {
      numLayers, hiddenDim, ffnRatio, seqLen, batchSize, numHeads,
      TP, PP, DP, EP,
      clockFreqGHz, hbmBandwidthGBs, sramBandwidthGBs,
      numPE, macsPerPE, busWidthBits, burstLength
    } = this.p;

    const bytes = this.bytesPerParam();
    const headDim = hiddenDim / numHeads;
    const layersPerStage = numLayers / PP;

    // ── Data sizes ────────────────────────────────────────────────────────────

    // 1. Weight loading: HBM → SRAM (Inter-PE, one-time per inference)
    const weightBytes = this.paramsPerDevice() * bytes;

    // 2. KV cache (per layer per device, assume spill to HBM if needed)
    //    K,V for each head, full seqlen, batch
    const kvPerLayer = 2 * (numHeads / TP) * headDim * seqLen * batchSize * bytes;
    const kvTotalBytes = kvPerLayer * layersPerStage;

    // 3. Activation: batch × seq × hidden per layer (Intra-PE: SRAM ↔ compute)
    const activationPerLayer = batchSize * seqLen * hiddenDim * bytes;
    const activationTotal = activationPerLayer * layersPerStage * 2; // read + write

    // 4. TP AllReduce: after each layer's partial sums
    //    Ring-AllReduce ≈ 2 × data × (TP-1)/TP ≈ 2×data for large TP
    const tpAlReducePerLayer = TP > 1
      ? 2 * batchSize * seqLen * hiddenDim * bytes
      : 0;
    const tpTotalBytes = tpAlReducePerLayer * layersPerStage;

    // 5. PP send/recv: activation tensor at each stage boundary
    const ppBytes = PP > 1 ? batchSize * seqLen * hiddenDim * bytes : 0;

    // ── Transactions ──────────────────────────────────────────────────────────

    // Weight load (HBM → SRAM): one big contiguous transfer
    const weightTxn = this.hbmTxn(weightBytes);

    // KV cache traffic (HBM → SRAM per layer, if not fully resident)
    const kvTxn = this.hbmTxn(kvTotalBytes);

    // Activation traffic (SRAM ↔ compute, Intra-PE)
    const actTxn = this.sramTxn(activationTotal);

    // TP AllReduce (via network)
    const tpTxn = TP > 1 ? this.networkTxn(tpTotalBytes) : { totalCycles: 0, latencyCycles: 0, transferCycles: 0, dataBytes: 0 };

    // PP send/recv (via network)
    const ppTxn = PP > 1 ? this.networkTxn(ppBytes) : { totalCycles: 0, latencyCycles: 0, transferCycles: 0, dataBytes: 0 };

    // ── Cycle Accounting ─────────────────────────────────────────────────────

    const computeCycles = this.computeCycles();
    const hbmCycles = weightTxn.totalCycles + kvTxn.totalCycles;
    const sramCycles = actTxn.totalCycles;
    const networkCycles = tpTxn.totalCycles + ppTxn.totalCycles;
    const totalMemCycles = hbmCycles + sramCycles + networkCycles;

    // With compute-memory overlap (ideal pipelining): critical path
    const totalCycles = Math.max(computeCycles, totalMemCycles);

    // ── Performance Metrics ───────────────────────────────────────────────────

    const clockHz = clockFreqGHz * 1e9;
    const totalTimeS = totalCycles / clockHz;

    const totalHBMBytes = weightBytes + kvTotalBytes;
    const totalDataBytes = totalHBMBytes + activationTotal + tpTotalBytes + ppBytes;

    // Effective HBM bandwidth: bytes actually moved / time spent on HBM
    const hbmTimeS = hbmCycles / clockHz;
    const effectiveBWBs = hbmTimeS > 0 ? totalHBMBytes / hbmTimeS : 0;

    // Peak theoretical HBM bandwidth
    const peakBWBs = hbmBandwidthGBs * 1e9;
    const bwUtilization = effectiveBWBs / peakBWBs;

    // Bus efficiency (from weight transfer, largest txn)
    const busEfficiency = weightTxn.busEfficiency;

    // Arithmetic intensity (FLOPs / HBM bytes)
    const totalFLOPs = this.totalFLOPs();
    const arithmeticIntensity = totalHBMBytes > 0 ? totalFLOPs / totalHBMBytes : 0;

    // Ridge point (compute/memory balance threshold)
    const peakFLOPsPerSec = this.peakFLOPs();
    const ridgePoint = peakFLOPsPerSec / peakBWBs; // FLOPs/Byte

    // Bottleneck
    const computeTimeS = computeCycles / clockHz;
    const memTimeS = totalMemCycles / clockHz;
    let bottleneck;
    if (computeTimeS > memTimeS * 1.15) bottleneck = 'COMPUTE';
    else if (memTimeS > computeTimeS * 1.15) bottleneck = 'MEMORY';
    else bottleneck = 'BALANCED';

    const bottleneckRatio = bottleneck === 'COMPUTE'
      ? computeTimeS / memTimeS
      : bottleneck === 'MEMORY'
      ? memTimeS / computeTimeS
      : 1;

    // ── Format time ──────────────────────────────────────────────────────────
    const { value: timeValue, unit: timeUnit } = formatTime(totalTimeS);

    return {
      // Cycles
      totalCycles,
      computeCycles,
      hbmCycles,
      sramCycles,
      networkCycles,
      totalMemCycles,

      // Per-transaction detail
      weightTxn,
      kvTxn,
      actTxn,
      tpTxn,
      ppTxn,

      // Data volumes
      weightBytes,
      kvTotalBytes,
      activationTotal,
      tpTotalBytes,
      ppBytes,
      totalHBMBytes,
      totalDataBytes,

      // Performance
      totalTimeS,
      timeValue,
      timeUnit,
      computeTimeS,
      memTimeS,
      effectiveBWBs,
      peakBWBs,
      bwUtilization,
      busEfficiency,

      // FLOPs & roofline
      totalFLOPs,
      arithmeticIntensity,
      peakFLOPsPerSec,
      ridgePoint,

      // Bottleneck
      bottleneck,
      bottleneckRatio,

      // Model info
      totalParams: this.totalParams(),
      paramsPerDevice: this.paramsPerDevice(),
      layersPerStage,

      // Params echo
      params: this.p,
    };
  }
}

// ── Model Presets ────────────────────────────────────────────────────────────
const MODEL_PRESETS = {
  llama7b:   { numLayers: 32,  hiddenDim: 4096,  numHeads: 32,  ffnRatio: 2.67 },
  llama13b:  { numLayers: 40,  hiddenDim: 5120,  numHeads: 40,  ffnRatio: 2.67 },
  llama70b:  { numLayers: 80,  hiddenDim: 8192,  numHeads: 64,  ffnRatio: 2.67 },
  llama405b: { numLayers: 126, hiddenDim: 16384, numHeads: 128, ffnRatio: 1.3  },
  gpt3:      { numLayers: 96,  hiddenDim: 12288, numHeads: 96,  ffnRatio: 4    },
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function formatTime(s) {
  if (s >= 1)    return { value: s.toFixed(3),            unit: 's' };
  if (s >= 1e-3) return { value: (s * 1e3).toFixed(3),    unit: 'ms' };
  if (s >= 1e-6) return { value: (s * 1e6).toFixed(3),    unit: 'μs' };
  return { value: (s * 1e9).toFixed(3), unit: 'ns' };
}

function formatBytes(b) {
  if (b >= 1e12) return { value: (b / 1e12).toFixed(2), unit: 'TB' };
  if (b >= 1e9)  return { value: (b / 1e9).toFixed(2),  unit: 'GB' };
  if (b >= 1e6)  return { value: (b / 1e6).toFixed(2),  unit: 'MB' };
  if (b >= 1e3)  return { value: (b / 1e3).toFixed(2),  unit: 'KB' };
  return { value: b.toFixed(0), unit: 'B' };
}

function formatNumber(n) {
  if (n >= 1e15) return (n / 1e15).toFixed(2) + 'P';
  if (n >= 1e12) return (n / 1e12).toFixed(2) + 'T';
  if (n >= 1e9)  return (n / 1e9).toFixed(2) + 'G';
  if (n >= 1e6)  return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3)  return (n / 1e3).toFixed(2) + 'K';
  return n.toFixed(0);
}

function formatCycles(c) {
  if (c >= 1e12) return (c / 1e12).toFixed(2) + 'T';
  if (c >= 1e9)  return (c / 1e9).toFixed(2) + 'G';
  if (c >= 1e6)  return (c / 1e6).toFixed(2) + 'M';
  if (c >= 1e3)  return (c / 1e3).toFixed(1) + 'K';
  return c.toFixed(0);
}
