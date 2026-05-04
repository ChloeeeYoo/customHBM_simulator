'use strict';

// ── Architecture SVG Visualizer ───────────────────────────────────────────────

class ArchVisualizer {
  constructor(container) {
    this.container = container;
    this.svg = null;
    this.packets = [];
    this.animating = false;
    this.animId = null;
    this.speedMult = 1;
    this.results = null;
    this.layout = null;
    this.paths = {};
    this.animPaths = [];
  }

  // Color palette
  C = {
    hbm:     { fill: '#fee2e2', stroke: '#ef4444', text: '#991b1b' },
    sram:    { fill: '#dbeafe', stroke: '#3b82f6', text: '#1e40af' },
    pe:      { fill: '#dcfce7', stroke: '#22c55e', text: '#166534' },
    mac:     { fill: '#bbf7d0', stroke: '#16a34a', text: '#14532d' },
    ctrl:    { fill: '#f3e8ff', stroke: '#a855f7', text: '#6b21a8' },
    dma:     { fill: '#fef9c3', stroke: '#ca8a04', text: '#713f12' },
    bus:     '#94a3b8',
    busHBM:  '#ef4444',
    busSRAM: '#3b82f6',
    busNet:  '#f59e0b',
    busCtrl: '#a855f7',
    bottleneck: '#ff3a3a',
  };

  render(simResults, numPE, numHBMBanks, level) {
    level = level || 'multipe';
    this.results = simResults;
    this.stopAnimation();
    const W = this.container.clientWidth || 780;

    this.container.innerHTML = '';
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('width', W);
    svg.classList.add('arch-svg');
    this.svg = svg;
    this.container.appendChild(svg);

    if (level === 'tray') {
      this._renderTrayLevel(svg, W, simResults);
      return;
    }
    if (level === 'sip') {
      this._renderSiPLevel(svg, W, simResults);
      return;
    }

    // Multi-PE level: shows 1 Multi-PE's internals
    // pesPerMPE = PEs shown in this view (not total numPE)
    const pesPerMPE = (simResults && simResults.params && simResults.params.pesPerMultiPE) || numPE || 8;
    this._buildLayout(W, pesPerMPE, numHBMBanks);

    // Dynamic SVG height: include base die header (80px) + μController footer (36px)
    const lastPE = this.layout.pe.get(this.layout.numPE - 1);
    const requiredH = lastPE.y + lastPE.h + 56; // 56 = μCtrl + UCIe label
    const H = Math.max(requiredH, 460);
    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    this.layout.H = H;

    this._renderDefs(svg);
    this._renderMultiPEFrame(svg, W, H, pesPerMPE, numHBMBanks, simResults);
    this._renderBusLines(svg);
    this._renderHBMBanks(svg, simResults);
    this._renderControlUnit(svg);
    this._renderPEArray(svg, pesPerMPE, simResults);
    this._renderLabels(svg, simResults);
    this._renderMultiPEFooter(svg, W, H, simResults);

    this.packets = [];
    this._buildPacketPaths(pesPerMPE, numHBMBanks);
    if (simResults) this._spawnInitialPackets(simResults, pesPerMPE);
    this.startAnimation();
  }

  // ── Multi-PE outer frame + labels ─────────────────────────────────────────
  _renderMultiPEFrame(svg, W, H, pesPerMPE, numHBMBanks, results) {
    const g = this._el('g', { id: 'multipe-frame' });
    const p = results && results.params;

    // Outer Multi-PE boundary
    g.appendChild(this._el('rect', {
      x: 6, y: 6, width: W - 12, height: H - 12,
      rx: 14, fill: 'none', stroke: '#22c55e', 'stroke-width': 2,
      'stroke-dasharray': '8 4', opacity: 0.5,
    }));

    // Title tag
    const tag = this._el('text', {
      x: 20, y: 18,
      'font-size': 11, 'font-weight': '700', fill: '#166534',
    });
    tag.textContent = '1× Multi-PE';
    g.appendChild(tag);

    // UCIe-A bus bar (between base die and PE array)
    const ctrl = this.layout.ctrl;
    const busY = ctrl.y + ctrl.h + 18;
    g.appendChild(this._el('rect', {
      x: 16, y: busY, width: W - 32, height: 10,
      rx: 5, fill: '#dbeafe', stroke: '#3b82f6', 'stroke-width': 1.5,
    }));
    const busLbl = this._el('text', {
      x: W / 2, y: busY + 7.5,
      'text-anchor': 'middle', 'font-size': 8, 'font-weight': '700', fill: '#1e40af',
    });
    busLbl.textContent = 'UCIe-A Internal Bus';
    g.appendChild(busLbl);

    svg.insertBefore(g, svg.firstChild);
  }

  // μController + UCIe-A external label at bottom
  _renderMultiPEFooter(svg, W, H, results) {
    const g = this._el('g', { id: 'multipe-footer' });

    // μController box
    const mcW = 140, mcH = 28;
    const mcX = (W - mcW) / 2;
    const mcY = H - 42;
    g.appendChild(this._el('rect', {
      x: mcX, y: mcY, width: mcW, height: mcH,
      rx: 6, fill: '#f3e8ff', stroke: '#a855f7', 'stroke-width': 1.5,
    }));
    const mcLbl = this._el('text', {
      x: mcX + mcW / 2, y: mcY + 11,
      'text-anchor': 'middle', 'font-size': 10, 'font-weight': '700', fill: '#6b21a8',
    });
    mcLbl.textContent = 'μController';
    g.appendChild(mcLbl);
    const mcSub = this._el('text', {
      x: mcX + mcW / 2, y: mcY + 22,
      'text-anchor': 'middle', 'font-size': 8, fill: '#6b21a8', opacity: 0.8,
    });
    mcSub.textContent = 'task dispatch · sync';
    g.appendChild(mcSub);

    // UCIe-A external arrow (left side)
    const arrY = mcY + mcH / 2;
    g.appendChild(this._el('line', {
      x1: 14, y1: arrY, x2: mcX - 6, y2: arrY,
      stroke: '#3b82f6', 'stroke-width': 1.5, 'stroke-dasharray': '5 3',
      'marker-end': 'url(#arrow-blue)',
    }));
    const extLbl = this._el('text', {
      x: 12, y: arrY - 4,
      'font-size': 8, fill: '#1e40af', 'text-anchor': 'start',
    });
    extLbl.textContent = 'UCIe-A → other mPEs';
    g.appendChild(extLbl);

    // numSiPs / hierarchy summary (top-right corner)
    const p = results && results.params;
    if (p) {
      const summary = [
        `${p.pesPerMultiPE} PE × ${p.multiPEsPerSiP} mPE × ${p.numSiPs} SiP`,
        `= ${p.numPE} total PEs`,
      ];
      summary.forEach((line, i) => {
        const t = this._el('text', {
          x: W - 10, y: H - 32 + i * 12,
          'text-anchor': 'end', 'font-size': 9, fill: '#64748b',
        });
        t.textContent = line;
        g.appendChild(t);
      });
    }

    svg.appendChild(g);
  }

