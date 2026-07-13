# ⚡ Smart Energy Monitor & Control System

<div align="center">

![Smart Energy Monitor](https://img.shields.io/badge/IoT-Smart%20Energy-00f5a0?style=for-the-badge&logo=lightning&logoColor=white)
![ESP32](https://img.shields.io/badge/Hardware-ESP32-00d9ff?style=for-the-badge&logo=espressif&logoColor=white)
![Supabase](https://img.shields.io/badge/Backend-Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white)
![Vite](https://img.shields.io/badge/Frontend-Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white)

**A real-time IoT smart energy monitoring and control system for modern smart homes.**

Monitor voltage, current, power, temperature & humidity from ESP32 sensors.
Control relays, track energy usage, and detect faults automatically.

</div>

---

## 📑 Table of Contents

- [Features](#-features)
- [Architecture](#-architecture)
- [Quick Start](#-quick-start)
- [Supabase Setup](#-supabase-setup)
- [ESP32 Setup](#-esp32-setup)
- [Environment Variables](#-environment-variables)
- [Deployment](#-deployment)
- [API Reference](#-api-reference)
- [Relay Control (ESP32)](#-relay-control-esp32)
- [Alert System](#-alert-system)
- [Project Structure](#-project-structure)

---

## 🌟 Features

| Feature | Description |
|---------|-------------|
| 📊 **Real-time Monitoring** | Live voltage, current, power, temperature & humidity readings |
| 🎛️ **Relay Control** | Toggle load ON/OFF from dashboard, ESP32 reads state |
| 🔋 **Energy Tracking** | Track purchased energy, consumed energy, and remaining balance |
| 🚨 **Smart Alerts** | Auto-detect faults, over-current, power loss with visual + audio alerts |
| ⚡ **Auto-Shutoff** | Automatically disconnect relay when fault conditions detected |
| 📈 **Live Charts** | Real-time line charts for voltage, current, and power |
| 🌙 **Dark Mode** | Professional dark theme with neon accents and glassmorphism |
| 📱 **Responsive** | Fully mobile-responsive dashboard |
| 🎮 **Demo Mode** | Works without hardware — simulated data for demonstration |

---

## 🏗️ Architecture

```
┌─────────────┐     HTTP POST      ┌──────────────────┐     Realtime     ┌─────────────────┐
│   ESP32     │ ──────────────────▶ │   Supabase       │ ◀─────────────▶ │   Web Dashboard │
│  + Sensors  │     /api/sensor-data│   (PostgreSQL)   │   Subscriptions  │   (Vite + JS)   │
│  ZMPT101B   │                    │                  │                  │   Charts, Alerts│
│  ACS712     │ ◀────── reads ─────│  control table   │                  │   Relay Control │
│  DHT22      │   relay_status     │                  │                  │                 │
└─────────────┘                    └──────────────────┘                  └─────────────────┘
```

**Data Flow:**
1. ESP32 reads sensors → POSTs data to `/api/sensor-data`
2. API endpoint validates, calculates power, stores in Supabase
3. Supabase realtime pushes new data to all connected dashboards
4. Dashboard updates charts, checks alerts, triggers auto-shutoff
5. ESP32 polls `control` table for relay state changes

---

## 🚀 Quick Start

### Prerequisites
- [Node.js](https://nodejs.org/) v18+
- [Supabase](https://supabase.com/) account (free tier works)
- ESP32 board with sensors (optional — demo mode works without hardware)

### 1. Clone & Install

```bash
git clone <your-repo-url>
cd smart-energy-monitor
npm install
```

### 2. Configure Supabase

```bash
# Copy the environment template
cp .env.example .env

# Edit .env with your Supabase credentials
```

### 3. Setup Database

Copy the contents of `supabase/schema.sql` and run it in your Supabase SQL Editor:
- Go to **Supabase Dashboard → SQL Editor → New query**
- Paste the entire SQL file and click **Run**

### 4. Enable Realtime

In Supabase Dashboard:
1. Go to **Database → Replication**
2. Enable realtime for tables: `sensor_data`, `control`, `user_energy`, `alerts`

### 5. Run Locally

```bash
npm run dev
```

Open `http://localhost:5173` — the dashboard will start in **Demo Mode** if Supabase isn't configured.

---

## 🗄️ Supabase Setup

### Step 1: Create a Supabase Project

1. Go to [supabase.com](https://supabase.com/) and sign up
2. Click **New Project**
3. Choose a name, password, and region
4. Wait for the project to be provisioned

### Step 2: Get Your API Keys

1. Go to **Settings → API**
2. Copy:
   - **Project URL** → `VITE_SUPABASE_URL`
   - **anon public key** → `VITE_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (for API endpoint)

### Step 3: Run the Schema SQL

1. Go to **SQL Editor → New query**
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql)
3. Click **Run**

This creates all 4 tables with proper indexes, RLS policies, and realtime subscriptions.

### Step 4: Enable Realtime

1. Go to **Database → Replication**
2. Toggle ON for: `sensor_data`, `control`, `user_energy`, `alerts`

---

## 🔌 ESP32 Setup

### Hardware Wiring

| Sensor | ESP32 Pin | Description |
|--------|-----------|-------------|
| **ZMPT101B** (Voltage) | GPIO 34 (ADC) | AC voltage sensor module |
| **ACS712** (Current) | GPIO 35 (ADC) | AC current sensor (5A/20A/30A) |
| **DHT22** (Temp/Humidity) | GPIO 4 | Digital temp & humidity sensor |
| **Relay Module** | GPIO 26 | Controls the load ON/OFF |

### ESP32 Arduino Code

```cpp
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <DHT.h>

// ============================================
// CONFIGURATION - CHANGE THESE VALUES
// ============================================
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD  = "YOUR_WIFI_PASSWORD";

// Supabase Configuration
const char* SUPABASE_URL   = "https://your-project-id.supabase.co";
const char* SUPABASE_KEY   = "your-anon-public-key";

// If using Vercel deployment:
const char* API_ENDPOINT   = "https://teksem.vercel.app/api/sensor-data";

// Pin Configuration
#define VOLTAGE_PIN   34
#define CURRENT_PIN   35
#define DHT_PIN       4
#define RELAY_PIN     26
#define DHT_TYPE      DHT22

// ============================================
// GLOBALS
// ============================================
DHT dht(DHT_PIN, DHT_TYPE);
unsigned long lastSendTime = 0;
const unsigned long SEND_INTERVAL = 3000; // Send data every 3 seconds

void setup() {
  Serial.begin(115200);
  
  // Initialize pins
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  dht.begin();
  
  // Connect to WiFi
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nConnected! IP: " + WiFi.localIP().toString());
}

void loop() {
  if (millis() - lastSendTime >= SEND_INTERVAL) {
    lastSendTime = millis();
    
    // Read sensors
    float voltage = readVoltage();
    float current = readCurrent();
    float temperature = dht.readTemperature();
    float humidity = dht.readHumidity();
    
    // Validate readings
    if (isnan(temperature)) temperature = 0;
    if (isnan(humidity)) humidity = 0;
    
    // Send data to API
    sendSensorData(voltage, current, temperature, humidity);
    
    // Check relay status from Supabase
    checkRelayStatus();
  }
}

// ============================================
// SENSOR READING FUNCTIONS
// ============================================
float readVoltage() {
  // ZMPT101B voltage sensor reading
  // Calibrate this multiplier for your specific sensor
  int raw = analogRead(VOLTAGE_PIN);
  float voltage = raw * (3.3 / 4095.0) * 100.0; // Adjust multiplier
  return voltage;
}

float readCurrent() {
  // ACS712 current sensor reading
  // Calibrate based on your ACS712 variant (5A/20A/30A)
  int raw = analogRead(CURRENT_PIN);
  float voltage = raw * (3.3 / 4095.0);
  float current = (voltage - 2.5) / 0.066; // For ACS712-30A (0.066 V/A)
  return abs(current);
}

// ============================================
// SEND DATA TO API
// ============================================
void sendSensorData(float voltage, float current, float temperature, float humidity) {
  if (WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  http.begin(API_ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  
  // Create JSON payload
  StaticJsonDocument<200> doc;
  doc["voltage"] = voltage;
  doc["current"] = current;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  
  String payload;
  serializeJson(doc, payload);
  
  int httpCode = http.POST(payload);
  
  if (httpCode == 200) {
    Serial.println("✅ Data sent successfully");
    String response = http.getString();
    Serial.println(response);
  } else {
    Serial.printf("❌ Error sending data: %d\n", httpCode);
  }
  
  http.end();
}

// ============================================
// CHECK RELAY STATUS FROM SUPABASE
// ============================================
void checkRelayStatus() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  HTTPClient http;
  
  // Read relay status from Supabase REST API
  String url = String(SUPABASE_URL) + "/rest/v1/control?id=eq.1&select=relay_status";
  http.begin(url);
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  
  int httpCode = http.GET();
  
  if (httpCode == 200) {
    String response = http.getString();
    
    StaticJsonDocument<200> doc;
    DeserializationError error = deserializeJson(doc, response);
    
    if (!error && doc.is<JsonArray>() && doc.size() > 0) {
      bool relayStatus = doc[0]["relay_status"];
      digitalWrite(RELAY_PIN, relayStatus ? HIGH : LOW);
      Serial.printf("Relay: %s\n", relayStatus ? "ON" : "OFF");
    }
  }
  
  http.end();
}
```

### Alternative: Post Directly to Supabase (No API Endpoint)

If you're not using Vercel, the ESP32 can POST directly to Supabase:

```cpp
void sendDirectToSupabase(float voltage, float current, float temperature, float humidity) {
  HTTPClient http;
  
  String url = String(SUPABASE_URL) + "/rest/v1/sensor_data";
  http.begin(url);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("apikey", SUPABASE_KEY);
  http.addHeader("Authorization", "Bearer " + String(SUPABASE_KEY));
  http.addHeader("Prefer", "return=minimal");
  
  float power = voltage * current;
  
  StaticJsonDocument<300> doc;
  doc["voltage"] = voltage;
  doc["current"] = current;
  doc["temperature"] = temperature;
  doc["humidity"] = humidity;
  doc["power"] = power;
  
  String payload;
  serializeJson(doc, payload);
  
  int httpCode = http.POST(payload);
  Serial.printf("Supabase response: %d\n", httpCode);
  
  http.end();
}
```

### Example HTTP Request (for testing with cURL):

```bash
curl -X POST https://teksem.vercel.app/api/sensor-data \
  -H "Content-Type: application/json" \
  -d '{
    "voltage": 220.5,
    "current": 2.3,
    "temperature": 28.5,
    "humidity": 55.0
  }'
```

---

## 🔐 Environment Variables

| Variable | Description | Where to Get It |
|----------|-------------|-----------------|
| `VITE_SUPABASE_URL` | Your Supabase project URL | Supabase → Settings → API → Project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous public key | Supabase → Settings → API → anon public |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server-only) | Supabase → Settings → API → service_role |

Create a `.env` file in the project root:

```env
VITE_SUPABASE_URL=https://abcdefgh.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 🚀 Deployment

### Deploy to Vercel (Recommended)

1. Push your code to GitHub
2. Go to [vercel.com](https://vercel.com) → **New Project**
3. Import your GitHub repository
4. Add environment variables in **Settings → Environment Variables**:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
5. Click **Deploy**

The API endpoint will be available at: `https://teksem.vercel.app/api/sensor-data`

### Deploy to Netlify

1. Push your code to GitHub
2. Go to [netlify.com](https://netlify.com) → **New Site from Git**
3. Set build command: `npm run build`
4. Set publish directory: `dist`
5. Add environment variables in **Site settings → Build & deploy → Environment**
6. For the API endpoint, use **Netlify Functions** (rename `api/` to `netlify/functions/`)

---

## 📡 API Reference

### POST `/api/sensor-data`

Receives sensor readings from ESP32.

**Request:**
```json
{
  "voltage": 220.5,
  "current": 2.3,
  "temperature": 28.5,
  "humidity": 55.0
}
```

**Success Response (200):**
```json
{
  "success": true,
  "data": {
    "id": 42,
    "voltage": 220.5,
    "current": 2.3,
    "power": 507.15,
    "temperature": 28.5,
    "humidity": 55.0,
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

**Error Response (400):**
```json
{
  "error": "Missing required fields",
  "required": ["voltage", "current", "temperature", "humidity"]
}
```

**Fault Response (200 with alert):**
```json
{
  "success": true,
  "data": { ... },
  "alerts": [
    { "type": "faulty", "message": "FAULT: Current 28.5A exceeds limit. Auto-shutoff!" }
  ],
  "relayShutoff": true
}
```

---

## 🎛️ Relay Control (ESP32)

The relay system works via the `control` table in Supabase:

1. **User toggles relay** in web dashboard → Updates `control.relay_status`
2. **ESP32 polls** `control` table every 3 seconds via Supabase REST API
3. **ESP32 reads** `relay_status` and switches GPIO accordingly
4. **Auto-shutoff**: When faults detected, system automatically sets `relay_status = false`

### ESP32 Reads Relay State:
```
GET https://your-project.supabase.co/rest/v1/control?id=eq.1&select=relay_status
Headers:
  apikey: YOUR_SUPABASE_ANON_KEY
  Authorization: Bearer YOUR_SUPABASE_ANON_KEY
```

---

## 🚨 Alert System

| Alert Type | Trigger | Action |
|------------|---------|--------|
| ⚠️ **Warning** | Current > 15A, Power > 3000W, Temp > 50°C | Yellow highlight, notification |
| 🚨 **Faulty** | Current > 25A, Power > 5000W, Temp > 70°C | Red flash, auto-shutoff relay, sound |
| 🔌 **Power Loss** | Voltage < 50V | Blue highlight, notification |
| 🔋 **Low Power** | Remaining energy < 10% | Warning notification |

Thresholds are configurable in `src/alertSystem.js`.

---

## 📁 Project Structure

```
smart-energy-monitor/
├── api/
│   └── sensor-data.js          # Vercel serverless API endpoint
├── public/
│   └── favicon.svg             # App icon
├── src/
│   ├── main.js                 # Main application entry point
│   ├── style.css               # Complete design system
│   ├── supabaseClient.js       # Supabase client configuration
│   ├── charts.js               # Chart.js configuration & updates
│   ├── alertSystem.js          # Alert thresholds & logic
│   └── demoSimulator.js        # Demo mode data simulator
├── supabase/
│   └── schema.sql              # Database schema (run in Supabase SQL Editor)
├── index.html                  # Main HTML template
├── .env.example                # Environment variables template
├── vercel.json                 # Vercel deployment config
├── package.json                # Dependencies
└── README.md                   # This file
```

---

## 🛠️ Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

---

## 📄 License

MIT License — free to use, modify, and distribute.

---

<div align="center">

**Built with ⚡ for Smart Homes**

</div>
