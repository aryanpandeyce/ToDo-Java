package com.example.todo.filter;

import io.github.bucket4j.Bandwidth;
import io.github.bucket4j.Bucket;
import io.github.bucket4j.ConsumptionProbe;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

@Component
@Order(1)
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);

    private final Map<String, Bucket> buckets = new ConcurrentHashMap<>();
    private final int writeRequestsPerMinute;
    private final String instanceId;

    public RateLimitFilter(
            @Value("${app.ratelimit.write-per-minute:20}") int writeRequestsPerMinute,
            @Value("${app.instance-id:backend-local}") String instanceId) {
        this.writeRequestsPerMinute = writeRequestsPerMinute;
        this.instanceId = instanceId;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain) throws ServletException, IOException {

        String path = request.getRequestURI();
        String method = request.getMethod();

        if ((path.startsWith("/api/todos") || path.startsWith("/api/lists")) && isWriteMethod(method)) {
            String clientIp = extractClientIp(request);
            Bucket bucket = buckets.computeIfAbsent(clientIp, this::createNewBucket);

            ConsumptionProbe probe = bucket.tryConsumeAndReturnRemaining(1);
            if (probe.isConsumed()) {
                response.setHeader("X-Rate-Limit-Remaining", String.valueOf(probe.getRemainingTokens()));
                filterChain.doFilter(request, response);
            } else {
                long waitForRefillSeconds = Math.max(1, probe.getNanosToWaitForRefill() / 1_000_000_000);
                log.warn("Application rate limit exceeded for IP {} on {} {} (instance: {})",
                        clientIp, method, path, instanceId);

                response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
                response.setHeader("Retry-After", String.valueOf(waitForRefillSeconds));
                response.setHeader("X-Rate-Limit-Retry-After-Seconds", String.valueOf(waitForRefillSeconds));
                response.setContentType(MediaType.APPLICATION_JSON_VALUE);

                String jsonBody = String.format(
                        "{\"status\":429,\"error\":\"Too Many Requests (Bucket4j)\"," +
                        "\"message\":\"Application write rate limit of %d req/min exceeded for IP %s. Retry in %d seconds.\"," +
                        "\"retryAfterSeconds\":%d,\"path\":\"%s\",\"servedBy\":\"%s\",\"timestamp\":\"%s\"}",
                        writeRequestsPerMinute, clientIp, waitForRefillSeconds, waitForRefillSeconds,
                        path, instanceId, Instant.now().toString()
                );
                response.getWriter().write(jsonBody);
            }
        } else {
            filterChain.doFilter(request, response);
        }
    }

    private boolean isWriteMethod(String method) {
        return HttpMethod.POST.matches(method)
                || HttpMethod.PUT.matches(method)
                || HttpMethod.DELETE.matches(method)
                || HttpMethod.PATCH.matches(method);
    }

    private Bucket createNewBucket(String key) {
        Bandwidth limit = Bandwidth.builder()
                .capacity(writeRequestsPerMinute)
                .refillGreedy(writeRequestsPerMinute, Duration.ofMinutes(1))
                .build();
        return Bucket.builder().addLimit(limit).build();
    }

    private String extractClientIp(HttpServletRequest request) {
        String xForwardedFor = request.getHeader("X-Forwarded-For");
        if (xForwardedFor != null && !xForwardedFor.isBlank()) {
            return xForwardedFor.split(",")[0].trim();
        }
        String xRealIp = request.getHeader("X-Real-IP");
        if (xRealIp != null && !xRealIp.isBlank()) {
            return xRealIp.trim();
        }
        return request.getRemoteAddr();
    }

    public void clearBuckets() {
        buckets.clear();
    }
}