  // ── Tray Level ────────────────────────────────────────────────────────────
  _renderTrayLevel(svg, W, results) {
    const numSiPs = (results && results.params && results.params.numSiPs) || 6;
    const multiPEsPerSiP = (results && results.params && results.params.multiPEsPerSiP) || 16;
    const pesPerMPE = (results && results.params && results.params.pesPerMultiPE) || 8;

    // Compute height dynamically from content
    const _cols = Math.min(numSiPs, 3);
    const _rows = Math.ceil(numSiPs / _cols);
    const _cpuY = 44 + _rows * (110 + 14) + 14;
    const H = _cpuY + 52 + 14 + 30; // cpuY + cpuH + legPad + bottomPad

    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const g = this._el('g');

    // Background
    const bg = this._el('rect', { x: 0, y: 0, width: W, height: H, fill: '#f8fafc' });
    g.appendChild(bg);

    const title = this._el('text', {
      x: W / 2, y: 24, 'text-anchor': 'middle',
      'font-size': 13, 'font-weight': '700', fill: '#1e293b',
    });
    title.textContent = `Compute Tray: ${numSiPs} SiP + CPU + Network Card  (${numSiPs * multiPEsPerSiP * pesPerMPE} total PEs)`;
    g.appendChild(title);

    // SiP boxes: up to 6, arranged in 2 or 3 columns
    const cols = Math.min(numSiPs, 3), rows = Math.ceil(numSiPs / cols);
    const sipW = Math.min(160, (W - 80) / cols - 14);
    const sipH = 110;
    const totalW = cols * (sipW + 14) - 14;
    const startX = (W - totalW) / 2;
    const startY = 44;
    const sipPositions = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const idx = r * cols + c;
        if (idx >= numSiPs) break;
        const x = startX + c * (sipW + 14);
        const y = startY + r * (sipH + 14);
        sipPositions.push({ x, y, cx: x + sipW / 2, cy: y + sipH / 2 });

        // SiP outer box
        const sipG = this._el('g');
        sipG.style.cursor = 'pointer';
        sipG.addEventListener('click', () => {
          if (window.onComponentClick) window.onComponentClick('sip', idx, results);
        });
        sipG.appendChild(this._el('rect', {
          x, y, width: sipW, height: sipH,
          rx: 8, fill: '#dbeafe', stroke: '#3b82f6', 'stroke-width': 2,
        }));
        const lbl = this._el('text', {
          x: x + sipW / 2, y: y + 16,
          'text-anchor': 'middle', 'font-size': 11, 'font-weight': '700', fill: '#1e40af',
        });
        lbl.textContent = `SiP ${idx}  (${multiPEsPerSiP * pesPerMPE} PE)`;
        sipG.appendChild(lbl);

        // Mini PE grid inside SiP
        const miniCols = 4, miniRows = 2;
        const mW = (sipW - 20) / miniCols - 3;
        const mH = (sipH - 38) / miniRows - 3;
        for (let mr = 0; mr < miniRows; mr++) {
          for (let mc = 0; mc < miniCols; mc++) {
            sipG.appendChild(this._el('rect', {
              x: x + 10 + mc * (mW + 3),
              y: y + 26 + mr * (mH + 3),
              width: mW, height: mH,
              rx: 3, fill: '#bbf7d0', stroke: '#22c55e', 'stroke-width': 1,
            }));
          }
        }
        g.appendChild(sipG);
      }
    }

    // CPU box
    const cpuX = 20, cpuY = startY + rows * (sipH + 14) + 14;
    const cpuW = 140, cpuH = 52;
    g.appendChild(this._el('rect', {
      x: cpuX, y: cpuY, width: cpuW, height: cpuH,
      rx: 7, fill: '#f3e8ff', stroke: '#a855f7', 'stroke-width': 2,
    }));
    const cpuLbl = this._el('text', {
      x: cpuX + cpuW / 2, y: cpuY + 20,
      'text-anchor': 'middle', 'font-size': 11, 'font-weight': '700', fill: '#6b21a8',
    });
    cpuLbl.textContent = 'Host CPU';
    g.appendChild(cpuLbl);
    const cpuSub = this._el('text', {
      x: cpuX + cpuW / 2, y: cpuY + 34,
      'text-anchor': 'middle', 'font-size': 9, fill: '#6b21a8', opacity: 0.8,
    });
    cpuSub.textContent = 'PCIe / UALink';
    g.appendChild(cpuSub);

    // Network Card box
    const nicX = W - 160, nicY = cpuY;
    const nicW = 140, nicH = 52;
    g.appendChild(this._el('rect', {
      x: nicX, y: nicY, width: nicW, height: nicH,
      rx: 7, fill: '#fef9c3', stroke: '#ca8a04', 'stroke-width': 2,
    }));
    const nicLbl = this._el('text', {
      x: nicX + nicW / 2, y: nicY + 20,
      'text-anchor': 'middle', 'font-size': 11, 'font-weight': '700', fill: '#713f12',
    });
    nicLbl.textContent = 'Network Card';
    g.appendChild(nicLbl);
    const nicSub = this._el('text', {
      x: nicX + nicW / 2, y: nicY + 34,
      'text-anchor': 'middle', 'font-size': 9, fill: '#713f12', opacity: 0.8,
    });
    nicSub.textContent = '400G Ethernet';
    g.appendChild(nicSub);

    // All-to-all UALink connections between SiPs
    for (let a = 0; a < sipPositions.length; a++) {
      for (let b = a + 1; b < sipPositions.length; b++) {
        g.appendChild(this._el('line', {
          x1: sipPositions[a].cx, y1: sipPositions[a].cy,
          x2: sipPositions[b].cx, y2: sipPositions[b].cy,
          stroke: '#94a3b8', 'stroke-width': 1, opacity: 0.4,
          'stroke-dasharray': '4 3',
        }));
      }
    }

    // CPU to SiPs
    sipPositions.forEach(sp => {
      g.appendChild(this._el('line', {
        x1: cpuX + cpuW / 2, y1: cpuY,
        x2: sp.cx, y2: sp.cy + sipH / 2,
        stroke: '#a855f7', 'stroke-width': 1.5, opacity: 0.5,
        'stroke-dasharray': '5 3',
      }));
    });

    // NIC to SiPs
    sipPositions.forEach(sp => {
      g.appendChild(this._el('line', {
        x1: nicX, y1: nicY + nicH / 2,
        x2: sp.cx, y2: sp.cy + sipH / 2,
        stroke: '#ca8a04', 'stroke-width': 1.5, opacity: 0.5,
        'stroke-dasharray': '5 3',
      }));
    });

    // Legend
    const legY = cpuY + cpuH + 12;
    const legItems = [
      { color: '#3b82f6', label: 'SiP (System-in-Package): 8 mPEs + HBM' },
      { color: '#94a3b8', label: 'UALink (All-to-All, 256GB/s)' },
      { color: '#a855f7', label: 'PCIe Gen5 (CPU↔SiP)' },
    ];
    legItems.forEach((item, i) => {
      const lx = 20 + i * Math.floor((W - 40) / legItems.length);
      g.appendChild(this._el('rect', {
        x: lx, y: legY + 4, width: 14, height: 6,
        fill: item.color, rx: 2, opacity: 0.8,
      }));
      const lt = this._el('text', {
        x: lx + 18, y: legY + 12, 'font-size': 10, fill: '#475569',
      });
      lt.textContent = item.label;
      g.appendChild(lt);
    });

    svg.appendChild(g);
  }

  // ── SiP Level ─────────────────────────────────────────────────────────────
  _renderSiPLevel(svg, W, results) {
    const multiPEsPerSiP = (results && results.params && results.params.multiPEsPerSiP) || 16;
    const pesPerMPE = (results && results.params && results.params.pesPerMultiPE) || 8;
    const gridCols = Math.ceil(Math.sqrt(multiPEsPerSiP));
    const gridRows = Math.ceil(multiPEsPerSiP / gridCols);
    const numIODie = Math.ceil(multiPEsPerSiP / 8);

    // Reserve right margin for IO Dies
    const ioDieW = 68, ioDieH = 28, ioDieGap = 16;
    const mpeW = Math.min(100, (W - ioDieW - ioDieGap * 2 - 60) / gridCols - 14);
    const mpeH = 80;
    const gapX = 14, gapY = 14;
    const totalGridW = gridCols * (mpeW + gapX) - gapX;
    const totalGridH = gridRows * (mpeH + gapY) - gapY;
    const gridStartX = Math.max(20, (W - totalGridW - ioDieW - ioDieGap) / 2);
    const gridStartY = 38;

    // Dynamic height: grid + legend padding
    const legY = gridStartY + totalGridH + 18;
    const H = legY + 30;

    svg.setAttribute('height', H);
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);

    const g = this._el('g');

    const bg = this._el('rect', { x: 0, y: 0, width: W, height: H, fill: '#f8fafc' });
    g.appendChild(bg);

    const title = this._el('text', {
      x: W / 2, y: 22, 'text-anchor': 'middle',
      'font-size': 13, 'font-weight': '700', fill: '#1e293b',
    });
    title.textContent = `SiP Level: ${gridCols}×${gridRows} Multi-PE Grid + ${numIODie} IO-Die (1/8 mPE) + 2D Mesh  (${multiPEsPerSiP * pesPerMPE} PEs total)`;
    g.appendChild(title);

    // mPE positions
    const mpePos = [];
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const idx = r * gridCols + c;
        const x = gridStartX + c * (mpeW + gapX);
        const y = gridStartY + r * (mpeH + gapY);
        mpePos.push({ x, y, cx: x + mpeW / 2, cy: y + mpeH / 2 });
      }
    }

    // 2D mesh connections (horizontal + vertical)
    for (let r = 0; r < gridRows; r++) {
      for (let c = 0; c < gridCols; c++) {
        const idx = r * gridCols + c;
        // Right neighbor
        if (c < gridCols - 1) {
          const nb = idx + 1;
          g.appendChild(this._el('line', {
            x1: mpePos[idx].x + mpeW, y1: mpePos[idx].cy,
            x2: mpePos[nb].x, y2: mpePos[nb].cy,
            stroke: '#3b82f6', 'stroke-width': 2, opacity: 0.6,
          }));
        }
        // Bottom neighbor
        if (r < gridRows - 1) {
          const nb = idx + gridCols;
          g.appendChild(this._el('line', {
            x1: mpePos[idx].cx, y1: mpePos[idx].y + mpeH,
            x2: mpePos[nb].cx, y2: mpePos[nb].y,
            stroke: '#3b82f6', 'stroke-width': 2, opacity: 0.6,
          }));
        }
      }
    }

    // Draw each mPE box (only up to multiPEsPerSiP)
    mpePos.slice(0, multiPEsPerSiP).forEach((mp, idx) => {
      const mpeG = this._el('g');
      mpeG.appendChild(this._el('rect', {
        x: mp.x, y: mp.y, width: mpeW, height: mpeH,
        rx: 6, fill: '#dcfce7', stroke: '#22c55e', 'stroke-width': 2,
      }));
      // Clickable: zoom into this mPE
      mpeG.style.cursor = 'pointer';
      mpeG.addEventListener('click', () => {
        if (window.onComponentClick) window.onComponentClick('multipe', idx, results);
        else { if (typeof setHierarchyLevel === 'function') setHierarchyLevel('multipe'); }
      });
      mpeG.addEventListener('mouseenter', () => { mpeG.style.filter = 'brightness(0.93)'; });
      mpeG.addEventListener('mouseleave', () => { mpeG.style.filter = ''; });

      const lbl = this._el('text', {
        x: mp.cx, y: mp.y + 14,
        'text-anchor': 'middle', 'font-size': 10, 'font-weight': '700', fill: '#166534',
      });
      lbl.textContent = `mPE ${idx}  (${pesPerMPE} PE)`;
      mpeG.appendChild(lbl);

      // HBM indicator
      mpeG.appendChild(this._el('rect', {
        x: mp.x + 8, y: mp.y + 20, width: mpeW - 16, height: 14,
        rx: 3, fill: '#fee2e2', stroke: '#ef4444', 'stroke-width': 1,
      }));
      const hbmLbl = this._el('text', {
        x: mp.cx, y: mp.y + 30,
        'text-anchor': 'middle', 'font-size': 8, fill: '#991b1b',
      });
      hbmLbl.textContent = 'HBM';
      mpeG.appendChild(hbmLbl);

      // SRAM indicator
      mpeG.appendChild(this._el('rect', {
        x: mp.x + 8, y: mp.y + 38, width: mpeW - 16, height: 14,
        rx: 3, fill: '#dbeafe', stroke: '#3b82f6', 'stroke-width': 1,
      }));
      const sramLbl = this._el('text', {
        x: mp.cx, y: mp.y + 48,
        'text-anchor': 'middle', 'font-size': 8, fill: '#1e40af',
      });
      sramLbl.textContent = 'SRAM';
      mpeG.appendChild(sramLbl);

      // MAC indicator
      mpeG.appendChild(this._el('rect', {
        x: mp.x + 8, y: mp.y + 56, width: mpeW - 16, height: 14,
        rx: 3, fill: '#bbf7d0', stroke: '#16a34a', 'stroke-width': 1,
      }));
      const macLbl = this._el('text', {
        x: mp.cx, y: mp.y + 66,
        'text-anchor': 'middle', 'font-size': 8, fill: '#14532d',
      });
      macLbl.textContent = 'MAC Array';
      mpeG.appendChild(macLbl);

      g.appendChild(mpeG);
    });

    // IO-Die boxes: 1 per 8 mPEs, stacked on the right side of the grid
    const ioDieX = gridStartX + totalGridW + ioDieGap;
    for (let d = 0; d < numIODie; d++) {
      const startMPE = d * 8;
      const endMPE = Math.min((d + 1) * 8 - 1, multiPEsPerSiP - 1);
      const groupMPEs = mpePos.slice(startMPE, endMPE + 1);

      const groupMinY = Math.min(...groupMPEs.map(m => m.y));
      const groupMaxY = Math.max(...groupMPEs.map(m => m.y + mpeH));
      const ioDieCY = (groupMinY + groupMaxY) / 2;
      const ioDieY = ioDieCY - ioDieH / 2;

      // Connection lines from each mPE right edge to IO-Die
      groupMPEs.forEach(mp => {
        g.appendChild(this._el('line', {
          x1: mp.x + mpeW, y1: mp.cy,
          x2: ioDieX, y2: ioDieCY,
          stroke: '#ca8a04', 'stroke-width': 1.2, opacity: 0.65,
          'stroke-dasharray': '4 2',
        }));
      });

      // IO-Die box
      g.appendChild(this._el('rect', {
        x: ioDieX, y: ioDieY, width: ioDieW, height: ioDieH,
        rx: 5, fill: '#fef9c3', stroke: '#ca8a04', 'stroke-width': 1.5,
      }));
      const lt = this._el('text', {
        x: ioDieX + ioDieW / 2, y: ioDieY + 11,
        'text-anchor': 'middle', 'font-size': 9, 'font-weight': '700', fill: '#713f12',
      });
      lt.textContent = `IO-Die ${d}`;
      g.appendChild(lt);
      const ls = this._el('text', {
        x: ioDieX + ioDieW / 2, y: ioDieY + 21,
        'text-anchor': 'middle', 'font-size': 8, fill: '#92400e', opacity: 0.85,
      });
      ls.textContent = `mPE ${startMPE}–${endMPE}`;
      g.appendChild(ls);
    }

    // Legend
    const legItems = [
      { color: '#22c55e', label: 'mPE (Multi-PE element)' },
      { color: '#3b82f6', label: '2D Mesh bus (256GB/s)' },
      { color: '#ca8a04', label: `IO-Die (1 per 8 mPE, ${numIODie} total)` },
    ];
    legItems.forEach((item, i) => {
      const lx = 20 + i * Math.floor((W - 40) / legItems.length);
      g.appendChild(this._el('rect', {
        x: lx, y: legY, width: 14, height: 6,
        fill: item.color, rx: 2, opacity: 0.8,
      }));
      const lt = this._el('text', {
        x: lx + 18, y: legY + 8, 'font-size': 10, fill: '#475569',
      });
      lt.textContent = item.label;
      g.appendChild(lt);
    });

    svg.appendChild(g);
  }

  _buildLayout(W, numPE, numHBMBanks) {
    const hbmH = 52, hbmW = Math.min(100, (W - 60) / numHBMBanks - 10);
    const hbmCount = numHBMBanks;
    const totalHBMW = hbmCount * (hbmW + 8) - 8;
    const hbmStartX = (W - totalHBMW) / 2;

    const ctrlW = 240, ctrlH = 50;
    const ctrlX = (W - ctrlW) / 2;
    const ctrlY = 90 + hbmH;

    const peCols = Math.min(numPE, Math.ceil(Math.sqrt(numPE * 1.5)));
    const peRows = Math.ceil(numPE / peCols);
    const peW = Math.min(130, (W - 40) / peCols - 10);
    const peH = 178; // DMA(22) + gap(12) + SRAM(40) + gap(14) + MAC(≥40) + padding
    const totalPEW = peCols * (peW + 10) - 10;
    const peStartX = (W - totalPEW) / 2;
    const peStartY = ctrlY + ctrlH + 55;

    this.layout = {
      W, numPE,
      hbm: {
        banks: Array.from({ length: numHBMBanks }, (_, i) => ({
          x: hbmStartX + i * (hbmW + 8), y: 18, w: hbmW, h: hbmH,
          cx: hbmStartX + i * (hbmW + 8) + hbmW / 2, cy: 18 + hbmH,
        }))
      },
      ctrl: { x: ctrlX, y: ctrlY, w: ctrlW, h: ctrlH, cx: ctrlX + ctrlW / 2, cy: ctrlY + ctrlH / 2 },
      pe: {
        cols: peCols, rows: peRows, w: peW, h: peH,
        startX: peStartX, startY: peStartY,
        get: (i) => {
          const col = i % peCols;
          const row = Math.floor(i / peCols);
          const x = peStartX + col * (peW + 10);
          const y = peStartY + row * (peH + 10);
          return { x, y, w: peW, h: peH, cx: x + peW / 2 };
        }
      }
    };
  }

  _renderDefs(svg) {
    const defs = this._el('defs');
    const markers = [
      { id: 'arrow-gray',   color: '#94a3b8' },
      { id: 'arrow-red',    color: '#ef4444' },
      { id: 'arrow-blue',   color: '#3b82f6' },
      { id: 'arrow-amber',  color: '#f59e0b' },
      { id: 'arrow-purple', color: '#a855f7' },
    ];
    markers.forEach(({ id, color }) => {
      const m = this._el('marker', { id, markerWidth: 8, markerHeight: 6,
        refX: 6, refY: 3, orient: 'auto' });
      const poly = this._el('polygon', { points: '0 0, 8 3, 0 6', fill: color });
      m.appendChild(poly);
      defs.appendChild(m);
    });
    const filter = this._el('filter', { id: 'glow' });
    const blur = this._el('feGaussianBlur', { stdDeviation: '3', result: 'coloredBlur' });
    const merge = this._el('feMerge');
    ['coloredBlur', 'SourceGraphic'].forEach(n => {
      const node = this._el('feMergeNode');
      if (n !== 'SourceGraphic') node.setAttribute('in', n);
      merge.appendChild(node);
    });
    filter.appendChild(blur);
    filter.appendChild(merge);
    defs.appendChild(filter);
    svg.appendChild(defs);
  }

  _renderBusLines(svg) {
    const l = this.layout;
    const g = this._el('g', { id: 'bus-lines', opacity: 0.6 });

    l.hbm.banks.forEach((bank, bi) => {
      const midY = bank.cy + (l.ctrl.y - bank.cy) * 0.45;
      const path = `M ${bank.cx} ${bank.cy} L ${bank.cx} ${midY} L ${l.ctrl.cx} ${l.ctrl.y}`;
      g.appendChild(this._el('path', {
        d: path, fill: 'none',
        stroke: '#ef4444', 'stroke-width': 1.5,
        'stroke-dasharray': '5 3',
        'marker-end': 'url(#arrow-red)',
      }));
    });

    for (let i = 0; i < l.numPE; i++) {
      const pe = l.pe.get(i);
      const startY = l.ctrl.y + l.ctrl.h;
      const endY = pe.y + 10;
      const midY = startY + (endY - startY) * 0.5;
      const path = `M ${l.ctrl.cx} ${startY} C ${l.ctrl.cx} ${midY}, ${pe.cx} ${midY}, ${pe.cx} ${endY}`;
      g.appendChild(this._el('path', {
        d: path, fill: 'none',
        stroke: '#a855f7', 'stroke-width': 1.5,
        'stroke-dasharray': '5 3',
        'marker-end': 'url(#arrow-purple)',
      }));
      this.paths[`ctrl_to_pe${i}`] = path;
    }

    svg.appendChild(g);
    l.hbm.banks.forEach((bank, bi) => {
      const midY = bank.cy + (l.ctrl.y - bank.cy) * 0.45;
      this.paths[`hbm${bi}_to_ctrl`] = `M ${bank.cx} ${bank.cy} L ${bank.cx} ${midY} L ${l.ctrl.cx} ${l.ctrl.y}`;
    });
  }

  _renderHBMBanks(svg, results) {
    const g = this._el('g', { id: 'hbm-group' });
    const C = this.C.hbm;
    this.layout.hbm.banks.forEach((bank, i) => {
      const bankG = this._el('g', { id: `hbm-bank-${i}` });

      const stack = this._el('rect', {
        x: bank.x + 3, y: bank.y + 3, width: bank.w, height: bank.h,
        rx: 7, fill: '#fecaca', stroke: '#ef4444', 'stroke-width': 1,
      });
      bankG.appendChild(stack);
      const rect = this._el('rect', {
        x: bank.x, y: bank.y, width: bank.w, height: bank.h,
        rx: 7, fill: C.fill, stroke: C.stroke, 'stroke-width': 2,
      });
      bankG.appendChild(rect);

      const title = this._el('text', {
        x: bank.x + bank.w / 2, y: bank.y + 18,
        'text-anchor': 'middle', 'font-size': 11, 'font-weight': '700',
        fill: C.text,
      });
      title.textContent = `HBM ${i}`;
      bankG.appendChild(title);

      const bw = this._el('text', {
        x: bank.x + bank.w / 2, y: bank.y + 30,
        'text-anchor': 'middle', 'font-size': 9, fill: C.text, opacity: 0.8,
      });
      const hbmBW = results?.params?.hbmBandwidthGBs || 0;
      bw.textContent = `BW: ${Math.round(hbmBW / this.layout.hbm.banks.length)} GB/s`;
      bankG.appendChild(bw);

      for (let j = 0; j < 4; j++) {
        bankG.appendChild(this._el('rect', {
          x: bank.x + 8, y: bank.y + 38 + j * 3, width: bank.w - 16, height: 1.5,
          fill: '#ef4444', opacity: 0.25, rx: 1,
        }));
      }

      // Make HBM clickable
      bankG.style.cursor = 'pointer';
      const self = this;
      const bankIdx = i;
      bankG.addEventListener('click', () => {
        if (window.onComponentClick) window.onComponentClick('hbm', bankIdx, self.results);
      });
      bankG.addEventListener('mouseenter', () => { bankG.style.filter = 'brightness(0.93)'; });
      bankG.addEventListener('mouseleave', () => { bankG.style.filter = ''; });

      g.appendChild(bankG);
    });

    const lbl = this._el('text', {
      x: this.layout.hbm.banks[0].x - 8,
      y: this.layout.hbm.banks[0].y + 26,
      'text-anchor': 'end', 'font-size': 10, 'font-weight': '700',
      fill: '#ef4444', opacity: 0.7,
    });
    lbl.textContent = 'HBM';
    g.appendChild(lbl);
    svg.appendChild(g);
  }

  _renderControlUnit(svg) {
    const g = this._el('g', { id: 'ctrl-group' });
    const { ctrl } = this.layout;
    const C = this.C;

    // Single full-width Control Unit (DMA is inside each PE)
    g.appendChild(this._el('rect', {
      x: ctrl.x, y: ctrl.y, width: ctrl.w, height: ctrl.h,
      rx: 9, fill: C.ctrl.fill, stroke: C.ctrl.stroke, 'stroke-width': 2,
    }));

    const ctrlLbl = this._el('text', {
      x: ctrl.x + ctrl.w / 2, y: ctrl.y + ctrl.h / 2 - 5,
      'text-anchor': 'middle', 'font-size': 12, 'font-weight': '700', fill: C.ctrl.text,
    });
    ctrlLbl.textContent = 'Control Unit';
    g.appendChild(ctrlLbl);

    const ctrlSub = this._el('text', {
      x: ctrl.x + ctrl.w / 2, y: ctrl.y + ctrl.h / 2 + 9,
      'text-anchor': 'middle', 'font-size': 9, fill: C.ctrl.text, opacity: 0.8,
    });
    ctrlSub.textContent = 'dispatch · arbiter · sync · fence · route';
    g.appendChild(ctrlSub);

    g.style.cursor = 'pointer';
    g.addEventListener('click', () => {
      if (window.onComponentClick) window.onComponentClick('ctrl', 0, this.results);
    });
    g.addEventListener('mouseenter', () => { g.style.filter = 'brightness(0.93)'; });
    g.addEventListener('mouseleave', () => { g.style.filter = ''; });

    svg.appendChild(g);
  }

  _renderPEArray(svg, numPE, results) {
    const g = this._el('g', { id: 'pe-group' });
    const C = this.C;

    for (let i = 0; i < this.layout.numPE; i++) {
      const pe = this.layout.pe.get(i);
      const peG = this._el('g', { id: `pe-${i}` });

      // PE outer box
      peG.appendChild(this._el('rect', {
        x: pe.x, y: pe.y, width: pe.w, height: pe.h,
        rx: 8, fill: C.pe.fill, stroke: C.pe.stroke, 'stroke-width': 2,
      }));

      const peLbl = this._el('text', {
        x: pe.x + pe.w / 2, y: pe.y + 12,
        'text-anchor': 'middle', 'font-size': 10, 'font-weight': '700',
        fill: C.pe.text,
      });
      peLbl.textContent = `PE ${i}`;
      peG.appendChild(peLbl);

      // ── DMA (top of PE, receives data from HBM via bus) ──
      const dmaY = pe.y + 18;
      const dmaH = 22;
      const dmaX = pe.x + 8;
      const dmaW = pe.w - 16;
      peG.appendChild(this._el('rect', {
        x: dmaX, y: dmaY, width: dmaW, height: dmaH,
        rx: 4, fill: C.dma.fill, stroke: C.dma.stroke, 'stroke-width': 1.5,
      }));
      const dmaLbl = this._el('text', {
        x: dmaX + dmaW / 2, y: dmaY + 9,
        'text-anchor': 'middle', 'font-size': 9, 'font-weight': '700', fill: C.dma.text,
      });
      dmaLbl.textContent = 'DMA';
      peG.appendChild(dmaLbl);
      const dmaSub = this._el('text', {
        x: dmaX + dmaW / 2, y: dmaY + 18,
        'text-anchor': 'middle', 'font-size': 7, fill: C.dma.text, opacity: 0.85,
      });
      dmaSub.textContent = 'HBM ↔ SRAM';
      peG.appendChild(dmaSub);

      // Arrow DMA → SRAM
      peG.appendChild(this._el('line', {
        x1: pe.cx, y1: dmaY + dmaH,
        x2: pe.cx, y2: dmaY + dmaH + 8,
        stroke: C.dma.stroke, 'stroke-width': 1.5,
        'marker-end': 'url(#arrow-amber)',
      }));

      // ── SRAM block ──
      const sramY = dmaY + dmaH + 12;
      const sramH = 40;
      const sramX = pe.x + 8;
      const sramW = pe.w - 16;
      peG.appendChild(this._el('rect', {
        x: sramX, y: sramY, width: sramW, height: sramH,
        rx: 5, fill: C.sram.fill, stroke: C.sram.stroke, 'stroke-width': 1.5,
      }));
      const sramLbl = this._el('text', {
        x: sramX + sramW / 2, y: sramY + 13,
        'text-anchor': 'middle', 'font-size': 10, 'font-weight': '700', fill: C.sram.text,
      });
      sramLbl.textContent = 'SRAM';
      peG.appendChild(sramLbl);
      const sramSub = this._el('text', {
        x: sramX + sramW / 2, y: sramY + 24,
        'text-anchor': 'middle', 'font-size': 7.5, fill: C.sram.text, opacity: 0.8,
      });
      sramSub.textContent = 'weight · act buffer';
      peG.appendChild(sramSub);
      for (let b = 0; b < 2; b++) {
        peG.appendChild(this._el('rect', {
          x: sramX + 6, y: sramY + 30 + b * 4, width: sramW - 12, height: 2,
          fill: '#3b82f6', opacity: 0.25, rx: 1,
        }));
      }

      // Arrow SRAM → MAC
      const arrowY = sramY + sramH;
      peG.appendChild(this._el('line', {
        x1: pe.cx, y1: arrowY, x2: pe.cx, y2: arrowY + 10,
        stroke: '#22c55e', 'stroke-width': 1.5,
        'marker-end': 'url(#arrow-blue)',
      }));

      // ── MAC Array block ──
      const macY = sramY + sramH + 14;
      const macH = pe.h - (macY - pe.y) - 6;
      const macX = pe.x + 8;
      const macW = pe.w - 16;
      peG.appendChild(this._el('rect', {
        x: macX, y: macY, width: macW, height: Math.max(macH, 28),
        rx: 5, fill: C.mac.fill, stroke: C.mac.stroke, 'stroke-width': 1.5,
      }));
      const macRows = 2, macCols = 4;
      const cellW = (macW - 10) / macCols;
      const cellH = Math.max((macH - 18) / macRows, 6);
      for (let r = 0; r < macRows; r++) {
        for (let c = 0; c < macCols; c++) {
          peG.appendChild(this._el('rect', {
            x: macX + 5 + c * cellW + 1, y: macY + 14 + r * (cellH + 2),
            width: cellW - 3, height: cellH,
            rx: 2, fill: '#16a34a', opacity: 0.38,
          }));
        }
      }
      const macLbl = this._el('text', {
        x: macX + macW / 2, y: macY + 10,
        'text-anchor': 'middle', 'font-size': 9, 'font-weight': '700', fill: C.mac.text,
      });
      macLbl.textContent = 'MAC Array';
      peG.appendChild(macLbl);

      // Make PE clickable
      peG.style.cursor = 'pointer';
      const self = this;
      const peIdx = i;
      peG.addEventListener('click', () => {
        if (window.onComponentClick) window.onComponentClick('pe', peIdx, self.results);
      });
      peG.addEventListener('mouseenter', () => { peG.style.filter = 'brightness(0.95)'; });
      peG.addEventListener('mouseleave', () => { peG.style.filter = ''; });

      g.appendChild(peG);
    }
    svg.appendChild(g);
  }

  _renderLabels(svg, results) {
    if (!results) return;
    const g = this._el('g', { id: 'info-labels' });
    const { W, H } = this.layout;

    const bwLbl = this._el('text', {
      x: W - 10, y: 30,
      'text-anchor': 'end', 'font-size': 10, fill: '#64748b',
    });
    bwLbl.textContent = `HBM BW: ${results.params.hbmBandwidthGBs} GB/s`;
    g.appendChild(bwLbl);

    const busLbl = this._el('text', {
      x: W - 10, y: 44,
      'text-anchor': 'end', 'font-size': 10, fill: '#64748b',
    });
    busLbl.textContent = `Bus: ${results.params.busWidthBits}b × ${results.params.burstLength} burst`;
    g.appendChild(busLbl);

    if (results.bottleneck === 'MEMORY') {
      const { hbm } = this.layout;
      const totalW = (hbm.banks.length * (hbm.banks[0].w + 8));
      const hlX = hbm.banks[0].x - 6;
      const hlY = hbm.banks[0].y - 4;
      const hlW = totalW + 8;
      const hlH = hbm.banks[0].h + 8;
      g.appendChild(this._el('rect', {
        x: hlX, y: hlY, width: hlW, height: hlH,
        rx: 10, fill: 'none', stroke: '#ef4444', 'stroke-width': 2.5,
        filter: 'url(#glow)', opacity: 0.8,
      }));
      const hlLbl = this._el('text', {
        x: hlX + hlW / 2, y: hlY - 4,
        'text-anchor': 'middle', 'font-size': 10, 'font-weight': '700',
        fill: '#ef4444',
      });
      hlLbl.textContent = 'MEMORY BOTTLENECK';
      g.appendChild(hlLbl);
    }

    if (results.bottleneck === 'COMPUTE') {
      const pe0 = this.layout.pe.get(0);
      const peLast = this.layout.pe.get(this.layout.numPE - 1);
      const hlX = pe0.x - 6;
      const hlY = pe0.y - 4;
      const hlW = (peLast.x + peLast.w) - pe0.x + 12;
      const hlH = (peLast.y + peLast.h) - pe0.y + 8;
      g.appendChild(this._el('rect', {
        x: hlX, y: hlY, width: hlW, height: hlH,
        rx: 10, fill: 'none', stroke: '#f59e0b', 'stroke-width': 2.5,
        filter: 'url(#glow)', opacity: 0.8,
      }));
      const hlLbl = this._el('text', {
        x: hlX + hlW / 2, y: hlY - 4,
        'text-anchor': 'middle', 'font-size': 10, 'font-weight': '700',
        fill: '#f59e0b',
      });
      hlLbl.textContent = 'COMPUTE BOTTLENECK';
      g.appendChild(hlLbl);
    }

    svg.appendChild(g);
  }

  // ── Animation ─────────────────────────────────────────────────────────────

  _buildPacketPaths(numPE, numHBMBanks) {
    const l = this.layout;
    this.animPaths = [];

    // HBM → Control → PE DMA  (inter-PE weight/activation load)
    l.hbm.banks.forEach((bank, bi) => {
      for (let pi = 0; pi < numPE; pi++) {
        const pe = l.pe.get(pi);
        const midY1 = bank.cy + (l.ctrl.y - bank.cy) * 0.5;
        const midY2 = l.ctrl.y + l.ctrl.h + (pe.y - l.ctrl.y - l.ctrl.h) * 0.5;
        // Target: PE DMA block center (top of PE, y+18+11)
        const dmaCenterY = pe.y + 18 + 11;
        this.animPaths.push({
          type: 'hbm', color: '#ef4444', r: 5, speed: 1.2,
          points: [
            { x: bank.cx,   y: bank.cy },
            { x: bank.cx,   y: midY1 },
            { x: l.ctrl.cx, y: l.ctrl.y + l.ctrl.h / 2 },
            { x: pe.cx,     y: midY2 },
            { x: pe.cx,     y: dmaCenterY },
          ],
          delay: (bi * numPE + pi) * 0.3,
        });
      }
    });

    // DMA → SRAM → MAC (intra-PE data path)
    for (let pi = 0; pi < numPE; pi++) {
      const pe = l.pe.get(pi);
      const dmaBot  = pe.y + 18 + 22;   // DMA bottom
      const sramTop = dmaBot + 12;       // SRAM top
      const sramBot = sramTop + 40;      // SRAM bottom
      const macTop  = sramBot + 14;      // MAC top
      this.animPaths.push({
        type: 'sram', color: '#3b82f6', r: 4, speed: 1.8,
        points: [
          { x: pe.cx, y: dmaBot },
          { x: pe.cx, y: sramTop + 20 },  // SRAM center
          { x: pe.cx, y: sramBot + 7 },
          { x: pe.cx, y: macTop + 10 },
        ],
        delay: pi * 0.15,
      });
    }

    // Inter-PE via Control Unit (TP AllReduce path)
    if (numPE >= 2) {
      const pe0 = l.pe.get(0);
      const pe1 = l.pe.get(1);
      const dma0Y = pe0.y + 18 + 11;
      const dma1Y = pe1.y + 18 + 11;
      this.animPaths.push({
        type: 'inter', color: '#f59e0b', r: 4, speed: 0.9,
        points: [
          { x: pe0.cx,    y: dma0Y },
          { x: pe0.cx,    y: l.ctrl.y + l.ctrl.h / 2 },
          { x: l.ctrl.cx, y: l.ctrl.y + l.ctrl.h / 2 },
          { x: pe1.cx,    y: l.ctrl.y + l.ctrl.h / 2 },
          { x: pe1.cx,    y: dma1Y },
        ],
        delay: 0.8,
      });
    }
  }

  _spawnInitialPackets(results, numPE) {
    const isMemBound = results.bottleneck === 'MEMORY';
    this.packets = [];

    const hbmPaths = this.animPaths.filter(p => p.type === 'hbm');
    const pathSample = hbmPaths.slice(0, Math.min(isMemBound ? 8 : 3, hbmPaths.length));
    pathSample.forEach((path, i) => {
      this.packets.push({ path, t: (i / pathSample.length + path.delay * 0.1) % 1,
        opacity: isMemBound ? 1 : 0.5 });
    });

    this.animPaths.filter(p => p.type === 'sram').forEach((path, i) => {
      this.packets.push({ path, t: (i * 0.2 + path.delay * 0.1) % 1,
        opacity: isMemBound ? 0.5 : 1 });
    });

    this.animPaths.filter(p => p.type === 'inter').forEach(path => {
      if (results.params.TP > 1) {
        this.packets.push({ path, t: 0.2, opacity: 0.8 });
      }
    });
  }

  startAnimation() {
    if (this.animating) return;
    this.animating = true;
    let last = null;
    const loop = (ts) => {
      if (!this.animating) return;
      if (last === null) last = ts;
      const dt = (ts - last) / 1000;
      last = ts;
      this._stepPackets(dt);
      this._drawPackets();
      this.animId = requestAnimationFrame(loop);
    };
    this.animId = requestAnimationFrame(loop);
  }

  stopAnimation() {
    this.animating = false;
    if (this.animId) { cancelAnimationFrame(this.animId); this.animId = null; }
    if (this.svg) {
      const layer = this.svg.querySelector('#packet-layer');
      if (layer) layer.innerHTML = '';
    }
  }

  _stepPackets(dt) {
    this.packets.forEach(pkt => {
      pkt.t = (pkt.t + dt * pkt.path.speed * 0.25 * this.speedMult) % 1;
    });
  }

  _drawPackets() {
    if (!this.svg) return;
    let layer = this.svg.querySelector('#packet-layer');
    if (!layer) {
      layer = this._el('g', { id: 'packet-layer' });
      this.svg.appendChild(layer);
    }
    layer.innerHTML = '';

    this.packets.forEach(pkt => {
      const pos = this._interpolatePath(pkt.path.points, pkt.t);
      const glow = this._el('circle', {
        cx: pos.x, cy: pos.y, r: pkt.path.r + 3,
        fill: pkt.path.color, opacity: 0.2,
      });
      const circle = this._el('circle', {
        cx: pos.x, cy: pos.y, r: pkt.path.r,
        fill: pkt.path.color, opacity: pkt.opacity || 0.9,
      });
      layer.appendChild(glow);
      layer.appendChild(circle);
    });
  }

  _interpolatePath(points, t) {
    if (points.length < 2) return points[0];
    const segments = points.length - 1;
    const scaledT = t * segments;
    const idx = Math.min(Math.floor(scaledT), segments - 1);
    const segT = scaledT - idx;
    const a = points[idx], b = points[idx + 1];
    return { x: a.x + (b.x - a.x) * segT, y: a.y + (b.y - a.y) * segT };
  }

  _el(tag, attrs) {
    attrs = attrs || {};
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  setSpeed(mult) { this.speedMult = mult; }
  setAnimEnabled(enabled) {
    if (enabled) this.startAnimation();
    else this.stopAnimation();
  }
}

