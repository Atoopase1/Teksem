#include <WiFi.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <PubSubClient.h>

// WiFi Settings
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// Pins
#define VOLT_PIN    34
#define CURR_PIN    35
#define DHT_PIN     15
#define RELAY_PIN   23
#define LED_RED     4   // Fault indicator
#define LED_GREEN   5   // Safe power indicator
#define LED_YELLOW  2   // Warning indicator

// LED Thresholds
#define V_FAULT_HIGH  253.0  // Voltage too high (fault)
#define V_FAULT_LOW   180.0  // Voltage too low (fault)
#define V_WARN_HIGH   245.0  // Approaching high limit (warning)
#define V_WARN_LOW    200.0  // Approaching low limit (warning)
#define P_FAULT       5000.0 // Power too high (fault)
#define P_WARN        4000.0 // Power approaching limit (warning)

Adafruit_SSD1306 display(128, 64, &Wire, -1);
DHT dht(DHT_PIN, DHT22);

WiFiClient mqttWiFiClient;
PubSubClient mqtt(mqttWiFiClient);

// ── NC Wiring note ─────────────────────────────────────────────────────────
// Load is wired between NC and COM.
// Relay de-energized (LOW) → NC-COM closed → load has POWER  (normal state)
// Relay energized   (HIGH) → NC-COM opens  → load is CUT OFF (fault state)
// ─────────────────────────────────────────────────────────────────────────

// loadOn = true means load is currently powered (relay LOW / de-energized)
bool loadOn = true;

// true = user deliberately turned load OFF via webapp — blocks auto-restore
bool userManualOff = false;

// System condition flags — set in loop(), read by mqttCallback
bool isFault   = false;
bool isWarning = false;
bool isSafe    = false;

// ── MQTT callback ────────────────────────────────────────────────────────────
// Handles relay commands sent from the webapp (teksem/relay/control)
// Payload: { "relay": true }  → user wants load ON
//          { "relay": false } → user wants load OFF
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];

  if (String(topic) == "teksem/relay/control") {
    StaticJsonDocument<64> doc;
    if (!deserializeJson(doc, msg)) {
      bool wantLoadOn = doc["relay"].as<bool>();

      if (isFault && wantLoadOn) {
        // FAULT active — block load from turning ON, keep relay energized
        loadOn = false;
        digitalWrite(RELAY_PIN, HIGH);
        mqtt.publish("teksem/relay/status",
          "{\"status\":\"force_off\","
          "\"reason\":\"Fault active — load cannot be turned ON\"}");
        Serial.println("BLOCKED: cannot turn load ON during fault");

      } else if (isFault && !wantLoadOn) {
        // Turning load OFF during fault — already OFF, acknowledge
        loadOn = false;
        userManualOff = true;             // Treat as manual off
        digitalWrite(RELAY_PIN, HIGH);
        mqtt.publish("teksem/relay/status", "{\"status\":\"off\"}");

      } else if (isWarning && wantLoadOn) {
        // WARNING — allow load ON but send critical warning to webapp
        loadOn = true;
        userManualOff = false;            // User wants it ON — clear manual flag
        digitalWrite(RELAY_PIN, LOW);
        mqtt.publish("teksem/relay/status",
          "{\"status\":\"critical_warning\","
          "\"reason\":\"Warning condition — load ON with risk\"}");
        Serial.println("Load ON with WARNING — critical alert sent");

      } else {
        // Normal / safe operation
        loadOn = wantLoadOn;
        if (!wantLoadOn) userManualOff = true;   // User chose to turn load OFF
        else             userManualOff = false;   // User chose to turn load ON
        digitalWrite(RELAY_PIN, loadOn ? LOW : HIGH);
        mqtt.publish("teksem/relay/status",
          loadOn ? "{\"status\":\"on\"}" : "{\"status\":\"off\"}");
        Serial.printf("Load: %s\n", loadOn ? "ON (relay de-energized)" : "OFF (relay energized)");
      }
    }
  }
}

void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("Connecting to MQTT...");
    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("connected!");
      mqtt.subscribe("teksem/relay/control"); // Relay commands from webapp
    } else {
      Serial.print("failed, rc=");
      Serial.print(mqtt.state());
      Serial.println(" try again in 2 seconds");
      delay(2000);
    }
  }
}

