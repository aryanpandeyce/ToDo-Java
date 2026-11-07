package com.example.todo;

import com.example.todo.dto.TodoListRequest;
import com.example.todo.dto.TodoRequest;
import com.example.todo.entity.Priority;
import com.example.todo.filter.RateLimitFilter;
import com.example.todo.repository.TodoListRepository;
import com.example.todo.repository.TodoRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

import java.time.LocalDate;

import static org.hamcrest.Matchers.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class TodoControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private TodoRepository todoRepository;

    @Autowired
    private TodoListRepository todoListRepository;

    @Autowired
    private RateLimitFilter rateLimitFilter;

    @BeforeEach
    void setUp() {
        todoRepository.deleteAll();
        todoListRepository.deleteAll();
        rateLimitFilter.clearBuckets();
    }

    @Test
    @DisplayName("Test 1: Full CRUD lifecycle with Lists, Priority, DueDate, Query Filters and X-Served-By header")
    void shouldPerformFullCrudLifecycleAndIncludeServedByHeader() throws Exception {
        // 0. Create a TodoList folder
        TodoListRequest listReq = new TodoListRequest("Infrastructure", "#06b6d4");
        MvcResult listResult = mockMvc.perform(post("/api/lists")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(listReq)))
                .andExpect(status().isCreated())
                .andExpect(header().string("X-Served-By", "backend-test-replica-1"))
                .andExpect(jsonPath("$.name", is("Infrastructure")))
                .andExpect(jsonPath("$.color", is("#06b6d4")))
                .andReturn();

        Long listId = objectMapper.readTree(listResult.getResponse().getContentAsString()).get("id").asLong();

        // 1. Create Todo with priority, dueDate, and listId
        TodoRequest createReq = new TodoRequest(
                "Configure Nginx Upstream",
                "Set least_conn across 3 replicas",
                false,
                Priority.HIGH,
                LocalDate.now().plusDays(2),
                listId
        );

        MvcResult createResult = mockMvc.perform(post("/api/todos")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(createReq)))
                .andExpect(status().isCreated())
                .andExpect(header().string("X-Served-By", "backend-test-replica-1"))
                .andExpect(header().exists("X-Rate-Limit-Remaining"))
                .andExpect(jsonPath("$.id", notNullValue()))
                .andExpect(jsonPath("$.title", is("Configure Nginx Upstream")))
                .andExpect(jsonPath("$.priority", is("HIGH")))
                .andExpect(jsonPath("$.listId", is(listId.intValue())))
                .andExpect(jsonPath("$.listName", is("Infrastructure")))
                .andExpect(jsonPath("$.completed", is(false)))
                .andReturn();

        Long createdId = objectMapper.readTree(createResult.getResponse().getContentAsString()).get("id").asLong();

        // 2. Get Todos with query filter (?listId=&priority=HIGH&q=Nginx&sort=priority)
        mockMvc.perform(get("/api/todos")
                        .param("listId", String.valueOf(listId))
                        .param("priority", "HIGH")
                        .param("q", "Nginx")
                        .param("sort", "priority"))
                .andExpect(status().isOk())
                .andExpect(header().string("X-Served-By", "backend-test-replica-1"))
                .andExpect(jsonPath("$", hasSize(1)))
                .andExpect(jsonPath("$[0].id", is(createdId.intValue())));

        // 3. Update Todo
        TodoRequest updateReq = new TodoRequest(
                "Configure Nginx Upstream & Failover",
                "Added proxy_next_upstream",
                true,
                Priority.LOW,
                LocalDate.now().plusDays(5),
                listId
        );
        mockMvc.perform(put("/api/todos/{id}", createdId)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(updateReq)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title", is("Configure Nginx Upstream & Failover")))
                .andExpect(jsonPath("$.priority", is("LOW")))
                .andExpect(jsonPath("$.completed", is(true)));

        // 4. Delete Todo
        mockMvc.perform(delete("/api/todos/{id}", createdId))
                .andExpect(status().isNoContent());

        // Note: 4 writes used so far (POST /api/lists, POST /api/todos, PUT /api/todos, DELETE /api/todos).
        // 5th write: Verify Deletion returns 404
        mockMvc.perform(delete("/api/todos/{id}", createdId))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status", is(404)));
    }

    @Test
    @DisplayName("Test 2: Input validation rejects blank title with structured 400 Bad Request")
    void shouldRejectInvalidTodoPayloadWithValidationErrors() throws Exception {
        TodoRequest invalidReq = new TodoRequest("   ", "Description without valid title", false);

        mockMvc.perform(post("/api/todos")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(invalidReq)))
                .andExpect(status().isBadRequest())
                .andExpect(header().string("X-Served-By", "backend-test-replica-1"))
                .andExpect(jsonPath("$.status", is(400)))
                .andExpect(jsonPath("$.error", is("Validation Failed")))
                .andExpect(jsonPath("$.validationErrors.title", notNullValue()));
    }

    @Test
    @DisplayName("Test 3: Bucket4j rate limiter returns 429 Too Many Requests with Retry-After when quota exceeded")
    void shouldEnforceBucket4jRateLimitOnWriteEndpoints() throws Exception {
        TodoRequest req = new TodoRequest("Rate Limit Test Item", "Testing Bucket4j per-IP limit", false);
        String payload = objectMapper.writeValueAsString(req);
        String clientIp = "203.0.113.42";

        // Test profile configures write-per-minute = 5
        for (int i = 0; i < 5; i++) {
            mockMvc.perform(post("/api/todos")
                            .header("X-Forwarded-For", clientIp)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(payload))
                    .andExpect(status().isCreated());
        }

        // 6th write request from the same IP must be rejected with HTTP 429 and Retry-After header
        mockMvc.perform(post("/api/todos")
                        .header("X-Forwarded-For", clientIp)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(payload))
                .andExpect(status().isTooManyRequests())
                .andExpect(header().exists("Retry-After"))
                .andExpect(header().string("X-Served-By", "backend-test-replica-1"))
                .andExpect(jsonPath("$.status", is(429)))
                .andExpect(jsonPath("$.retryAfterSeconds", greaterThanOrEqualTo(1)));

        // Read requests (GET) from the same IP should still succeed
        mockMvc.perform(get("/api/todos")
                        .header("X-Forwarded-For", clientIp))
                .andExpect(status().isOk());
    }
}