// ── PE Detail Rendering ───────────────────────────────────────────────────────

function renderPEDetail(canvas, statsEl, peIndex, results, params) {
  const W = canvas.offsetWidth || 580;
  const H = Math.min(Math.round(W * 0.72), 420);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const numBanks = params.sramNumBanks || 16;
  const sramCapMB = params.sramCapacityMB || 16;
  const macsPerPE = params.macsPerPE || 256;
  const teSize = Math.round(Math.sqrt(macsPerPE));

  const weightBytesPerPE = results.weightBytes / params.numPE;
  const actBytesPerPE = results.activationTotal / params.numPE;

  const totalSRAMAccesses = Math.ceil((weightBytesPerPE + actBytesPerPE) / (params.busWidthBits / 8));
  const accessesPerBank = Math.ceil(totalSRAMAccesses / numBanks);
  const conflictRate = 1 / numBanks;
  const bankConflicts = Math.ceil(totalSRAMAccesses * conflictRate);
  const hitRate = (totalSRAMAccesses - bankConflicts) / Math.max(totalSRAMAccesses, 1);

  // Deterministic per-bank activity
  const bankActivity = Array.from({ length: numBanks }, (_, idx) => {
    const base = accessesPerBank;
    const noise = Math.sin(idx * 2.7 + 1.3) * accessesPerBank * 0.3;
    return Math.max(0, Math.round(base + noise));
  });
  const maxBankActivity = Math.max(...bankActivity, 1);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  const pad = 14;
  const qW = (W - pad * 3) / 2;
  const qH = (H - pad * 3) / 2;

  function drawBox(x, y, w, h, fill, stroke, title, subtitle) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = stroke;
    ctx.font = 'bold 11px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(title, x + w / 2, y + 16);
    if (subtitle) {
      ctx.font = '9px system-ui';
      ctx.fillStyle = '#64748b';
      ctx.fillText(subtitle, x + w / 2, y + 28);
    }
  }

  // Q1: SRAM (top-left)
  const q1x = pad, q1y = pad;
  drawBox(q1x, q1y, qW, qH, '#dbeafe', '#3b82f6', 'SRAM', sramCapMB + 'MB · ' + numBanks + ' banks');

  // Bank heatmap
  const bankCols = Math.min(numBanks, 8);
  const bankRows = Math.ceil(numBanks / bankCols);
  const bCellW = (qW - 20) / bankCols;
  const bCellH = Math.min((qH - 44) / Math.max(bankRows, 1), 16);
  bankActivity.forEach((activity, bi) => {
    const col = bi % bankCols, row = Math.floor(bi / bankCols);
    const bx = q1x + 10 + col * bCellW;
    const by = q1y + 36 + row * bCellH;
    const intensity = activity / maxBankActivity;
    const r = Math.round(intensity * 200 + 55);
    const grn = Math.round((1 - intensity) * 180 + 40);
    ctx.fillStyle = 'rgb(' + r + ',' + grn + ',80)';
    ctx.beginPath();
    ctx.roundRect(bx + 1, by + 1, bCellW - 3, bCellH - 3, 2);
    ctx.fill();
    if (bCellW > 18) {
      ctx.fillStyle = '#fff';
      ctx.font = '7px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('B' + bi, bx + bCellW / 2, by + bCellH / 2 + 2);
    }
  });

  // Q2: Tensor Engine (top-right)
  const q2x = pad * 2 + qW, q2y = pad;
  drawBox(q2x, q2y, qW, qH, '#dcfce7', '#22c55e', 'Tensor Engine', teSize + 'x' + teSize + ' systolic array');

  const gridSize = Math.min(teSize, 8);
  const cellSize = Math.min((qW - 24) / gridSize, (qH - 50) / gridSize);
  for (let rr = 0; rr < gridSize; rr++) {
    for (let cc = 0; cc < gridSize; cc++) {
      const cx2 = q2x + 12 + cc * cellSize;
      const cy2 = q2y + 38 + rr * cellSize;
      ctx.fillStyle = '#16a34a';
      ctx.globalAlpha = 0.45 + (rr + cc) % 3 * 0.15;
      ctx.beginPath();
      ctx.roundRect(cx2 + 1, cy2 + 1, cellSize - 3, cellSize - 3, 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Q3: Math Engine (bottom-right)
  const q3x = pad * 2 + qW, q3y = pad * 2 + qH;
  drawBox(q3x, q3y, qW, qH, '#ccfbf1', '#14b8a6', 'Math Engine', 'VALU · activation · norm');
  const ops = ['ReLU / GELU / SiLU', 'LayerNorm', 'Softmax', 'Scale / Add', 'Transpose'];
  ops.forEach((op, idx) => {
    ctx.fillStyle = '#0f766e';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('• ' + op, q3x + 10, q3y + 42 + idx * 14);
  });

  // Q4: DMA Intra-PE (bottom-left)
  const q4x = pad, q4y = pad * 2 + qH;
  drawBox(q4x, q4y, qW, qH, '#fef9c3', '#ca8a04', 'DMA (Intra-PE)', 'SRAM <-> TE · ME <-> SRAM');

  const midX = q4x + qW / 2;
  const arrY = q4y + 50;
  ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(q4x + 15, arrY); ctx.lineTo(midX - 5, arrY);
  ctx.stroke();
  ctx.fillStyle = '#ca8a04';
  ctx.font = '8px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('SRAM->TE', midX - qW / 4, arrY - 5);
  const bwPerPE = Math.round((params.sramBandwidthGBs || 10000) / params.numPE);
  ctx.font = '9px system-ui'; ctx.fillStyle = '#713f12';
  ctx.fillText(bwPerPE + ' GB/s', midX - qW / 4, arrY + 12);

  ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(midX + 5, arrY + 25); ctx.lineTo(q4x + qW - 15, arrY + 25);
  ctx.stroke();
  ctx.fillStyle = '#ca8a04';
  ctx.font = '8px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('ME->SRAM', midX + qW / 4, arrY + 20);
  ctx.font = '9px system-ui'; ctx.fillStyle = '#713f12';
  ctx.fillText(bwPerPE + ' GB/s', midX + qW / 4, arrY + 37);

  // Inter-quadrant flow arrows
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1.5;
  ctx.setLineDash([3, 2]);
  // SRAM -> TE
  ctx.beginPath();
  ctx.moveTo(q1x + qW, q1y + qH / 2);
  ctx.lineTo(q2x, q2y + qH / 2);
  ctx.stroke();
  // TE -> ME
  ctx.beginPath();
  ctx.moveTo(q2x + qW / 2, q2y + qH);
  ctx.lineTo(q3x + qW / 2, q3y);
  ctx.stroke();
  // ME -> DMA
  ctx.beginPath();
  ctx.moveTo(q3x, q3y + qH / 2);
  ctx.lineTo(q4x + qW, q4y + qH / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle = '#94a3b8'; ctx.font = '9px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('weights/acts', (q1x + qW + q2x) / 2, q1y + qH / 2 - 5);
  ctx.fillText('partial sums', q2x + qW / 2, (q2y + qH + q3y) / 2 - 5);
  ctx.fillText('results', (q3x + q4x + qW) / 2, q3y + qH / 2 - 5);

  // Stats panel
  const wFmt = weightBytesPerPE >= 1e9
    ? (weightBytesPerPE / 1e9).toFixed(2) + ' GB'
    : (weightBytesPerPE / 1e6).toFixed(1) + ' MB';
  const aFmt = actBytesPerPE >= 1e9
    ? (actBytesPerPE / 1e9).toFixed(2) + ' GB'
    : (actBytesPerPE / 1e6).toFixed(1) + ' MB';

  statsEl.innerHTML =
    '<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:#1e293b">PE ' + peIndex + ' Statistics</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">SRAM</div>' +
      statRow('Capacity', sramCapMB + ' MB') +
      statRow('Banks', numBanks) +
      statRow('Weight data', wFmt) +
      statRow('Activation data', aFmt) +
      statRow('Total accesses', formatCycles(totalSRAMAccesses)) +
      statRow('Conflicts', formatCycles(bankConflicts) + ' (' + (bankConflicts / Math.max(totalSRAMAccesses, 1) * 100).toFixed(1) + '%)') +
      statRow('Hit rate', (hitRate * 100).toFixed(1) + '%') +
      statRow('Busiest bank', 'B' + bankActivity.indexOf(maxBankActivity) + ' (' + maxBankActivity.toLocaleString() + ')') +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">Tensor Engine</div>' +
      statRow('Array size', teSize + 'x' + teSize + ' MACs') +
      statRow('Peak', (macsPerPE * 2 * params.clockFreqGHz).toFixed(0) + ' GFLOPs/s') +
      statRow('Data width', params.busWidthBits + ' bits') +
      statRow('Data type', params.dataType) +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">DMA (Intra-PE)</div>' +
      statRow('SRAM->TE BW', bwPerPE + ' GB/s') +
      statRow('Burst len', params.burstLength + ' beats') +
    '</div>';
}

function statRow(label, value) {
  return '<div style="display:flex;justify-content:space-between;padding:4px 6px;background:#f8fafc;border-radius:4px;margin-bottom:3px;font-size:11px">' +
    '<span style="color:#475569">' + label + '</span>' +
    '<span style="font-weight:600;color:#1e293b">' + value + '</span>' +
    '</div>';
}

// ── HBM Detail Rendering ──────────────────────────────────────────────────────

function renderHBMDetail(canvas, statsEl, bankIndex, results, params) {
  const W = canvas.offsetWidth || 580;
  const H = 420;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const numDies = params.hbmNumStackDie || 8;
  const capPerDie = params.hbmCapPerDieGB || 2;
  const numIO = params.hbmNumIO || 1024;
  const dataRate = params.hbmDataRateGbps || 6.4;
  const totalCap = numDies * capPerDie;
  const stackBW = dataRate * numIO / 8;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);

  const stackW = Math.min(180, W * 0.38);
  const stackX = 24;
  const dieH = Math.min(32, (H - 80) / (numDies + 1.5));
  const dieColors = ['#fecaca', '#fca5a5', '#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d'];

  for (let d = numDies - 1; d >= 0; d--) {
    const dieY = 24 + (numDies - 1 - d) * dieH;
    const activity = 0.3 + 0.5 * Math.abs(Math.sin(d * 1.4 + 0.7));

    // 3D shadow
    ctx.fillStyle = '#fecaca';
    ctx.beginPath();
    ctx.roundRect(stackX + 4, dieY + 4, stackW, dieH * 0.85, 4);
    ctx.fill();

    // Die body
    ctx.fillStyle = dieColors[Math.min(d, dieColors.length - 1)];
    ctx.beginPath();
    ctx.roundRect(stackX, dieY, stackW, dieH * 0.85, 4);
    ctx.fill();
    ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
    ctx.stroke();

    // Activity bar
    const barW = (stackW - 20) * activity;
    ctx.fillStyle = 'rgba(239,68,68,0.25)';
    ctx.fillRect(stackX + 10, dieY + 8, stackW - 20, dieH * 0.45);
    ctx.fillStyle = 'rgba(239,68,68,0.65)';
    ctx.fillRect(stackX + 10, dieY + 8, barW, dieH * 0.45);

    // Label
    ctx.fillStyle = '#fff';
    ctx.font = 'bold ' + Math.min(10, Math.round(dieH * 0.3)) + 'px system-ui';
    ctx.textAlign = 'left';
    ctx.fillText('Die ' + (d + 1) + '  ' + capPerDie + 'GB', stackX + 10, dieY + dieH * 0.62);
    ctx.font = Math.min(9, Math.round(dieH * 0.25)) + 'px system-ui';
    ctx.fillStyle = '#fecaca';
    ctx.fillText((activity * 100).toFixed(0) + '% active', stackX + 10, dieY + dieH * 0.83);
  }

  // IO Die at bottom
  const ioDieY = 24 + numDies * dieH;
  ctx.fillStyle = '#fef9c3'; ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(stackX, ioDieY, stackW, dieH * 0.85, 4); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#713f12'; ctx.font = 'bold 9px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('IO Die  (' + numIO + ' pins x ' + dataRate + ' Gbps)', stackX + stackW / 2, ioDieY + dieH * 0.52);

  // TSV lines
  ctx.strokeStyle = '#94a3b8'; ctx.lineWidth = 1;
  for (let t = 0; t < 6; t++) {
    const tx = stackX + 15 + t * (stackW - 30) / 5;
    for (let d = 0; d < numDies; d++) {
      const ty = 24 + d * dieH + dieH * 0.85;
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx, ty + dieH * 0.15); ctx.stroke();
    }
  }

  // Stack title
  ctx.fillStyle = '#991b1b'; ctx.font = 'bold 12px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('HBM Stack ' + bankIndex, stackX + stackW / 2, 16);

  // Right panel: traffic info
  const infoX = stackX + stackW + 24;
  const infoW = W - infoX - 10;

  ctx.fillStyle = '#1e293b'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left';
  ctx.fillText('Traffic Analysis', infoX, 34);

  const txData = results.totalHBMBytes / Math.max(params.numHBMBanks || 4, 1);
  const txDataFmt = txData >= 1e9
    ? (txData / 1e9).toFixed(2) + ' GB'
    : (txData / 1e6).toFixed(0) + ' MB';
  const utilPct = (results.bwUtilization * 100).toFixed(1);

  const infoRows = [
    ['Stack BW', stackBW.toFixed(0) + ' GB/s'],
    ['Total Cap', totalCap + ' GB'],
    ['Dies', numDies + ' DRAM + 1 IO'],
    ['IO Pins', numIO.toLocaleString()],
    ['Data Rate', dataRate + ' Gbps/pin'],
    ['Bus to ctrl', params.busWidthBits + '-bit, ' + params.burstLength + ' burst'],
    ['Traffic', txDataFmt],
    ['Utilization', utilPct + '%'],
    ['HBM Latency', (params.hbmLatencyNs || 100) + ' ns'],
  ];

  infoRows.forEach(([label, value], i) => {
    const rowY = 48 + i * 30;
    ctx.fillStyle = '#f8fafc'; ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(infoX, rowY, infoW, 24, 4); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#475569'; ctx.font = '10px system-ui'; ctx.textAlign = 'left';
    ctx.fillText(label, infoX + 8, rowY + 15);
    ctx.fillStyle = '#1e293b'; ctx.font = 'bold 10px system-ui'; ctx.textAlign = 'right';
    ctx.fillText(value, infoX + infoW - 8, rowY + 15);
  });

  statsEl.innerHTML =
    '<div style="padding:8px">' +
    '<div style="font-weight:700;margin-bottom:8px">HBM' + bankIndex + ' Physical</div>' +
    '<p style="font-size:11px;color:#64748b">Scroll to see per-stack traffic details above.</p>' +
    '<div style="margin-top:12px;padding:8px;background:#fee2e2;border-radius:6px;font-size:11px;color:#991b1b">' +
    '<strong>Spec note:</strong><br>HBM3e: 6.4Gbps/pin x 1024 pins / 8 = 819 GB/s/stack<br>' +
    'Computed: ' + stackBW.toFixed(0) + ' GB/s for current settings' +
    '</div>' +
    '</div>';
}

// ── Control Unit Detail ───────────────────────────────────────────────────────

function renderCtrlDetail(canvas, statsEl, results, params) {
  const W = canvas.offsetWidth || 580;
  const H = 360;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = '#6b21a8'; ctx.font = 'bold 13px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Control Unit & DMA Engine', W / 2, 22);

  const boxes = [
    { x: 24,     y: 40, w: 180, h: 80,  fill: '#f3e8ff', stroke: '#a855f7', title: 'Scheduler',   sub: 'dispatch · priority queue' },
    { x: 220,    y: 40, w: 180, h: 80,  fill: '#f3e8ff', stroke: '#a855f7', title: 'Sync / Fence', sub: 'barrier · event signals' },
    { x: W - 220, y: 40, w: 180, h: 80,  fill: '#f3e8ff', stroke: '#a855f7', title: 'Perf Monitor', sub: 'counters · stall detection' },
    { x: 24,     y: 150, w: 260, h: 80,  fill: '#fef9c3', stroke: '#ca8a04', title: 'DMA Engine',  sub: 'scatter-gather · descriptor' },
    { x: 300,    y: 150, w: 200, h: 80,  fill: '#fef9c3', stroke: '#ca8a04', title: 'DMA FIFO',   sub: 'in-flight buffer' },
    { x: 24,     y: 258, w: 460, h: 60,  fill: '#e0f2fe', stroke: '#0284c7', title: 'UCIe-A Bus Interface', sub: params.busWidthBits + '-bit · ' + params.burstLength + ' burst · HBM controller' },
  ];

  boxes.forEach(b => {
    ctx.fillStyle = b.fill; ctx.strokeStyle = b.stroke; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(b.x, b.y, b.w, b.h, 8); ctx.fill(); ctx.stroke();
    ctx.fillStyle = b.stroke; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
    ctx.fillText(b.title, b.x + b.w / 2, b.y + 26);
    ctx.fillStyle = '#64748b'; ctx.font = '9px system-ui';
    ctx.fillText(b.sub, b.x + b.w / 2, b.y + 42);
  });

  statsEl.innerHTML =
    '<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:#1e293b">Control Unit Stats</div>' +
    statRow('HBM BW', params.hbmBandwidthGBs + ' GB/s') +
    statRow('Bus width', params.busWidthBits + ' bits') +
    statRow('Burst length', params.burstLength + ' beats') +
    statRow('Bytes/burst', (params.busWidthBits / 8 * params.burstLength) + ' B') +
    statRow('HBM latency', (params.hbmLatencyNs || 100) + ' ns') +
    statRow('Bus efficiency', (results.busEfficiency * 100).toFixed(1) + '%') +
    statRow('HBM cycles', formatCycles(results.hbmCycles)) +
    statRow('Network cycles', formatCycles(results.networkCycles));
}

