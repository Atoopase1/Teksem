/**
 * Smart Energy Monitor & Control System (Vanilla JS)
 * Main Application Entry Point
 * 
 * This module orchestrates all components:
 * - Real-time data from Supabase (or demo simulator)
 * - Chart rendering and updates
 * - Alert analysis and display
 * - Relay control
 * - Energy balance tracking
 * 
 * Depends on:
 *   window.AppSupabase  (js/supabase.js)
 *   window.AppCharts    (js/charts.js)
 *   window.AppAlerts    (js/alerts.js)
 *   window.AppDemo      (js/demo.js)
 */

(function () {
  'use strict';

  // Shorthand references (set after DOMContentLoaded)
  var supabase, isDemoMode;
  var initMainChart, initSparkline, addDataPoint, addEnvironmentData, setChartView;
  var analyzeData, saveAlert, autoShutoffRelay, getSystemStatus, updateLimits, THRESHOLDS, clearAllAlerts;
  var generateDemoData, getDemoEnergy, setDemoRelay, setDemoEnergyBought, getDemoRelay;

  // ============================================
  // AUTO CACHE-BUSTING
  // ============================================
  var APP_VERSION = '1.2.3'; // Bump this to force client-side cache clear
  if (localStorage.getItem('energy_app_version') !== APP_VERSION) {
    console.log('🔄 New version detected! Clearing cached service workers...');
    localStorage.setItem('energy_app_version', APP_VERSION);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then(function (registrations) {
        for (var i = 0; i < registrations.length; i++) {
          registrations[i].unregister();
        }
        setTimeout(function () { window.location.reload(true); }, 500);
      });
    }
  }

  // ============================================
  // APPLICATION STATE
  // ============================================
  var state = {
    relayOn: false,
    lastUpdate: null,
    startTime: Date.now(),
    connected: false,
    alerts: [],
    currentData: { voltage: 0, current: 0, power: 0, temperature: 0, humidity: 0 },
    energy: { total_energy_bought: 0, energy_used: 0, energy_remaining: 0 },
    updateInterval: null,
    previousData: { voltage: 0, current: 0, power: 0, temperature: 0, humidity: 0 },
    staleTimer: null,
    realtimeChannels: [],
    pendingRafUpdate: false
  };

  // ============================================
  // INITIALIZATION
  // ============================================
  document.addEventListener('DOMContentLoaded', function () {
    // Bind module references
    supabase = window.AppSupabase.supabase;
    isDemoMode = window.AppSupabase.isDemoMode;

    initMainChart = window.AppCharts.initMainChart;
    initSparkline = window.AppCharts.initSparkline;
    addDataPoint = window.AppCharts.addDataPoint;
    addEnvironmentData = window.AppCharts.addEnvironmentData;
    setChartView = window.AppCharts.setChartView;

    analyzeData = window.AppAlerts.analyzeData;
    saveAlert = window.AppAlerts.saveAlert;
    autoShutoffRelay = window.AppAlerts.autoShutoffRelay;
    getSystemStatus = window.AppAlerts.getSystemStatus;
    updateLimits = window.AppAlerts.updateLimits;
    THRESHOLDS = window.AppAlerts.THRESHOLDS;
    clearAllAlerts = window.AppAlerts.clearAllAlerts;

    generateDemoData = window.AppDemo.generateDemoData;
    getDemoEnergy = window.AppDemo.getDemoEnergy;
    setDemoRelay = window.AppDemo.setDemoRelay;
    setDemoEnergyBought = window.AppDemo.setDemoEnergyBought;
    getDemoRelay = window.AppDemo.getDemoRelay;

    // Show loading screen, then initialize
    setTimeout(function () {
      initializeApp();
    }, 2200); // Match loading animation duration

    // Register PWA Service Worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(function (err) {
        console.log('SW registration failed: ', err);
      });
    }

    // Request notification permission
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().then(function (permission) {
        if (permission === 'granted') {
          console.log('✅ Notification permission granted');
        } else {
          console.warn('⚠️ Notification permission denied — background alerts will not show');
        }
      });
    }
  });

  // ============================================
  // AUDIO CONTEXT INITIALIZATION (Mobile Fix)
  // ============================================
  var audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      var AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        audioCtx = new AudioContext();
        // Play a silent note to "unlock" the audio context on mobile
        var oscillator = audioCtx.createOscillator();
        var gainNode = audioCtx.createGain();
        gainNode.gain.value = 0; // Silent
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        oscillator.start(0);
        oscillator.stop(audioCtx.currentTime + 0.001);
      }
    } else if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
  }

  // Unlock audio on first user interaction
  document.addEventListener('click', initAudio, { once: true });
  document.addEventListener('touchstart', initAudio, { once: true });

  // Resume audio when user returns to the app after backgrounding it
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible' && audioCtx) {
      audioCtx.resume().catch(function () {});
    }
  });


  function initializeApp() {
    // Hide loading, show app
    var loadingScreen = document.getElementById('loading-screen');
    var mainApp = document.getElementById('main-app');

    // First, make main app visible (needed for chart canvas sizing)
    mainApp.classList.remove('hidden');

    // Then fade out loading screen
    loadingScreen.classList.add('fade-out');
    setTimeout(function () {
      loadingScreen.classList.add('hidden');
    }, 600);

    // Small delay to ensure DOM layout is calculated before chart init
    setTimeout(function () {
      // Initialize charts (must be done after mainApp is visible)
      initMainChart('main-chart');
      initSparkline('voltage-sparkline', '#10b981'); // Emerald
      initSparkline('current-sparkline', '#3b82f6'); // Blue
      initSparkline('power-sparkline', '#8b5cf6');   // Purple
      initSparkline('temp-sparkline', '#f59e0b');     // Amber
      initSparkline('humidity-sparkline', '#06b6d4'); // Cyan

      // Setup event listeners
      setupEventListeners();

      // Start data flow
      if (isDemoMode) {
        console.log('🎮 Running in DEMO mode - simulated data active');
        showToast('Demo Mode: Simulated data active', 'info');
        state.connected = true;
        updateConnectionStatus(true);
        startDemoMode();
      } else {
        console.log('🔌 Connecting to Supabase...');
        initializeSupabase();
        
        console.log('🔌 Initializing MQTT for Realtime...');
        setupMQTT();
      }

      // Start uptime counter
      setInterval(updateUptime, 1000);

      // Stale data detection — mark cards stale if no data for 15s
      startStaleDetection();

      // Catch-up on tab re-focus — fetch latest data immediately
      document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible' && !isDemoMode && state.connected) {
          fetchLatestSensorData();
        }
      });
    }, 100);
  }

  // ============================================
  // EVENT LISTENERS
  // ============================================
  function setupEventListeners() {
    // Chart tab switching
    var tabs = document.querySelectorAll('.chart-tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function (e) {
        var allTabs = document.querySelectorAll('.chart-tab');
        for (var j = 0; j < allTabs.length; j++) {
          allTabs[j].classList.remove('active');
        }
        e.target.classList.add('active');
        setChartView(e.target.dataset.chart);
      });
    }

    // Relay toggle
    var relayToggle = document.getElementById('relay-toggle');
    relayToggle.addEventListener('change', function (e) {
      var newState = e.target.checked;
      toggleRelay(newState);
    });

    // Energy update button
    var energyBtn = document.getElementById('energy-update-btn');
    energyBtn.addEventListener('click', function () {
      var input = document.getElementById('energy-bought-input');
      var value = parseFloat(input.value);
      if (isNaN(value) || value < 0) {
        showToast('Please enter a valid energy amount', 'error');
        return;
      }
      updateEnergyBought(value);
      showToast('Energy balance updated: ' + value + ' kWh', 'success');
    });

    // Clear alerts
    var clearBtn = document.getElementById('clear-alerts-btn');
    clearBtn.addEventListener('click', function () {
      state.alerts = [];
      debouncedRenderAlerts();
      isAlarmMuted = true;
      manageAlarmState('normal');

      // Permanently delete from database
      clearAllAlerts();

      showToast('Alerts cleared & alarm muted', 'info');
    });

    // Limits update button
    var limitsBtn = document.getElementById('limits-update-btn');
    var powerInput = document.getElementById('limit-power-input');
    var currentInput = document.getElementById('limit-current-input');

    // Set initial values
    if (powerInput && currentInput) {
      powerInput.value = THRESHOLDS.POWER_FAULT;
      currentInput.value = THRESHOLDS.CURRENT_FAULT;
    }

    if (limitsBtn) {
      limitsBtn.addEventListener('click', function () {
        var pValue = parseFloat(powerInput.value);
        var cValue = parseFloat(currentInput.value);

        if (isNaN(pValue) || isNaN(cValue) || pValue <= 0 || cValue <= 0) {
          showToast('Please enter valid positive numbers for limits', 'error');
          return;
        }

        limitsBtn.disabled = true;
        limitsBtn.textContent = 'Saving...';

        updateLimits(pValue, cValue).then(function () {
          limitsBtn.disabled = false;
          limitsBtn.textContent = 'Save Limits';
          showToast('Limits updated: Power ' + pValue + 'W, Current ' + cValue + 'A', 'success');
        });
      });
    }

    // Connection button (retry connection)
    var connectionBtn = document.getElementById('connection-btn');
    connectionBtn.addEventListener('click', function () {
      if (isDemoMode) {
        showToast('Configure Supabase credentials to connect', 'info');
      } else {
        initializeSupabase();
      }
    });

    // Theme toggle
    var themeToggle = document.getElementById('theme-toggle-btn');
    var sunIcon = document.getElementById('sun-icon');
    var moonIcon = document.getElementById('moon-icon');

    themeToggle.addEventListener('click', function () {
      var isDark = document.documentElement.getAttribute('data-theme') !== 'light';
      if (isDark) {
        document.documentElement.setAttribute('data-theme', 'light');
        localStorage.setItem('theme', 'light');
        sunIcon.classList.add('hidden');
        moonIcon.classList.remove('hidden');
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        sunIcon.classList.remove('hidden');
        moonIcon.classList.add('hidden');
      }
    });

    // Init theme from localStorage
    if (localStorage.getItem('theme') === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      sunIcon.classList.add('hidden');
      moonIcon.classList.remove('hidden');
    } else {
      sunIcon.classList.remove('hidden');
      moonIcon.classList.add('hidden');
    }
  }

  // ============================================
  // SUPABASE INTEGRATION
  // ============================================
  function initializeSupabase() {
    // PARALLEL FETCH — all 4 queries at once
    Promise.all([
      supabase.from('control').select('*').eq('id', 1).maybeSingle(),
      supabase.from('user_energy').select('*').eq('id', 1).maybeSingle(),
      supabase.from('alerts').select('*').order('created_at', { ascending: false }).limit(20),
      supabase.from('sensor_data').select('*').order('created_at', { ascending: false }).limit(1).maybeSingle()
    ]).then(function (results) {
      var controlResult = results[0];
      var energyResult = results[1];
      var alertsResult = results[2];
      var sensorResult = results[3];

      // Apply control state
      if (controlResult.data) {
        state.relayOn = controlResult.data.relay_status;
        updateRelayUI(state.relayOn);
        if (controlResult.data.power_limit) THRESHOLDS.POWER_FAULT = controlResult.data.power_limit;
        if (controlResult.data.current_limit) THRESHOLDS.CURRENT_FAULT = controlResult.data.current_limit;
        var pi = document.getElementById('limit-power-input');
        var ci = document.getElementById('limit-current-input');
        if (pi) pi.value = THRESHOLDS.POWER_FAULT;
        if (ci) ci.value = THRESHOLDS.CURRENT_FAULT;
      }

      // Apply energy state
      if (energyResult.data) {
        state.energy = energyResult.data;
        updateEnergyUI();
      }

      // Apply alerts
      if (alertsResult.data) {
        state.alerts = alertsResult.data.map(function (a) {
          return {
            type: a.type,
            message: a.message,
            time: new Date(a.created_at)
          };
        });
        renderAlerts();
      }

      // Apply latest sensor data
      if (sensorResult.data) {
        processSensorData(sensorResult.data);
      }

      // REALTIME SUBSCRIPTIONS
      setupRealtimeSubscriptions();

      state.connected = true;
      updateConnectionStatus(true);
      showToast('Connected to Supabase', 'success');

    }).catch(function (err) {
      console.error('Supabase initialization error:', err);
      state.connected = false;
      updateConnectionStatus(false);
      showToast('Connection failed. Check credentials.', 'error');
    });
  }

  // ============================================
  // MQTT INTEGRATION (REALTIME WEB SOCKETS)
  // ============================================
  function setupMQTT() {
    // Connect to EMQX public broker over WebSockets securely
    var brokerUrl = 'wss://broker.emqx.io:8084/mqtt';
    var topic = 'teksem/energy/data';
    
    console.log('🔌 Connecting to MQTT Broker:', brokerUrl);
    
    // Ensure the mqtt library is loaded
    if (typeof mqtt === 'undefined') {
      console.error('MQTT library not loaded!');
      return;
    }
    
    var client = mqtt.connect(brokerUrl);
    
    client.on('connect', function () {
      console.log('✅ Connected to MQTT Broker via WebSockets');
      client.subscribe(topic, function (err) {
        if (!err) {
          console.log('📡 Subscribed to MQTT Topic:', topic);
        }
      });
    });
    
    client.on('message', function (receivedTopic, message) {
      if (receivedTopic === topic) {
        try {
          var data = JSON.parse(message.toString());
          // Update the UI immediately with the realtime payload
          processSensorData(data);
        } catch (e) {
          console.warn('Failed to parse MQTT payload:', e);
        }
      }
    });
    
    client.on('error', function (err) {
      console.warn('MQTT Error:', err);
    });
  }

  /**
   * Setup realtime subscriptions with connection health monitoring
   */
  function setupRealtimeSubscriptions() {
    // We now use MQTT for real-time sensor data, so we don't need Supabase 
    // to notify us of every single insert (prevents double-plotting on charts).
    /*
    var sensorChannel = supabase
      .channel('sensor-data-changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'sensor_data'
      }, function (payload) {
        processSensorData(payload.new);
      })
      .subscribe(function (status) {
        handleChannelStatus('sensor-data', status);
      });
    */

    // Control channel
    var controlChannel = supabase
      .channel('control-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'control'
      }, function (payload) {
        state.relayOn = payload.new.relay_status;
        updateRelayUI(state.relayOn);
        if (payload.new.power_limit && payload.new.power_limit !== THRESHOLDS.POWER_FAULT) THRESHOLDS.POWER_FAULT = payload.new.power_limit;
        if (payload.new.current_limit && payload.new.current_limit !== THRESHOLDS.CURRENT_FAULT) THRESHOLDS.CURRENT_FAULT = payload.new.current_limit;
        var pi = document.getElementById('limit-power-input');
        var ci = document.getElementById('limit-current-input');
        if (pi) pi.value = THRESHOLDS.POWER_FAULT;
        if (ci) ci.value = THRESHOLDS.CURRENT_FAULT;
      })
      .subscribe();

    // Energy channel
    var energyChannel = supabase
      .channel('energy-changes')
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'user_energy'
      }, function (payload) {
        state.energy = payload.new;
        updateEnergyUI();
      })
      .subscribe();

    // Alerts channel
    var alertsChannel = supabase
      .channel('alerts-changes')
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'alerts'
      }, function (payload) {
        var alert = {
          type: payload.new.type,
          message: payload.new.message,
          time: new Date(payload.new.created_at)
        };
        state.alerts.unshift(alert);
        debouncedRenderAlerts();
      })
      .subscribe();

    state.realtimeChannels = [controlChannel, energyChannel, alertsChannel];
  }

  /**
   * Handle realtime channel status changes for connection health
   */
  function handleChannelStatus(channelName, status) {
    console.log('📡 Channel [' + channelName + ']: ' + status);
    if (status === 'SUBSCRIBED') {
      state.connected = true;
      updateConnectionStatus(true);
      fetchLatestSensorData();
    } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
      state.connected = false;
      updateConnectionStatus(false, true);
      showToast('Connection lost. Reconnecting...', 'error');
    }
  }

  /**
   * Fetch the latest sensor reading (used for catch-up after reconnect or tab focus)
   */
  function fetchLatestSensorData() {
    supabase
      .from('sensor_data')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(function (result) {
        if (result.data) processSensorData(result.data);
      })
      .catch(function (e) {
        console.warn('Failed to fetch latest sensor data:', e);
      });
  }

  /**
   * Stale data detection — adds visual indicator when data is old
   */
  var STALE_THRESHOLD_MS = 15000; // 15 seconds

  function startStaleDetection() {
    setInterval(function () {
      var cards = document.querySelectorAll('.sensor-card');
      if (!state.lastUpdate) return;
      var age = Date.now() - state.lastUpdate.getTime();
      if (age > STALE_THRESHOLD_MS && !isDemoMode) {
        for (var i = 0; i < cards.length; i++) cards[i].classList.add('stale');
      } else {
        for (var i = 0; i < cards.length; i++) cards[i].classList.remove('stale');
      }
    }, 3000);
  }

  /**
   * Debounced alert rendering — prevents rapid-fire DOM rewrites
   */
  var alertRenderTimer = null;
  function debouncedRenderAlerts() {
    if (alertRenderTimer) clearTimeout(alertRenderTimer);
    alertRenderTimer = setTimeout(function () { renderAlerts(); }, 300);
  }

  // ============================================
  // DEMO MODE
  // ============================================
  function startDemoMode() {
    // Generate initial data points for charts
    for (var i = 0; i < 15; i++) {
      var data = generateDemoData();
      addDataPoint(data.voltage, data.current, data.power);
      addEnvironmentData(data.temperature, data.humidity);
    }

    // Set initial energy
    state.energy = getDemoEnergy();
    updateEnergyUI();
    state.relayOn = getDemoRelay();
    updateRelayUI(state.relayOn);

    // Update every 0.5s for near-instant real-time feel
    state.updateInterval = setInterval(function () {
      var data = generateDemoData();
      processSensorData(data);

      // Update energy
      state.energy = getDemoEnergy();
      updateEnergyUI();
    }, 500);
  }

  // ============================================
  // DATA PROCESSING
  // ============================================
  // Interval reference for energy accumulation
  var lastEnergyUpdateTime = null;

  function processSensorData(data) {
    // Calculate power if not provided
    var power = data.power || (data.voltage * data.current);

    // ── Accumulate energy_used from live power readings ──────────
    // Wh = W × h; we convert the elapsed seconds to hours
    if (!isDemoMode && lastEnergyUpdateTime !== null && power > 0) {
      var elapsedHours = (Date.now() - lastEnergyUpdateTime) / 3600000;
      var deltaKWh = (power / 1000) * elapsedHours;

      if (deltaKWh > 0) {
        var newUsed      = (state.energy.energy_used || 0) + deltaKWh;
        var newRemaining = Math.max(0, (state.energy.total_energy_bought || 0) - newUsed);

        // Optimistic local update
        state.energy.energy_used      = newUsed;
        state.energy.energy_remaining = newRemaining;
        updateEnergyUI();

        // Persist to Supabase every ~30 seconds to avoid hammering the DB
        if (!state._lastEnergySync || (Date.now() - state._lastEnergySync) > 30000) {
          state._lastEnergySync = Date.now();
          supabase.from('user_energy').update({
            energy_used: newUsed,
            energy_remaining: newRemaining
          }).eq('id', 1).catch(function (e) {
            console.warn('Energy sync failed:', e);
          });
        }
      }
    }
    lastEnergyUpdateTime = Date.now();
    // ─────────────────────────────────────────────────────────────

    // Batch updates using requestAnimationFrame for performance
    if (!state.pendingRafUpdate) {
      state.pendingRafUpdate = true;
      requestAnimationFrame(function () {
        // Store previous data for trend
        state.previousData = {
          voltage: state.currentData.voltage,
          current: state.currentData.current,
          power: state.currentData.power,
          temperature: state.currentData.temperature,
          humidity: state.currentData.humidity
        };

        state.currentData = {
          voltage: data.voltage,
          current: data.current,
          power: power,
          temperature: data.temperature,
          humidity: data.humidity
        };

        // Update UI values
        updateSensorValues(state.currentData);

        // Add to charts
        addDataPoint(data.voltage, data.current, power);
        addEnvironmentData(data.temperature, data.humidity);

        // Run alert analysis
        var alerts = analyzeData(state.currentData, state.energy);
        if (alerts.length > 0) {
          processAlerts(alerts);
        }

        // Update system status
        var status = getSystemStatus(alerts);
        updateSystemStatus(status);

        // Manage continuous alarm based on status
        manageAlarmState(status);

        // Update last update time
        state.lastUpdate = new Date();
        updateLastUpdateTime();

        state.pendingRafUpdate = false;
      });
    }
  }

  // ============================================
  // UI UPDATE FUNCTIONS
  // ============================================

  /**
   * Update sensor value cards with animation
   */
  function updateSensorValues(data) {
    animateValue('voltage-value', data.voltage.toFixed(1));
    animateValue('current-value', data.current.toFixed(2));
    animateValue('power-value', data.power.toFixed(1));
    animateValue('temp-value', data.temperature.toFixed(1));
    animateValue('humidity-value', data.humidity.toFixed(1));

    // Update trends
    updateTrend('voltage-trend', data.voltage, state.previousData.voltage);
    updateTrend('current-trend', data.current, state.previousData.current);
    updateTrend('power-trend', data.power, state.previousData.power);
    updateTrend('temp-trend', data.temperature, state.previousData.temperature);
    updateTrend('humidity-trend', data.humidity, state.previousData.humidity);
  }

  function animateValue(elementId, newValue) {
    var el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = newValue;
    el.classList.remove('value-updated');
    // Trigger reflow for animation restart
    void el.offsetWidth;
    el.classList.add('value-updated');
  }

  function updateTrend(elementId, current, previous) {
    var el = document.getElementById(elementId);
    if (!el) return;

    var diff = current - previous;
    if (Math.abs(diff) < 0.01) {
      el.textContent = '—';
      el.className = 'card-trend neutral';
    } else if (diff > 0) {
      el.textContent = '▲ ' + Math.abs(diff).toFixed(1);
      el.className = 'card-trend up';
    } else {
      el.textContent = '▼ ' + Math.abs(diff).toFixed(1);
      el.className = 'card-trend down';
    }
  }

  /**
   * Update relay UI state
   */
  function updateRelayUI(isOn) {
    var toggle = document.getElementById('relay-toggle');
    var ring = document.getElementById('relay-status-ring');
    var text = document.getElementById('relay-status-text');

    toggle.checked = isOn;
    ring.className = 'relay-ring ' + (isOn ? 'on' : 'off');
    text.textContent = isOn ? 'ON' : 'OFF';
    text.style.color = isOn ? 'var(--color-normal)' : 'var(--color-danger)';
  }

  /**
   * Update energy balance UI
   */
  function updateEnergyUI() {
    var total = state.energy.total_energy_bought;
    var used = state.energy.energy_used;
    var remaining = state.energy.energy_remaining;

    document.getElementById('energy-bought').textContent = total.toFixed(2) + ' kWh';
    document.getElementById('energy-used').textContent = used.toFixed(2) + ' kWh';
    document.getElementById('energy-remaining').textContent = remaining.toFixed(2) + ' kWh';

    // Progress bar
    var percent = total > 0
      ? Math.max(0, Math.min(100, (remaining / total) * 100))
      : 0;

    var fill = document.getElementById('energy-progress-fill');
    var percentText = document.getElementById('energy-percent');

    fill.style.width = percent + '%';
    percentText.textContent = percent.toFixed(0) + '%';

    // Color-code based on remaining
    if (percent <= 10) {
      fill.style.background = 'linear-gradient(90deg, #ff3b5c, #ff6b9d)';
      percentText.style.color = 'var(--color-danger)';
    } else if (percent <= 25) {
      fill.style.background = 'linear-gradient(90deg, #ffbe0b, #ffd166)';
      percentText.style.color = 'var(--color-warning)';
    } else {
      fill.style.background = 'var(--accent-gradient, var(--accent-primary))';
      percentText.style.color = 'var(--accent-primary)';
    }
  }

  /**
   * Update system status badge in header
   */
  function updateSystemStatus(status) {
    var statusEl = document.getElementById('system-status');
    var statusText = statusEl.querySelector('.status-text');

    statusEl.className = 'system-status status-' + status;
    statusText.textContent = status.toUpperCase();
  }

  /**
   * Update connection status
   */
  function updateConnectionStatus(connected, reconnecting) {
    reconnecting = reconnecting || false;
    var btn = document.getElementById('connection-btn');
    btn.className = 'connection-btn ' + (connected ? 'connected' : (reconnecting ? 'reconnecting' : 'disconnected'));

    if (connected) {
      btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M5 12.55a11 11 0 0114.08 0M1.42 9a16 16 0 0121.16 0M8.53 16.11a6 6 0 016.95 0M12 20h.01"/>' +
        '</svg>';
    } else if (reconnecting) {
      btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M21.5 2v6h-6M21.34 15.57a10 10 0 11-.32-9.54l-3 3"/>' +
        '</svg>';
    } else {
      btn.innerHTML =
        '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' +
        '<path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0119 12.55M5 12.55a10.94 10.94 0 015.17-2.39M10.71 5.05A16 16 0 0122.56 9M1.42 9a15.91 15.91 0 014.7-2.88M8.53 16.11a6 6 0 016.95 0M12 20h.01" />' +
        '</svg>';
    }
  }

  /**
   * Update last update timestamp
   */
  function updateLastUpdateTime() {
    if (!state.lastUpdate) return;
    var el = document.getElementById('last-update');
    el.textContent = state.lastUpdate.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  }

  /**
   * Update uptime display
   */
  function updateUptime() {
    var elapsed = Date.now() - state.startTime;
    var hours = Math.floor(elapsed / 3600000);
    var minutes = Math.floor((elapsed % 3600000) / 60000);
    document.getElementById('uptime').textContent = hours + 'h ' + minutes + 'm';
  }

  // ============================================
  // NATIVE OS NOTIFICATIONS
  // ============================================
  function sendNativeNotification(alert) {
    if (!('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    if (!('serviceWorker' in navigator)) return;

    var isCritical = alert.type === 'faulty' || alert.severity === 'critical';

    navigator.serviceWorker.ready.then(function (registration) {
      registration.showNotification(
        isCritical ? '🚨 Smart Energy — CRITICAL FAULT' : '⚠️ Smart Energy — Warning',
        {
          body: alert.message,
          icon: '/icon-192.png',
          badge: '/icon-192.png',
          vibrate: isCritical ? [400, 100, 400, 100, 600] : [200, 100, 200],
          tag: alert.type,
          renotify: true,
          requireInteraction: isCritical,
          silent: false
        }
      );
    }).catch(function (e) {
      console.warn('Could not show notification:', e);
    });
  }

  // ============================================
  // ALERT HANDLING
  // ============================================

  // Track last-alerted value per type for the alert LOG (30s cooldown)
  var lastAlertedValue = {};

  function processAlerts(alerts) {
    var newAlertAdded = false;

    for (var idx = 0; idx < alerts.length; idx++) {
      var alert = alerts[idx];

      // --- Value-change guard ---
      var valueMatch = alert.message.match(/[\d]+\.?[\d]*/);
      var currentValue = valueMatch ? parseFloat(valueMatch[0]) : null;
      var lastValue = lastAlertedValue[alert.type];

      // Determine what constitutes a "significant shift"
      var threshold = 5;
      var msg = alert.message.toLowerCase();
      if (msg.indexOf('power') !== -1) threshold = 50;
      else if (msg.indexOf('current') !== -1) threshold = 1.0;
      else if (msg.indexOf('voltage') !== -1) threshold = 5.0;
      else if (msg.indexOf('temperature') !== -1) threshold = 2.0;
      else if (msg.indexOf('energy') !== -1) threshold = 1.0;

      var valueChangedSignificantly = currentValue === null
        || lastValue === undefined
        || Math.abs(currentValue - lastValue) >= threshold;

      // Also enforce a minimum time gap (30s)
      var recentSameType = null;
      for (var j = 0; j < state.alerts.length; j++) {
        if (state.alerts[j].type === alert.type &&
          (Date.now() - state.alerts[j].time.getTime()) < 30000) {
          recentSameType = state.alerts[j];
          break;
        }
      }

      if (!recentSameType && valueChangedSignificantly) {
        // Record the value we're alerting on
        if (currentValue !== null) lastAlertedValue[alert.type] = currentValue;

        // Reset mute to reactivate the alarm
        isAlarmMuted = false;
        if (alarmInterval) {
          clearInterval(alarmInterval);
          alarmInterval = null;
        }

        // Add to state
        var alertEntry = {
          type: alert.type,
          message: alert.message,
          time: new Date()
        };
        state.alerts.unshift(alertEntry);

        // Save to database
        saveAlert(alert);
        newAlertAdded = true;

        // Fire a native OS notification
        sendNativeNotification(alert);

        // Auto-shutoff if needed
        if (alert.autoShutoff) {
          console.warn('🚨 AUTO-SHUTOFF triggered:', alert.message);
          toggleRelay(false);
          autoShutoffRelay();
        }
      }
    }

    if (newAlertAdded) {
      // Keep only last 50 alerts
      state.alerts = state.alerts.slice(0, 50);
      debouncedRenderAlerts();
    }
  }

  /**
   * Render alerts list in UI using DocumentFragment for performance
   */
  function renderAlerts() {
    var container = document.getElementById('alerts-list');

    if (state.alerts.length === 0) {
      container.innerHTML =
        '<div class="alert-empty">' +
        '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">' +
        '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/>' +
        '<polyline points="22 4 12 14.01 9 11.01"/>' +
        '</svg>' +
        '<p>System operating normally. No alerts.</p>' +
        '</div>';
      return;
    }

    var icons = {
      warning: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      faulty: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><circle cx="12" cy="12" r="3" fill="var(--color-danger)"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
      power_loss: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
      low_power: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" stroke-width="2"><rect x="2" y="7" width="16" height="10" rx="2" ry="2"/><line x1="22" y1="11" x2="22" y2="13"/><line x1="2" y1="11" x2="2" y2="13"/></svg>',
      normal: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-normal)" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
    };

    var fragment = document.createDocumentFragment();

    for (var i = 0; i < state.alerts.length; i++) {
      var a = state.alerts[i];
      var div = document.createElement('div');
      div.className = 'alert-item ' + a.type;
      div.innerHTML =
        '<span class="alert-icon">' + (icons[a.type] || icons.warning) + '</span>' +
        '<div class="alert-content">' +
        '<p class="alert-message">' + a.message + '</p>' +
        '<span class="alert-time">' + a.time.toLocaleTimeString('en-US', { hour12: false }) + '</span>' +
        '</div>' +
        '<span class="alert-type-badge">' + a.type.replace('_', ' ') + '</span>';
      fragment.appendChild(div);
    }

    container.innerHTML = '';
    container.appendChild(fragment);
  }

  /**
   * Flash the screen for critical alerts
   */
  function triggerAlertFlash() {
    var flash = document.getElementById('alert-flash');
    flash.classList.remove('hidden');

    setTimeout(function () {
      flash.classList.add('hidden');
    }, 500);
  }

  // Global alarm state
  var alarmInterval = null;
  var isAlarmMuted = false;
  var alarmPlayCount = 0;

  /**
   * Manage repeating alarm sound based on system status.
   */
  function manageAlarmState(status) {
    if (status === 'fault' && !isAlarmMuted) {
      // Resume AudioContext in case it was suspended
      if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume().catch(function () {});
      }
      // Start continuous alarm if not already running
      if (!alarmInterval) {
        alarmPlayCount = 0;
        triggerAlertFlash();
        playAlertSound();
        alarmPlayCount++;

        alarmInterval = setInterval(function () {
          if (alarmPlayCount >= 5) {
            clearInterval(alarmInterval);
            alarmInterval = null;
            isAlarmMuted = true;
            return;
          }

          if (audioCtx && audioCtx.state === 'suspended') {
            audioCtx.resume().then(function () { playAlertSound(); }).catch(function () {});
          } else {
            playAlertSound();
          }
          alarmPlayCount++;
        }, 60000); // Repeat every 1 minute
      }
    } else {
      // Stop alarm when power is normal or user muted it
      if (alarmInterval) {
        clearInterval(alarmInterval);
        alarmInterval = null;
      }
      if (status === 'normal') {
        isAlarmMuted = false;
      }
    }
  }

  /**
   * Play a loud alarm sound using Web Audio API
   */
  function playAlertSound() {
    try {
      if (!audioCtx || audioCtx.state === 'suspended') {
        if (audioCtx) audioCtx.resume();
      }
      if (!audioCtx) {
        console.warn('Audio Context not initialized. User must tap the screen first.');
        showToast('⚠️ TAP ANYWHERE ON SCREEN TO ENABLE ALARM SOUND', 'error');
        return;
      }

      // Play a 3-beep siren pattern
      for (var i = 0; i < 3; i++) {
        var startTime = audioCtx.currentTime + i * 0.5;

        var oscillator = audioCtx.createOscillator();
        var gainNode = audioCtx.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.type = 'square';

        oscillator.frequency.setValueAtTime(1000, startTime);
        oscillator.frequency.setValueAtTime(1200, startTime + 0.15);

        gainNode.gain.setValueAtTime(0, startTime);
        gainNode.gain.linearRampToValueAtTime(0.5, startTime + 0.05);
        gainNode.gain.setValueAtTime(0.5, startTime + 0.3);
        gainNode.gain.linearRampToValueAtTime(0, startTime + 0.35);

        oscillator.start(startTime);
        oscillator.stop(startTime + 0.4);
      }
    } catch (e) {
      console.warn('Audio not supported or blocked', e);
    }
  }

  // ============================================
  // RELAY CONTROL (OPTIMISTIC UI)
  // ============================================
  function toggleRelay(on) {
    // Warn if no voltage detected, but still allow the toggle
    // (voltage is 0 when ESP32 hasn't connected yet — don't block the UI)
    if (state.currentData.voltage < 10 && state.connected) {
      showToast('Warning: No voltage detected — relay toggled anyway', 'info');
    }

    // 1. Optimistic UI update — feel instant
    var previousState = state.relayOn;
    state.relayOn = on;
    updateRelayUI(on);

    // Show loading spinner
    var ring = document.getElementById('relay-status-ring');
    if (ring) ring.classList.add('loading');

    if (isDemoMode) {
      setDemoRelay(on);
      if (ring) ring.classList.remove('loading');
      showToast('Relay turned ' + (on ? 'ON' : 'OFF'), on ? 'success' : 'info');
      return;
    }

    // 2. Network Request
    supabase
      .from('control')
      .update({
        relay_status: on,
        updated_at: new Date().toISOString()
      })
      .eq('id', 1)
      .then(function (result) {
        if (ring) ring.classList.remove('loading');

        if (result.error) {
          console.error('Error toggling relay:', result.error);
          state.relayOn = previousState;
          updateRelayUI(previousState);
          showToast('Failed to toggle relay', 'error');
        } else {
          showToast('Relay turned ' + (on ? 'ON' : 'OFF'), on ? 'success' : 'info');
        }
      })
      .catch(function (err) {
        console.error('Relay toggle failed:', err);
        if (ring) ring.classList.remove('loading');
        state.relayOn = previousState;
        updateRelayUI(previousState);
        showToast('Connection error', 'error');
      });
  }

  // ============================================
  // ENERGY MANAGEMENT
  // ============================================
  function updateEnergyBought(kWh) {
    if (isDemoMode) {
      setDemoEnergyBought(kWh);
      state.energy = getDemoEnergy();
      updateEnergyUI();
      return;
    }

    supabase
      .from('user_energy')
      .select('energy_used')
      .eq('id', 1)
      .single()
      .then(function (result) {
        var energyUsed = result.data ? result.data.energy_used : 0;

        return supabase
          .from('user_energy')
          .update({
            total_energy_bought: kWh,
            energy_remaining: kWh - energyUsed
          })
          .eq('id', 1);
      })
      .then(function (result) {
        if (result && result.error) {
          console.error('Error updating energy:', result.error);
          showToast('Failed to update energy balance', 'error');
        }
      })
      .catch(function (err) {
        console.error('Energy update failed:', err);
      });
  }

  // ============================================
  // NOTIFICATIONS (TOAST)
  // ============================================
  function showToast(message, type) {
    type = type || 'info';
    // Remove existing toasts
    var existing = document.querySelectorAll('.toast');
    for (var i = 0; i < existing.length; i++) existing[i].remove();

    var toast = document.createElement('div');
    toast.className = 'toast ' + type;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(function () {
      toast.style.animation = 'toast-out 0.3s ease-in forwards';
      setTimeout(function () { toast.remove(); }, 300);
    }, 3000);
  }

  // Make showToast available globally for debugging
  window.showToast = showToast;

})();
