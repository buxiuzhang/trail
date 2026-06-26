package com.trail.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.trail.store.LLMSettingsStore;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.Signature;
import java.security.spec.PKCS8EncodedKeySpec;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.zip.GZIPInputStream;

/**
 * 和风天气（QWeather）服务：Ed25519 JWT 认证 + GEO + weather/now 查询。
 *
 * location 处理逻辑：
 *   - 纯城市名（如"深圳"）→ 直接传给 weather/now
 *   - lat,lon 坐标（如"22.5431,114.0579"）→ 先调 GEO 转为城市 ID，再查天气
 *     （和风天气 weather/now 不接受经纬度，GEO lookup 坐标格式为 lon,lat）
 */
@Service
public class QWeatherService {

    private static final Logger log = LoggerFactory.getLogger(QWeatherService.class);
    private static final long TOKEN_TTL_SECONDS = 900;
    private static final long TOKEN_REFRESH_BEFORE = 60;
    private static final String DEFAULT_API_HOST = "devapi.qweather.com";
    private static final long WEATHER_CACHE_TTL = 3600;

    private final LLMSettingsStore store;
    private final HttpClient http = HttpClient.newHttpClient();
    private final ObjectMapper om = new ObjectMapper();

    private volatile String cachedToken;
    private volatile long tokenExpiresAt = 0;

    private record WeatherCache(WeatherNow data, long fetchedAt) {}
    private final ConcurrentHashMap<String, WeatherCache> weatherCache = new ConcurrentHashMap<>();

    public QWeatherService(LLMSettingsStore store) {
        this.store = store;
    }

    public record WeatherNow(
        String icon, String text, String temp, String feelsLike,
        String humidity, String windDir, String windScale, String obsTime,
        String districtName
    ) {}

    private record GeoResult(String cityId, String cityName) {}

    /** 发 GET 请求，自动解压 gzip，返回响应体字符串 */
    private HttpResponse<InputStream> httpGet(String url, String token) throws Exception {
        HttpRequest req = HttpRequest.newBuilder()
            .uri(URI.create(url))
            .header("Authorization", "Bearer " + token)
            .header("Accept-Encoding", "gzip")
            .GET().build();
        return http.send(req, HttpResponse.BodyHandlers.ofInputStream());
    }

    private String readBody(HttpResponse<InputStream> resp) throws Exception {
        InputStream is = resp.body();
        String encoding = resp.headers().firstValue("Content-Encoding").orElse("");
        if ("gzip".equalsIgnoreCase(encoding)) {
            is = new GZIPInputStream(is);
        }
        return new String(is.readAllBytes(), StandardCharsets.UTF_8);
    }

    /** 查询城市名称（用于设置页显示），失败返回空字符串 */
    public String lookupCityName(String location) {
        if (isEmpty(location)) return "";
        String projectId    = store.get("weather_project_id");
        String credentialId = store.get("weather_credential_id");
        String privateKey   = store.get("weather_private_key");
        String apiHost      = store.get("weather_api_host");
        if (isEmpty(projectId) || isEmpty(credentialId) || isEmpty(privateKey)) return "";
        if (isEmpty(apiHost)) apiHost = DEFAULT_API_HOST;
        try {
            String token = getOrRefreshToken(projectId, credentialId, privateKey);
            GeoResult geo = resolveLocation(location, apiHost, token);
            return geo != null ? geo.cityName() : "";
        } catch (Exception e) {
            return "";
        }
    }

    /** 返回实时天气；凭据未配置或请求失败返回 null */
    public WeatherNow getWeather(String location) {
        String projectId    = store.get("weather_project_id");
        String credentialId = store.get("weather_credential_id");
        String privateKey   = store.get("weather_private_key");
        String apiHost      = store.get("weather_api_host");

        if (isEmpty(projectId) || isEmpty(credentialId) || isEmpty(privateKey)) return null;
        if (isEmpty(apiHost)) apiHost = DEFAULT_API_HOST;

        try {
            String token = getOrRefreshToken(projectId, credentialId, privateKey);
            GeoResult geo = resolveLocation(location, apiHost, token);
            if (geo == null) return null;

            // 检查缓存（1 小时 TTL）
            long now = Instant.now().getEpochSecond();
            WeatherCache cached = weatherCache.get(geo.cityId());
            if (cached != null && now - cached.fetchedAt() < WEATHER_CACHE_TTL) {
                log.debug("Weather cache hit for {}", geo.cityId());
                return cached.data();
            }

            String url = "https://" + apiHost + "/v7/weather/now?location="
                + URLEncoder.encode(geo.cityId(), StandardCharsets.UTF_8) + "&lang=zh&unit=m";

            HttpResponse<InputStream> resp = httpGet(url, token);
            if (resp.statusCode() != 200) {
                log.warn("QWeather weather/now returned HTTP {} body: {}", resp.statusCode(), readBody(resp));
                return null;
            }
            WeatherNow result = parseNow(readBody(resp), geo.cityName());
            if (result != null) {
                weatherCache.put(geo.cityId(), new WeatherCache(result, now));
            }
            return result;
        } catch (Exception e) {
            log.warn("QWeather request failed: {}", e.getMessage());
            return null;
        }
    }

