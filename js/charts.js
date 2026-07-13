/**
 * Charts Module (Vanilla JS)
 * Real-time Chart.js configuration and update logic
 * 
 * Performance optimizations:
 *  - Throttled updates (200ms minimum between chart redraws)
 *  - Reduced sparkline buffer (15 points)
 *  - 'none' animation mode for live data
 * 
 * Depends on: Chart.js loaded via CDN (window.Chart)
 */

(function () {
  'use strict';

  // Chart data buffers (keep last 50 data points)
  var MAX_DATA_POINTS = 50;
  var SPARKLINE_DATA_POINTS = 15; // Reduced from 20 for mobile perf
  var chartData = {
    labels: [],
    voltage: [],
    current: [],
    power: []
  };

  var mainChart = null;
  var currentView = 'voltage'; // 'voltage' | 'current' | 'power' | 'all'

  // Sparkline charts
  var sparklines = {};

  // ============================================
  // THROTTLE — prevents chart redraws faster than 200ms
  // ============================================
  var lastMainChartUpdate = 0;
  var pendingMainUpdate = false;
  var lastSparklineUpdates = {};
  var pendingSparklineUpdates = {};

  var THROTTLE_MS = 200;

  function throttledMainChartUpdate() {
    var now = performance.now();
    if (now - lastMainChartUpdate >= THROTTLE_MS) {
      lastMainChartUpdate = now;
      if (mainChart) mainChart.update('none');
      pendingMainUpdate = false;
    } else if (!pendingMainUpdate) {
      pendingMainUpdate = true;
      setTimeout(function () {
        lastMainChartUpdate = performance.now();
        if (mainChart) mainChart.update('none');
        pendingMainUpdate = false;
      }, THROTTLE_MS - (now - lastMainChartUpdate));
    }
  }

  function throttledSparklineUpdate(id) {
    var chart = sparklines[id];
    if (!chart) return;

    var now = performance.now();
    var lastUpdate = lastSparklineUpdates[id] || 0;

    if (now - lastUpdate >= THROTTLE_MS) {
      lastSparklineUpdates[id] = now;
      chart.update('none');
      pendingSparklineUpdates[id] = false;
    } else if (!pendingSparklineUpdates[id]) {
      pendingSparklineUpdates[id] = true;
      setTimeout(function () {
        lastSparklineUpdates[id] = performance.now();
        chart.update('none');
        pendingSparklineUpdates[id] = false;
      }, THROTTLE_MS - (now - lastUpdate));
    }
  }

  /**
   * Initialize the main chart
   */
  function initMainChart(canvasId) {
    var ctx = document.getElementById(canvasId);
    if (!ctx) return;

    mainChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: chartData.labels,
        datasets: [
          {
            label: 'Voltage (V)',
            data: chartData.voltage,
            borderColor: '#10b981',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#10b981',
            hidden: false
          },
          {
            label: 'Current (A)',
            data: chartData.current,
            borderColor: '#3b82f6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#3b82f6',
            hidden: true
          },
          {
            label: 'Power (W)',
            data: chartData.power,
            borderColor: '#8b5cf6',
            backgroundColor: 'transparent',
            borderWidth: 2,
            fill: false,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: '#8b5cf6',
            hidden: true
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        plugins: {
          legend: {
            display: true,
            position: 'top',
            align: 'end',
            labels: {
              color: '#8892a4',
              font: { family: 'Inter', size: 11, weight: '500' },
              boxWidth: 12,
              boxHeight: 2,
              padding: 16,
              usePointStyle: true,
              pointStyle: 'line'
            }
          },
          tooltip: {
            backgroundColor: 'rgba(15, 22, 36, 0.95)',
            titleColor: '#e8edf5',
            bodyColor: '#8892a4',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            padding: 12,
            bodyFont: { family: 'JetBrains Mono', size: 12 },
            titleFont: { family: 'Inter', size: 12, weight: '600' },
            cornerRadius: 8,
            displayColors: true,
            boxWidth: 8,
            boxHeight: 8,
            boxPadding: 4
          }
        },
        scales: {
          x: {
            grid: {
              color: 'rgba(255, 255, 255, 0.03)',
              drawBorder: false
            },
            ticks: {
              color: '#505a6e',
              font: { family: 'JetBrains Mono', size: 10 },
              maxRotation: 0,
              maxTicksLimit: 10
            },
            border: { display: false }
          },
          y: {
            grid: {
              color: 'rgba(255, 255, 255, 0.03)',
              drawBorder: false
            },
            ticks: {
              color: '#505a6e',
              font: { family: 'JetBrains Mono', size: 10 },
              padding: 8
            },
            border: { display: false },
            beginAtZero: true
          }
        },
        animation: false  // Disable all animations for live data performance
      }
    });

    return mainChart;
  }

  /**
   * Initialize a mini sparkline chart for sensor cards
   */
  function initSparkline(containerId, color) {
    var container = document.getElementById(containerId);
    if (!container) return null;

    // Create canvas
    var canvas = document.createElement('canvas');
    container.appendChild(canvas);

    var chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: [],
        datasets: [{
          data: [],
          borderColor: color,
          backgroundColor: 'transparent',
          borderWidth: 1.5,
          fill: false,
          tension: 0.4,
          pointRadius: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
        scales: {
          x: { display: false },
          y: { display: false }
        },
        animation: false,  // Disable for performance
        elements: { line: { borderCapStyle: 'round' } }
      }
    });

    sparklines[containerId] = chart;
    return chart;
  }

  /**
   * Add new data point to charts (throttled)
   */
  function addDataPoint(voltage, current, power) {
    var now = new Date();
    var timeLabel = now.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    // Main chart data
    chartData.labels.push(timeLabel);
    chartData.voltage.push(voltage);
    chartData.current.push(current);
    chartData.power.push(power);

    // Trim to max data points
    if (chartData.labels.length > MAX_DATA_POINTS) {
      chartData.labels.shift();
      chartData.voltage.shift();
      chartData.current.shift();
      chartData.power.shift();
    }

    // Throttled update — won't redraw more than once per 200ms
    throttledMainChartUpdate();

    // Update sparklines (also throttled)
    updateSparkline('voltage-sparkline', voltage);
    updateSparkline('current-sparkline', current);
    updateSparkline('power-sparkline', power);
  }

  /**
   * Update a sparkline with new data (throttled)
   */
  function updateSparkline(id, value) {
    var chart = sparklines[id];
    if (!chart) return;

    chart.data.labels.push('');
    chart.data.datasets[0].data.push(value);

    // Keep last SPARKLINE_DATA_POINTS for sparklines
    if (chart.data.labels.length > SPARKLINE_DATA_POINTS) {
      chart.data.labels.shift();
      chart.data.datasets[0].data.shift();
    }

    throttledSparklineUpdate(id);
  }

  /**
   * Update sparklines for temperature and humidity
   */
  function addEnvironmentData(temperature, humidity) {
    updateSparkline('temp-sparkline', temperature);
    updateSparkline('humidity-sparkline', humidity);
  }

  /**
   * Switch chart view mode
   */
  function setChartView(view) {
    currentView = view;
    if (!mainChart) return;

    var datasets = mainChart.data.datasets;

    switch (view) {
      case 'voltage':
        datasets[0].hidden = false;
        datasets[1].hidden = true;
        datasets[2].hidden = true;
        break;
      case 'current':
        datasets[0].hidden = true;
        datasets[1].hidden = false;
        datasets[2].hidden = true;
        break;
      case 'power':
        datasets[0].hidden = true;
        datasets[1].hidden = true;
        datasets[2].hidden = false;
        break;
      case 'all':
        datasets[0].hidden = false;
        datasets[1].hidden = false;
        datasets[2].hidden = false;
        break;
    }

    mainChart.update();
  }

  // ============================================
  // EXPOSE GLOBALLY
  // ============================================
  window.AppCharts = {
    initMainChart: initMainChart,
    initSparkline: initSparkline,
    addDataPoint: addDataPoint,
    addEnvironmentData: addEnvironmentData,
    setChartView: setChartView,
    chartData: chartData,
    getMainChart: function () { return mainChart; }
  };

})();
