package com.anr.mineonemap.ingest;

import com.anr.mineonemap.config.BridgeProperties;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Optional;

@Component
public class BridgeClient {

    private static final Logger log = LoggerFactory.getLogger(BridgeClient.class);

    private final RestClient restClient;
    private final ObjectMapper objectMapper;

    public BridgeClient(BridgeProperties bridgeProperties, ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        String baseUrl = bridgeProperties.getBaseUrl();
        if (baseUrl != null && baseUrl.endsWith("/")) {
            baseUrl = baseUrl.substring(0, baseUrl.length() - 1);
        }
        this.restClient = RestClient.builder().baseUrl(baseUrl != null ? baseUrl : "http://127.0.0.1:5173").build();
    }

    public Optional<JsonNode> getJson(String path) {
        try {
            String body = restClient.get()
                    .uri(path)
                    .retrieve()
                    .body(String.class);
            if (body == null || body.isBlank()) {
                return Optional.empty();
            }
            return Optional.of(objectMapper.readTree(body));
        } catch (Exception e) {
            log.debug("Bridge request failed {}: {}", path, e.getMessage());
            return Optional.empty();
        }
    }
}