    /**
     * 将前端传来的 location 转换为 GeoResult（cityId + cityName）。
     * - lat,lon 坐标：GEO lookup（lon,lat 顺序）
     * - 纯数字城市 ID（如 101280601）：GEO lookup 获取城市名
     * - 城市名（如"深圳"）：直接作为 cityId 使用，cityName 为空
     */
    @SuppressWarnings("unchecked")
    private GeoResult resolveLocation(String location, String apiHost, String token) throws Exception {
        boolean isLatLon = location.matches("-?\\d+\\.\\d+,-?\\d+\\.\\d+");
        boolean isCityId = location.matches("\\d{6,12}");

        String geoLookup = null;
        if (isLatLon) {
            // lat,lon → lon,lat（和风 GEO 接口要求经度在前）
            String[] parts = location.split(",");
            geoLookup = parts[1].trim() + "," + parts[0].trim();
        } else if (isCityId) {
            geoLookup = location;
        }

        if (geoLookup == null) {
            return new GeoResult(location, ""); // 城市名，直接用
        }

        String geoUrl = "https://" + apiHost + "/geo/v2/city/lookup?location="
            + URLEncoder.encode(geoLookup, StandardCharsets.UTF_8) + "&lang=zh";

        HttpResponse<InputStream> resp = httpGet(geoUrl, token);
        if (resp.statusCode() != 200) {
            log.warn("QWeather GEO returned HTTP {} body: {}", resp.statusCode(), readBody(resp));
            return null;
        }

        Map<String, Object> root = om.readValue(readBody(resp), Map.class);
        if (!"200".equals(root.get("code"))) {
            log.warn("QWeather GEO code: {}", root.get("code"));
            return null;
        }

        List<Map<String, Object>> locations = (List<Map<String, Object>>) root.get("location");
        if (locations == null || locations.isEmpty()) return null;

        Map<String, Object> first = locations.get(0);
        String cityId   = str(first, "id");
        String cityName = str(first, "name");
        log.debug("GEO resolved {} → {} ({})", location, cityName, cityId);
        return new GeoResult(cityId, cityName);
    }

    private synchronized String getOrRefreshToken(String projectId, String credentialId, String pemKey)
            throws Exception {
        long now = Instant.now().getEpochSecond();
        if (cachedToken != null && now < tokenExpiresAt - TOKEN_REFRESH_BEFORE) {
            return cachedToken;
        }
        cachedToken = buildJwt(projectId, credentialId, pemKey);
        tokenExpiresAt = now + TOKEN_TTL_SECONDS;
        return cachedToken;
    }

    private String buildJwt(String projectId, String credentialId, String pemOrBase64) throws Exception {
        byte[] keyBytes = decodePem(pemOrBase64);
        PKCS8EncodedKeySpec spec = new PKCS8EncodedKeySpec(keyBytes);
        PrivateKey privateKey = KeyFactory.getInstance("EdDSA").generatePrivate(spec);

        long iat = Instant.now().getEpochSecond();
        long exp = iat + TOKEN_TTL_SECONDS;

        String headerB64  = b64url(("{\"alg\":\"EdDSA\",\"kid\":\"" + credentialId + "\"}").getBytes(StandardCharsets.UTF_8));
        String payloadB64 = b64url(("{\"sub\":\"" + projectId + "\",\"iat\":" + iat + ",\"exp\":" + exp + "}").getBytes(StandardCharsets.UTF_8));
        String signingInput = headerB64 + "." + payloadB64;

        Signature signer = Signature.getInstance("EdDSA");
        signer.initSign(privateKey);
        signer.update(signingInput.getBytes(StandardCharsets.US_ASCII));
        byte[] sig = signer.sign();

        return signingInput + "." + b64url(sig);
    }

    private String b64url(byte[] data) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(data);
    }

    private byte[] decodePem(String input) {
        String trimmed = input.strip();
        if (trimmed.startsWith("-----")) {
            String body = trimmed.replaceAll("-----[^-]+-----", "").replaceAll("\\s", "");
            return Base64.getDecoder().decode(body);
        }
        return Base64.getDecoder().decode(trimmed.replaceAll("\\s", ""));
    }

    @SuppressWarnings("unchecked")
    private WeatherNow parseNow(String json, String cityName) {
        try {
            Map<String, Object> root = om.readValue(json, Map.class);
            if (!"200".equals(root.get("code"))) {
                log.warn("QWeather code: {}", root.get("code"));
                return null;
            }
            Map<String, Object> now = (Map<String, Object>) root.get("now");
            if (now == null) return null;
            return new WeatherNow(
                str(now, "icon"), str(now, "text"), str(now, "temp"),
                str(now, "feelsLike"), str(now, "humidity"),
                str(now, "windDir"), str(now, "windScale"), str(now, "obsTime"),
                cityName == null ? "" : cityName
            );
        } catch (Exception e) {
            log.warn("Failed to parse QWeather response: {}", e.getMessage());
            return null;
        }
    }

    private String str(Map<String, Object> m, String key) {
        Object v = m.get(key);
        return v == null ? "" : v.toString();
    }

    private boolean isEmpty(String s) {
        return s == null || s.isBlank();
    }
}