// ── DMA Detail ────────────────────────────────────────────────────────────────

function renderDMADetail(canvas, statsEl, results, params) {
  renderCtrlDetail(canvas, statsEl, results, params);
  statsEl.innerHTML =
    '<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:#1e293b">DMA Engine Stats</div>' +
    statRow('Burst length', params.burstLength + ' beats') +
    statRow('Bus width', params.busWidthBits + ' bits') +
    statRow('Bytes/burst', (params.busWidthBits / 8 * params.burstLength) + ' B') +
    statRow('Weight bursts', results.weightTxn.burstsNeeded.toLocaleString()) +
    statRow('KV bursts', results.kvTxn.burstsNeeded.toLocaleString()) +
    statRow('Bus efficiency', (results.busEfficiency * 100).toFixed(1) + '%') +
    statRow('Burst transfer', formatCycles(results.weightTxn.transferCycles) + ' cyc');
}

// ── SiP Detail Rendering ─────────────────────────────────────────────────────────

function renderSiPDetail(canvas, statsEl, sipIndex, results, params) {
  const W = canvas.offsetWidth || 580;
  const H = Math.min(Math.round(W * 0.72), 420);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const mpeCount   = params.multiPEsPerSiP || 16;
  const pesPerMPE  = params.pesPerMultiPE  || 8;
  const numIODie   = Math.ceil(mpeCount / 8);
  const totalPEs   = mpeCount * pesPerMPE;
  const hbmBW      = params.hbmBandwidthGBs || 1000;
  const sramCapMB  = params.sramCapacityMB  || 16;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  // ── Title bar ──
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 13px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`SiP ${sipIndex}  —  ${mpeCount} Multi-PE · ${numIODie} IO-Die · ${totalPEs} total PEs`, W / 2, 22);

  // ── mPE grid (left block) ──
  const gridCols = Math.ceil(Math.sqrt(mpeCount));
  const gridRows = Math.ceil(mpeCount / gridCols);
  const pad = 12;
  const gridAreaW = W * 0.62;
  const cellW = (gridAreaW - pad * (gridCols + 1)) / gridCols;
  const cellH = (H - 50 - pad * (gridRows + 1)) / gridRows;
  const gridX0 = pad;
  const gridY0 = 36;

  for (let i = 0; i < mpeCount; i++) {
    const col = i % gridCols, row = Math.floor(i / gridCols);
    const cx = gridX0 + pad + col * (cellW + pad);
    const cy = gridY0 + row * (cellH + pad);

    ctx.fillStyle = '#dcfce7';
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(cx, cy, cellW, cellH, 5); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#166534';
    ctx.font = `bold ${Math.max(8, Math.min(10, cellW / 8))}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(`mPE ${i}`, cx + cellW / 2, cy + cellH * 0.38);

    ctx.fillStyle = '#94a3b8';
    ctx.font = `${Math.max(7, Math.min(9, cellW / 9))}px system-ui`;
    ctx.fillText(`${pesPerMPE} PE`, cx + cellW / 2, cy + cellH * 0.65);
  }

  // ── IO-Die column (right block) ──
  const ioDieX = gridAreaW + pad * 2;
  const ioDieW = W - ioDieX - pad;
  const ioDieH = Math.min(48, (H - 50) / numIODie - 10);
  const ioDieSpacing = (H - 50) / numIODie;

  for (let d = 0; d < numIODie; d++) {
    const startMPE = d * 8;
    const endMPE   = Math.min((d + 1) * 8 - 1, mpeCount - 1);
    const ioDieY = 36 + d * ioDieSpacing + (ioDieSpacing - ioDieH) / 2;

    // Connection line from grid edge to IO-Die
    const groupMinRow = Math.floor(startMPE / gridCols);
    const groupMaxRow = Math.floor(endMPE / gridCols);
    const lineY = gridY0 + ((groupMinRow + groupMaxRow) / 2) * (cellH + pad) + cellH / 2;
    ctx.strokeStyle = '#ca8a04'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(gridAreaW + pad, lineY);
    ctx.lineTo(ioDieX, ioDieY + ioDieH / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = '#fef9c3';
    ctx.strokeStyle = '#ca8a04';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(ioDieX, ioDieY, ioDieW, ioDieH, 5); ctx.fill(); ctx.stroke();

    ctx.fillStyle = '#713f12';
    ctx.font = 'bold 9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(`IO-Die ${d}`, ioDieX + ioDieW / 2, ioDieY + ioDieH * 0.42);
    ctx.font = '8px system-ui';
    ctx.fillStyle = '#92400e';
    ctx.fillText(`mPE ${startMPE}–${endMPE}`, ioDieX + ioDieW / 2, ioDieY + ioDieH * 0.75);
  }

  // ── Stats ──
  const hbmPerSiP = Math.round(hbmBW / (params.numSiPs || 1));
  statsEl.innerHTML =
    `<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:#1e293b">SiP ${sipIndex} Statistics</div>` +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">Compute</div>' +
      statRow('Multi-PEs', mpeCount) +
      statRow('PEs / Multi-PE', pesPerMPE) +
      statRow('Total PEs', totalPEs) +
      statRow('MACs / PE / cycle', params.macsPerPE || 256) +
      statRow('Peak FLOPs/s', ((params.macsPerPE || 256) * 2 * totalPEs * (params.clockFreqGHz || 2) * 1e9 / 1e12).toFixed(1) + ' TFLOPs') +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">Memory</div>' +
      statRow('SRAM / PE', sramCapMB + ' MB') +
      statRow('Total SRAM', (sramCapMB * totalPEs / 1024).toFixed(1) + ' GB') +
      statRow('HBM BW (SiP share)', hbmPerSiP + ' GB/s') +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">IO</div>' +
      statRow('IO-Die count', numIODie + `  (1 per 8 mPE)`) +
      statRow('mPE / IO-Die', 8) +
      statRow('Interface', 'UCIe-A') +
    '</div>';
}

