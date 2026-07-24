#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>
#include <DHT.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <PubSubClient.h>

// WiFi Settings
const char* WIFI_SSID = "Wokwi-GUEST";
const char* WIFI_PASS = "";

// Supabase Credentials
const char* SUPABASE_HOST = "https://etlagrvacikinnihpyss.supabase.co";
const char* SUPABASE_KEY  = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV0bGFncnZhY2lraW5uaWhweXNzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzUyODM3NTYsImV4cCI6MjA5MDg1OTc1Nn0.NJw0ZqIkySahrh0hNK2AfCAShDUaDE7RBLQ02_RiG0Q";

// Pins
#define VOLT_PIN  34
#define CURR_PIN  35
#define DHT_PIN   15
#define RELAY_PIN 23
#define LED_PIN   2  // Built-in LED

Adafruit_SSD1306 display(128, 64, &Wire, -1);
DHT dht(DHT_PIN, DHT22);

WiFiClient mqttWiFiClient;
PubSubClient mqtt(mqttWiFiClient);

// MQTT callback — runs when a message arrives on a subscribed topic
void mqttCallback(char* topic, byte* payload, unsigned int length) {
  String msg = "";
  for (unsigned int i = 0; i < length; i++) msg += (char)payload[i];
  
  if (String(topic) == "teksem/relay/control") {
    StaticJsonDocument<64> doc;
    if (!deserializeJson(doc, msg)) {
      bool relayState = doc["relay"].as<bool>();
      digitalWrite(RELAY_PIN, relayState ? HIGH : LOW);
      digitalWrite(LED_PIN,   relayState ? HIGH : LOW);
      Serial.printf("Relay & LED: %s\n", relayState ? "ON" : "OFF");
    }
  }
}
WiFiClientSecure httpsClient;

void connectMQTT() {
  while (!mqtt.connected()) {
    Serial.print("Connecting to MQTT...");
    // Create a random client ID
    String clientId = "ESP32Client-";
    clientId += String(random(0xffff), HEX);
    if (mqtt.connect(clientId.c_str())) {
      Serial.println("connected!");
      // Subscribe to relay control topic
      mqtt.subscribe("teksem/relay/control");
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
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  digitalWrite(LED_PIN, LOW);
  
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
  
  httpsClient.setInsecure(); // Set globally once
  mqtt.setServer("broker.emqx.io", 1883);
  mqtt.setKeepAlive(60);
  mqtt.setCallback(mqttCallback); // 60-second keepalive
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) return;
  
  if (!mqtt.connected()) {
    connectMQTT();
  }
  mqtt.loop();

  // 1. Read Sensors
  float v = (analogRead(VOLT_PIN) / 4095.0f) * 260.0f;
  float c = (analogRead(CURR_PIN) / 4095.0f) * 30.0f;
  float p = v * c;
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  if (isnan(t)) t = 0;
  if (isnan(h)) h = 0;

  // 2. Update Display
  display.clearDisplay();
  display.setCursor(0, 0);
  display.setTextSize(1);
  display.println("ENERGY MONITOR");
  display.setCursor(0, 16);
  display.printf("V: %.1fV  I: %.2fA\n", v, c);
  display.printf("P: %.1f W\n", p);
  display.printf("T: %.1fC  H: %.1f%%", t, h);
  display.display();

  // 3. Build JSON and publish over MQTT
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

  // 4. Non-blocking delay (keeps MQTT alive while waiting 2 seconds)
  unsigned long startWait = millis();
  while (millis() - startWait < 2000) {
    mqtt.loop();
    delay(10);
  }
}