void setup() {
  Serial.begin(115200);

  // Relay & LEDs — all start LOW
  // RELAY LOW = de-energized = NC-COM closed = load ON by default
  pinMode(RELAY_PIN,  OUTPUT); digitalWrite(RELAY_PIN,  LOW);
  pinMode(LED_RED,    OUTPUT); digitalWrite(LED_RED,    LOW);
  pinMode(LED_GREEN,  OUTPUT); digitalWrite(LED_GREEN,  LOW);
  pinMode(LED_YELLOW, OUTPUT); digitalWrite(LED_YELLOW, LOW);

  dht.begin();
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 20);
    display.println("Connecting WiFi...");
    display.display();
  }

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) {
    delay(300);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected!");

  mqtt.setServer("broker.emqx.io", 1883);
  mqtt.setKeepAlive(60);
  mqtt.setCallback(mqttCallback);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) return;

  if (!mqtt.connected()) connectMQTT();
  mqtt.loop();

  // 1. Read Sensors
  float v = (analogRead(VOLT_PIN) / 4095.0f) * 260.0f;
  float c = (analogRead(CURR_PIN) / 4095.0f) * 30.0f;
  float p = v * c;
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t)) t = 0;
  if (isnan(h)) h = 0;

  // 2. Evaluate conditions
  isFault   = (v > V_FAULT_HIGH || v < V_FAULT_LOW || p > P_FAULT);
  isWarning = !isFault && (v > V_WARN_HIGH || v < V_WARN_LOW || p > P_WARN);
  isSafe    = !isFault && !isWarning && (p > 1.0f);

  // 3. Drive LEDs
  // RED    = fault condition
  // YELLOW = approaching threshold (warning)
  // GREEN  = safe voltage, current & power flowing
  digitalWrite(LED_RED,    isFault   ? HIGH : LOW);
  digitalWrite(LED_YELLOW, isWarning ? HIGH : LOW);
  digitalWrite(LED_GREEN,  isSafe    ? HIGH : LOW);

  // 4. NC Fault guard ─────────────────────────────────────────────────────
  // If a fault is detected while the load is ON, immediately energize the
  // relay to open the NC contact and disconnect the load.
  if (isFault && loadOn) {
    loadOn = false;
    userManualOff = false;        // Fault forced it off — allow auto-restore later
    digitalWrite(RELAY_PIN, HIGH);
    mqtt.publish("teksem/relay/status",
      "{\"status\":\"force_off\","
      "\"reason\":\"Fault detected — relay energized, load disconnected\"}");
    Serial.println("FAULT: relay energized, load cut via NC");
  }

  // Auto-restore ────────────────────────────────────────────────────────────
  // Only restore if the fault cleared AND the user did NOT manually turn off.
  // If the user turned it off deliberately, they must tap ON themselves.
  if (isSafe && !loadOn && !userManualOff) {
    loadOn = true;
    digitalWrite(RELAY_PIN, LOW); // De-energize → NC closes → load ON
    mqtt.publish("teksem/relay/status", "{\"status\":\"on\"}");
    Serial.println("System safe — load restored automatically");
  }
  // ─────────────────────────────────────────────────────────────────────────

  // 5. Update OLED Display
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println("ENERGY MONITOR");
  display.setCursor(0, 16);
  display.printf("V: %.1fV  I: %.2fA\n", v, c);
  display.printf("P: %.1f W\n", p);
  display.printf("T: %.1fC  H: %.1f%%", t, h);
  display.display();

  // 6. Publish sensor data over MQTT
  StaticJsonDocument<200> doc;
  doc["voltage"]     = v;
  doc["current"]     = c;
  doc["power"]       = p;
  doc["temperature"] = t;
  doc["humidity"]    = h;
  String json;
  serializeJson(doc, json);

  bool ok = mqtt.publish("teksem/energy/data", json.c_str());
  Serial.printf("MQTT Publish: %s\n", ok ? "OK" : "FAILED");

  // 7. Non-blocking delay (keeps MQTT alive during wait)
  unsigned long startWait = millis();
  while (millis() - startWait < 2000) {
    mqtt.loop();
    delay(10);
  }
}