// ── Multi-PE Detail Rendering ─────────────────────────────────────────────────────

function renderMPEDetail(canvas, statsEl, mpeIndex, results, params) {
  const W = canvas.offsetWidth || 580;
  const H = Math.min(Math.round(W * 0.72), 420);
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const pesPerMPE  = params.pesPerMultiPE || 8;
  const sramCapMB  = params.sramCapacityMB || 16;
  const macsPerPE  = params.macsPerPE || 256;
  const hbmBanks   = params.numHBMBanks || 4;
  const hbmBW      = params.hbmBandwidthGBs || 1000;
  const bwPerMPE   = Math.round(hbmBW / Math.max(params.multiPEsPerSiP || 16, 1));

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, W, H);

  // ── Title ──
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 13px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText(`Multi-PE ${mpeIndex}  —  ${pesPerMPE} PEs · HBM · Control Unit`, W / 2, 22);

  const pad = 12;
  const topY = 36;

  // ── HBM block (top) ──
  const hbmH = 44;
  ctx.fillStyle = '#fee2e2'; ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(pad, topY, W - pad * 2, hbmH, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#991b1b'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('HBM (Off-Chip)', W / 2, topY + 17);
  ctx.font = '9px system-ui'; ctx.fillStyle = '#64748b';
  ctx.fillText(`BW: ${bwPerMPE} GB/s  ·  ${hbmBanks} banks  ·  Latency: ${params.hbmLatencyNs || 100} ns`, W / 2, topY + 32);

  // Arrow HBM → CU
  const arrowX = W / 2;
  ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(arrowX, topY + hbmH); ctx.lineTo(arrowX, topY + hbmH + 12); ctx.stroke();

  // ── Control Unit (center-top) ──
  const cuY = topY + hbmH + 14;
  const cuH = 36;
  const cuW = W * 0.55;
  const cuX = (W - cuW) / 2;
  ctx.fillStyle = '#f3e8ff'; ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.roundRect(cuX, cuY, cuW, cuH, 7); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#6b21a8'; ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('Control Unit', W / 2, cuY + 15);
  ctx.font = '9px system-ui'; ctx.fillStyle = '#64748b';
  ctx.fillText('dispatch · arbiter · DMA · UCIe-A', W / 2, cuY + 28);

  // Arrows CU → PEs
  const peAreaY = cuY + cuH + 14;
  const peAreaH = H - peAreaY - pad;
  const peCols  = Math.min(pesPerMPE, 4);
  const peRows  = Math.ceil(pesPerMPE / peCols);
  const peGap   = 8;
  const peW = (W - pad * 2 - peGap * (peCols - 1)) / peCols;
  const peH = (peAreaH - peGap * (peRows - 1)) / peRows;

  for (let i = 0; i < pesPerMPE; i++) {
    const col = i % peCols, row = Math.floor(i / peCols);
    const px = pad + col * (peW + peGap);
    const py = peAreaY + row * (peH + peGap);
    const pcx = px + peW / 2;

    // Arrow from CU to each PE (only first row)
    if (row === 0) {
      ctx.strokeStyle = '#a855f7'; ctx.lineWidth = 1; ctx.setLineDash([3, 2]);
      ctx.beginPath();
      ctx.moveTo(cuX + (col + 0.5) * (cuW / peCols), cuY + cuH);
      ctx.lineTo(pcx, py);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // PE box (outer)
    ctx.fillStyle = '#dcfce7'; ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(px, py, peW, peH, 5); ctx.fill(); ctx.stroke();

    // PE label
    ctx.fillStyle = '#166534'; ctx.font = `bold ${Math.max(8, Math.min(10, peW / 6))}px system-ui`;
    ctx.textAlign = 'center';
    ctx.fillText(`PE ${i}`, pcx, py + peH * 0.28);

    // SRAM micro-bar
    const barH = Math.max(4, peH * 0.18);
    ctx.fillStyle = '#dbeafe'; ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(px + 4, py + peH * 0.38, peW - 8, barH, 2); ctx.fill(); ctx.stroke();
    if (peW > 40) {
      ctx.fillStyle = '#1e40af'; ctx.font = `${Math.max(6, Math.min(8, peW / 8))}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('SRAM', pcx, py + peH * 0.38 + barH * 0.75);
    }

    // MAC micro-bar
    const macY2 = py + peH * 0.38 + barH + 4;
    const macBarH = Math.max(4, peH * 0.22);
    ctx.fillStyle = '#bbf7d0'; ctx.strokeStyle = '#16a34a'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.roundRect(px + 4, macY2, peW - 8, macBarH, 2); ctx.fill(); ctx.stroke();
    if (peW > 40) {
      ctx.fillStyle = '#14532d'; ctx.font = `${Math.max(6, Math.min(8, peW / 8))}px system-ui`;
      ctx.textAlign = 'center';
      ctx.fillText('MAC', pcx, macY2 + macBarH * 0.75);
    }
  }

  // ── Stats ──
  const peakFLOPs = (macsPerPE * 2 * pesPerMPE * (params.clockFreqGHz || 2)).toFixed(0);
  statsEl.innerHTML =
    `<div style="font-weight:700;font-size:13px;margin-bottom:10px;color:#1e293b">Multi-PE ${mpeIndex} Statistics</div>` +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">Compute</div>' +
      statRow('PEs', pesPerMPE) +
      statRow('MACs / PE / cycle', macsPerPE) +
      statRow('Peak GFLOPs/s', peakFLOPs) +
      statRow('Data type', params.dataType) +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">Memory</div>' +
      statRow('SRAM / PE', sramCapMB + ' MB') +
      statRow('SRAM banks / PE', params.sramNumBanks || 16) +
      statRow('Total SRAM', (sramCapMB * pesPerMPE) + ' MB') +
      statRow('HBM BW (share)', bwPerMPE + ' GB/s') +
      statRow('HBM latency', (params.hbmLatencyNs || 100) + ' ns') +
    '</div>' +
    '<div style="margin-bottom:12px">' +
      '<div style="font-size:10px;font-weight:700;text-transform:uppercase;color:#64748b;margin-bottom:5px">Control Unit</div>' +
      statRow('Bus width', params.busWidthBits + ' bits') +
      statRow('Burst length', params.burstLength + ' beats') +
      statRow('Interface', 'UCIe-A (to IO-Die)') +
    '</div>';
}

// ── Roofline Chart ─────────────────────────────────────────────────────────────

function drawRoofline(canvas, results) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 420;
  const H = 300;
  canvas.width = W;
  canvas.height = H;
  const p = { left: 56, right: 16, top: 20, bottom: 44 };
  const cW = W - p.left - p.right;
  const cH = H - p.top - p.bottom;

  const peakFLOPs = results.peakFLOPsPerSec / 1e9; // GFLOPs/s
  const peakBW = results.params.hbmBandwidthGBs;    // GB/s
  const ridge = results.ridgePoint;                  // FLOPs/Byte
  const ai = results.arithmeticIntensity;             // FLOPs/Byte
  const attained = Math.min(ai * peakBW, peakFLOPs);

  // Fix 1: x-range must always show both ridge and operating point
  const logRidge = Math.log10(Math.max(ridge, 0.01));
  const logAI = Math.log10(Math.max(ai, 0.01));
  const logXMin = Math.min(logRidge - 1, logAI - 1.5);
  const logXMax = Math.max(logRidge + 1, logAI + 1.5);
  const xMin = Math.pow(10, logXMin);
  const xMax = Math.pow(10, logXMax);

  const yMax = peakFLOPs * 2;
  const logYMax = Math.log10(yMax);
  const logYMin = Math.log10(peakFLOPs * 0.001);

  const toX = v => p.left + (Math.log10(Math.max(v, 1e-10)) - logXMin) / (logXMax - logXMin) * cW;
  const toY = v => p.top + cH - (Math.log10(Math.max(v, Math.pow(10, logYMin))) - logYMin) / (logYMax - logYMin) * cH;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.roundRect(p.left, p.top, cW, cH, 4);
  ctx.fill();

  // Grid
  ctx.strokeStyle = '#f1f5f9';
  ctx.lineWidth = 1;
  for (let xv = Math.ceil(logXMin); xv <= Math.floor(logXMax); xv++) {
    const x = toX(Math.pow(10, xv));
    if (x < p.left || x > p.left + cW) continue;
    ctx.beginPath(); ctx.moveTo(x, p.top); ctx.lineTo(x, p.top + cH); ctx.stroke();
  }
  for (let yv = Math.ceil(logYMin); yv <= Math.floor(logYMax); yv++) {
    const y = toY(Math.pow(10, yv));
    if (y < p.top || y > p.top + cH) continue;
    ctx.beginPath(); ctx.moveTo(p.left, y); ctx.lineTo(p.left + cW, y); ctx.stroke();
  }

  // Memory BW diagonal: draw from xMin to min(ridge, xMax), clipped to chart
  const bwLineEndX = Math.min(ridge, xMax);
  const bwLineStartX = xMin;
  const bwStartY = Math.min(p.top + cH, toY(bwLineStartX * peakBW));
  const bwEndPerf = Math.min(bwLineEndX * peakBW, peakFLOPs);
  const bwEndY = toY(bwEndPerf);

  ctx.beginPath();
  ctx.moveTo(toX(bwLineStartX), bwStartY);
  ctx.lineTo(toX(bwLineEndX), bwEndY);
  ctx.strokeStyle = '#3b82f6';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Compute ceiling (horizontal) from ridge to xMax
  const ridgeDrawX = Math.max(ridge, xMin);
  ctx.beginPath();
  ctx.moveTo(toX(ridgeDrawX), toY(peakFLOPs));
  ctx.lineTo(toX(xMax), toY(peakFLOPs));
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Vertical dashed line at ridge point
  if (ridge >= xMin && ridge <= xMax) {
    ctx.beginPath();
    ctx.moveTo(toX(ridge), toY(peakFLOPs));
    ctx.lineTo(toX(ridge), p.top + cH);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Ridge point label
    ctx.fillStyle = '#94a3b8';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText('ridge=' + ridge.toFixed(1), toX(ridge), p.top + cH + 24);
  }

  // Operating point
  const opX = toX(ai), opY = toY(attained);
  const opColor = results.bottleneck === 'MEMORY' ? '#ef4444'
    : results.bottleneck === 'COMPUTE' ? '#f59e0b' : '#22c55e';

  ctx.beginPath();
  ctx.arc(opX, opY, 7, 0, Math.PI * 2);
  ctx.fillStyle = opColor;
  ctx.fill();
  ctx.strokeStyle = 'white';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Axis labels
  ctx.fillStyle = '#64748b';
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Arithmetic Intensity (FLOPs/Byte)', p.left + cW / 2, H - 4);
  ctx.save();
  ctx.translate(12, p.top + cH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('Performance (GFLOPs/s)', 0, 0);
  ctx.restore();

  // X tick labels
  for (let xv = Math.ceil(logXMin); xv <= Math.floor(logXMax); xv++) {
    const x = toX(Math.pow(10, xv));
    if (x < p.left || x > p.left + cW) continue;
    const val = Math.pow(10, xv);
    ctx.textAlign = 'center';
    ctx.fillText(val >= 1 ? val.toFixed(0) : val.toPrecision(1), x, p.top + cH + 13);
  }

  // Y tick labels
  for (let yv = Math.ceil(logYMin); yv <= Math.floor(logYMax); yv++) {
    const y = toY(Math.pow(10, yv));
    if (y < p.top || y > p.top + cH) continue;
    const val = Math.pow(10, yv);
    ctx.textAlign = 'right';
    ctx.fillText(
      val >= 1e3 ? (val / 1e3).toFixed(0) + 'T' : val >= 1 ? val.toFixed(0) : val.toFixed(2),
      p.left - 4, y + 3
    );
  }

  // Operating point annotation
  ctx.fillStyle = opColor;
  ctx.font = '9px system-ui';
  ctx.textAlign = opX > p.left + cW * 0.7 ? 'right' : 'left';
  const annoOffset = opX > p.left + cW * 0.7 ? -10 : 10;
  ctx.fillText('AI=' + ai.toFixed(1) + ' F/B', opX + annoOffset, opY - 6);
  ctx.fillText(attained.toFixed(0) + ' GF/s', opX + annoOffset, opY + 6);

  // Legend
  const legendEl = document.getElementById('roofline-legend');
  if (legendEl) {
    legendEl.innerHTML =
      '<span style="display:flex;align-items:center;gap:4px">' +
        '<span style="width:16px;height:3px;background:#3b82f6;display:inline-block"></span>' +
        'Memory BW roof (' + peakBW + ' GB/s)' +
      '</span>' +
      '<span style="display:flex;align-items:center;gap:4px">' +
        '<span style="width:16px;height:3px;background:#f59e0b;display:inline-block"></span>' +
        'Compute roof (' + (peakFLOPs / 1e3).toFixed(1) + ' TF/s)' +
      '</span>' +
      '<span style="display:flex;align-items:center;gap:4px">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + opColor + ';display:inline-block"></span>' +
        'Operating point (' + results.bottleneck + ')' +
      '</span>';
  }
}

// ── Time Breakdown Chart ───────────────────────────────────────────────────────

function drawBreakdown(canvas, results) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 420;
  const H = 300;
  canvas.width = W;
  canvas.height = H;

  const items = [
    { label: 'Compute', value: results.computeCycles, color: '#22c55e' },
    { label: 'HBM Transfer', value: results.hbmCycles, color: '#ef4444' },
    { label: 'SRAM Access', value: results.sramCycles, color: '#3b82f6' },
    { label: 'Network', value: results.networkCycles, color: '#f59e0b' },
  ].filter(d => d.value > 0);

  const total = Math.max(...items.map(d => d.value));
  const barH = 36;
  const gap = 14;
  const pLeft = 90, pRight = 20, pTop = 20;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);

  items.forEach((item, i) => {
    const y = pTop + i * (barH + gap);
    const barW = (W - pLeft - pRight) * item.value / total;

    ctx.fillStyle = '#475569';
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(item.label, pLeft - 8, y + barH / 2 + 4);

    ctx.fillStyle = '#f1f5f9';
    ctx.beginPath();
    ctx.roundRect(pLeft, y, W - pLeft - pRight, barH, 4);
    ctx.fill();

    ctx.fillStyle = item.color;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.roundRect(pLeft, y, Math.max(barW, 2), barH, 4);
    ctx.fill();
    ctx.globalAlpha = 1;

    ctx.fillStyle = barW > 60 ? 'white' : '#334155';
    ctx.textAlign = 'left';
    ctx.font = '10px system-ui, sans-serif';
    const labelX = barW > 60 ? pLeft + 6 : pLeft + barW + 6;
    ctx.fillText(formatCycles(item.value) + ' cyc', labelX, y + barH / 2 + 4);

    const pct = (item.value / results.totalCycles * 100).toFixed(1);
    ctx.fillStyle = '#94a3b8';
    ctx.textAlign = 'right';
    ctx.fillText(pct + '%', W - pRight, y + barH / 2 + 4);
  });

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px system-ui';
  ctx.textAlign = 'left';
  ctx.fillText('* Critical path = max(compute, memory) with overlap', pLeft, pTop + items.length * (barH + gap) + 8);
}

// ── Timeline Chart ────────────────────────────────────────────────────────────

function drawTimeline(canvas, results) {
  const ctx = canvas.getContext('2d');
  const W = canvas.offsetWidth || 800;
  const H = 200;
  canvas.width = W;
  canvas.height = H;

  const pLeft = 100, pRight = 20, pTop = 20, pBot = 30;
  const totalCycles = results.totalCycles;

  const lanes = [
    { label: 'Weight Load\n(HBM->SRAM)', color: '#ef4444', fill: '#fee2e2', start: 0, end: results.weightTxn.totalCycles },
    { label: 'KV Cache\n(HBM->SRAM)',   color: '#f97316', fill: '#ffedd5', start: results.weightTxn.totalCycles, end: results.weightTxn.totalCycles + results.kvTxn.totalCycles },
    { label: 'Compute',                 color: '#22c55e', fill: '#dcfce7', start: 0, end: results.computeCycles },
    { label: 'SRAM Access',             color: '#3b82f6', fill: '#dbeafe', start: 0, end: results.sramCycles },
    { label: 'Network',                 color: '#f59e0b', fill: '#fef9c3', start: 0, end: results.networkCycles },
  ].filter(l => l.end > 0);

  const laneH = Math.floor((H - pTop - pBot) / lanes.length) - 2;
  const toX = c => pLeft + (c / totalCycles) * (W - pLeft - pRight);

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#fafafa';
  ctx.fillRect(0, 0, W, H);

  lanes.forEach((lane, i) => {
    const y = pTop + i * (laneH + 2);
    ctx.fillStyle = '#475569';
    ctx.font = '9px system-ui';
    ctx.textAlign = 'right';
    const lines = lane.label.split('\n');
    lines.forEach((line, li) => {
      ctx.fillText(line, pLeft - 6, y + (laneH / (lines.length + 1)) * (li + 1) + 3);
    });

    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(pLeft, y, W - pLeft - pRight, laneH);

    const bx = toX(lane.start), bw = toX(lane.end) - toX(lane.start);
    if (bw > 0) {
      ctx.fillStyle = lane.fill;
      ctx.fillRect(bx, y + 1, bw, laneH - 2);
      ctx.strokeStyle = lane.color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(bx, y + 1, bw, laneH - 2);
    }
  });

  const cpX = toX(totalCycles);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath(); ctx.moveTo(cpX, pTop); ctx.lineTo(cpX, H - pBot); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#334155';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'right';
  ctx.fillText('Critical: ' + formatCycles(totalCycles), cpX - 2, H - pBot + 12);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  const tickCount = 6;
  for (let t = 0; t <= tickCount; t++) {
    const c = (totalCycles / tickCount) * t;
    const x = toX(c);
    ctx.fillText(formatCycles(c), x, H - pBot + 12);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pTop); ctx.lineTo(x, H - pBot); ctx.stroke();
  }
}
