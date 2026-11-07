import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// Custom metrics to clearly demonstrate Traffic Management in the k6 summary output
const replica1Hits = new Counter('served_by_backend_1');
const replica2Hits = new Counter('served_by_backend_2');
const replica3Hits = new Counter('served_by_backend_3');
const nginxEdge429s = new Counter('rate_limited_429_nginx_edge');
const bucket4jApp429s = new Counter('rate_limited_429_bucket4j_app');
const successfulRequests = new Counter('http_2xx_success');
const unexpected5xxErrors = new Rate('unexpected_5xx_error_rate');
const apiLatency = new Trend('todo_api_latency_ms');

const BASE_URL = __ENV.BASE_URL || 'http://localhost';

export const options = {
  scenarios: {
    // Phase 1: Steady traffic showing least_conn load balancing + failover resilience
    // TIP: Run `docker stop todo-backend-2` during this window to witness zero-downtime failover!
    steady_load_and_failover: {
      executor: 'constant-arrival-rate',
      rate: 6,
      timeUnit: '1s',
      duration: '45s',
      preAllocatedVUs: 10,
      maxVUs: 20,
      exec: 'steadyReadAndWrite',
    },
    // Phase 2: High-rate spike starting at 15s to trigger both Bucket4j (20 writes/min)
    // and Nginx limit_req_zone (10 req/s + burst 15) HTTP 429 responses
    rate_limit_spike: {
      executor: 'constant-arrival-rate',
      startTime: '15s',
      rate: 35,
      timeUnit: '1s',
      duration: '15s',
      preAllocatedVUs: 30,
      maxVUs: 50,
      exec: 'burstTrafficSpike',
    },
  },
  thresholds: {
    // Zero 5xx errors even when a replica is killed mid-test (thanks to proxy_next_upstream)
    unexpected_5xx_error_rate: ['rate<0.01'],
    // Confirm that rate limiting actively kicks in during the spike
    'rate_limited_429_nginx_edge': ['count>0'],
  },
};

function trackResponse(res) {
  apiLatency.add(res.timings.duration);

  const servedBy = res.headers['X-Served-By'] || '';
  if (servedBy.includes('backend-1')) replica1Hits.add(1);
  if (servedBy.includes('backend-2')) replica2Hits.add(1);
  if (servedBy.includes('backend-3')) replica3Hits.add(1);

  if (res.status >= 200 && res.status < 300) {
    successfulRequests.add(1);
    unexpected5xxErrors.add(false);
  } else if (res.status === 429) {
    unexpected5xxErrors.add(false);
    const rateLimitedBy = res.headers['X-Rate-Limited-By'] || '';
    if (rateLimitedBy.includes('nginx')) {
      nginxEdge429s.add(1);
    } else {
      bucket4jApp429s.add(1);
    }
  } else if (res.status >= 500) {
    unexpected5xxErrors.add(true);
  }
}

export function steadyReadAndWrite() {
  // 80% GET requests, 20% POST requests
  if (Math.random() < 0.8) {
    const res = http.get(`${BASE_URL}/api/todos`);
    trackResponse(res);
    check(res, {
      'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
      'has X-Served-By or rate-limit header': (r) =>
        r.headers['X-Served-By'] !== undefined || r.status === 429,
    });
  } else {
    const payload = JSON.stringify({
      title: `LoadTest Task ${Date.now()}`,
      description: 'Verifying least_conn load balancing and Bucket4j quota',
      completed: false,
    });
    const params = { headers: { 'Content-Type': 'application/json' } };
    const res = http.post(`${BASE_URL}/api/todos`, payload, params);
    trackResponse(res);
    check(res, {
      'write status is 201 or 429': (r) => r.status === 201 || r.status === 429,
    });
  }
  sleep(0.1);
}

export function burstTrafficSpike() {
  const payload = JSON.stringify({
    title: `Spike Todo ${__VU}-${__ITER}`,
    description: 'Triggering 429 Too Many Requests at Edge and App layers',
    completed: false,
  });
  const params = { headers: { 'Content-Type': 'application/json' } };
  const res = http.post(`${BASE_URL}/api/todos`, payload, params);
  trackResponse(res);

  check(res, {
    'spike handled (201 or 429 with Retry-After)': (r) =>
      r.status === 201 || (r.status === 429 && r.headers['Retry-After'] !== undefined),
  });
}
