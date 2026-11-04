package com.anr.mineonemap.ingest;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PreDestroy;
import org.eclipse.paho.client.mqttv3.*;
import org.eclipse.paho.client.mqttv3.persist.MemoryPersistence;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Eclipse Paho MQTT 订阅 → SensorPayloadIngestor。
 * 支持 mqtt.topics 数组，或兼容旧字段 mqtt.topic（可逗号/分号分隔）。
 */
@Service
@Order(200)
public class MqttIngestService implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(MqttIngestService.class);

    private final SensorConfigService configService;
    private final SensorPayloadIngestor ingestor;
    private final SensorLatestStore store;
    private final ObjectMapper objectMapper;
    private final AtomicReference<MqttClient> clientRef = new AtomicReference<>();

    public MqttIngestService(SensorConfigService configService, SensorPayloadIngestor ingestor,
                             SensorLatestStore store, ObjectMapper objectMapper) {
        this.configService = configService;
        this.ingestor = ingestor;
        this.store = store;
        this.objectMapper = objectMapper;
    }

    @Override
    public void run(ApplicationArguments args) {
        reconnectFromConfig();
    }

    public synchronized void reconnectFromConfig() {
        stopClient();
        if (!configService.isIngestEnabled()) {
            store.setMqttConnected(false);
            store.setMqttError("ingest disabled");
            log.info("MQTT skipped: ingest.enabled=false");
            return;
        }
        JsonNode mqtt = configService.getConfig().path("mqtt");
        if (!mqtt.path("enabled").asBoolean(true)) {
            store.setMqttConnected(false);
            store.setMqttError("disabled");
            log.info("MQTT ingest disabled by config");
            return;
        }
        String host = mqtt.path("host").asText("").trim();
        if (host.isEmpty()) {
            store.setMqttConnected(false);
            store.setMqttError("host empty");
            return;
        }
        int port = mqtt.path("port").asInt(1883);
        int keepalive = Math.max(30, mqtt.path("keepalive").asInt(60));
        List<String> topics = resolveTopics(mqtt);
        String topicsLabel = String.join(", ", topics);
        String username = mqtt.path("username").asText("");
        String password = mqtt.path("password").asText("");
        String clientId = mqtt.path("clientId").asText("mine-onemap-api");
        if (clientId.isBlank()) {
            clientId = "mine-onemap-api-" + UUID.randomUUID().toString().substring(0, 8);
        } else {
            // 避免多实例 clientId 冲突
            clientId = clientId + "-" + UUID.randomUUID().toString().substring(0, 6);
        }

        String broker = "tcp://" + host + ":" + port;
        try {
            MqttClient client = new MqttClient(broker, clientId, new MemoryPersistence());
            MqttConnectOptions opts = new MqttConnectOptions();
            opts.setAutomaticReconnect(true);
            opts.setCleanSession(true);
            opts.setConnectionTimeout(20);
            opts.setKeepAliveInterval(keepalive);
            if (!username.isEmpty()) {
                opts.setUserName(username);
                opts.setPassword(password.toCharArray());
            }
            client.setCallback(new MqttCallbackExtended() {
                @Override
                public void connectComplete(boolean reconnect, String serverURI) {
                    store.setMqttConnected(true);
                    store.setMqttError(null);
                    store.setMqttTopic(topicsLabel);
                    log.info("MQTT connected{} to {} topics={}", reconnect ? " (re)" : "", serverURI, topicsLabel);
                    try {
                        subscribeAll(client, topics);
                    } catch (MqttException e) {
                        store.setMqttError(e.getMessage());
                        log.warn("MQTT subscribe failed: {}", e.getMessage());
                    }
                }

                @Override
                public void connectionLost(Throwable cause) {
                    store.setMqttConnected(false);
                    store.setMqttError(cause == null ? "connection lost" : cause.getMessage());
                    log.warn("MQTT connection lost: {}", store.getMqttError());
                }

                @Override
                public void messageArrived(String topic, MqttMessage message) {
                    try {
                        if (!configService.isIngestEnabled()) {
                            return;
                        }
                        String body = new String(message.getPayload(), StandardCharsets.UTF_8).trim();
                        if (body.isEmpty()) {
                            return;
                        }
                        JsonNode node = objectMapper.readTree(body);
                        ingestor.ingest(node, "mqtt", topic);
                    } catch (Exception e) {
                        log.debug("MQTT message parse skip: {}", e.getMessage());
                    }
                }

                @Override
                public void deliveryComplete(IMqttDeliveryToken token) {
                    // subscriber only
                }
            });
            clientRef.set(client);
            store.setMqttTopic(topicsLabel);
            client.connect(opts);
        } catch (Exception e) {
            store.setMqttConnected(false);
            store.setMqttError(e.getMessage());
            log.warn("MQTT connect failed {}:{} — {}", host, port, e.getMessage());
        }
    }

    /** 优先 topics[]；否则兼容 topic 字符串（支持逗号/分号/换行分隔）。 */
    static List<String> resolveTopics(JsonNode mqtt) {
        List<String> out = new ArrayList<>();
        JsonNode arr = mqtt.path("topics");
        if (arr.isArray()) {
            for (JsonNode n : arr) {
                String s = n.asText("").trim();
                if (!s.isEmpty()) {
                    out.add(s);
                }
            }
        }
        if (out.isEmpty()) {
            String raw = mqtt.path("topic").asText("").trim();
            if (!raw.isEmpty()) {
                for (String part : raw.split("[,;\\r\\n]+")) {
                    String s = part.trim();
                    if (!s.isEmpty()) {
                        out.add(s);
                    }
                }
            }
        }
        if (out.isEmpty()) {
            out.add("#");
        }
        return out;
    }

    private static void subscribeAll(MqttClient client, List<String> topics) throws MqttException {
        String[] topicArr = topics.toArray(new String[0]);
        int[] qos = new int[topicArr.length];
        client.subscribe(topicArr, qos);
    }

    @PreDestroy
    public void stopClient() {
        MqttClient client = clientRef.getAndSet(null);
        if (client != null) {
            try {
                if (client.isConnected()) {
                    client.disconnect();
                }
            } catch (Exception ignored) {
            }
            try {
                client.close();
            } catch (Exception ignored) {
            }
        }
        store.setMqttConnected(false);
    }
}
