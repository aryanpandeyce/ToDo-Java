package com.example.todo.service;

import com.example.todo.dto.TodoRequest;
import com.example.todo.dto.TodoResponse;
import com.example.todo.entity.Todo;
import com.example.todo.exception.ResourceNotFoundException;
import com.example.todo.repository.TodoRepository;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.timelimiter.TimeLimiter;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Supplier;
import java.util.stream.Collectors;

@Service
public class TodoService {

    private static final String RESILIENCE_INSTANCE = "todoDb";

    private final TodoRepository todoRepository;
    private final TransactionTemplate transactionTemplate;
    private final CircuitBreaker circuitBreaker;
    private final TimeLimiter timeLimiter;
    private final ExecutorService dbExecutor = Executors.newCachedThreadPool();

    public TodoService(TodoRepository todoRepository,
                       TransactionTemplate transactionTemplate,
                       CircuitBreakerRegistry circuitBreakerRegistry,
                       TimeLimiterRegistry timeLimiterRegistry) {
        this.todoRepository = todoRepository;
        this.transactionTemplate = transactionTemplate;
        this.circuitBreaker = circuitBreakerRegistry.circuitBreaker(RESILIENCE_INSTANCE);
        this.timeLimiter = timeLimiterRegistry.timeLimiter(RESILIENCE_INSTANCE);
    }

    public List<TodoResponse> getAllTodos() {
        return executeResilient(() -> transactionTemplate.execute(status ->
                todoRepository.findAllByOrderByCreatedAtDesc()
                        .stream()
                        .map(TodoResponse::fromEntity)
                        .collect(Collectors.toList())
        ));
    }

    public TodoResponse createTodo(TodoRequest request) {
        return executeResilient(() -> transactionTemplate.execute(status -> {
            Todo todo = new Todo(
                    request.getTitle().trim(),
                    request.getDescription() != null ? request.getDescription().trim() : null,
                    Boolean.TRUE.equals(request.getCompleted())
            );
            Todo saved = todoRepository.save(todo);
            return TodoResponse.fromEntity(saved);
        }));
    }

    public TodoResponse updateTodo(Long id, TodoRequest request) {
        return executeResilient(() -> transactionTemplate.execute(status -> {
            Todo existing = todoRepository.findById(id)
                    .orElseThrow(() -> new ResourceNotFoundException("Todo not found with id: " + id));
            existing.setTitle(request.getTitle().trim());
            existing.setDescription(request.getDescription() != null ? request.getDescription().trim() : null);
            if (request.getCompleted() != null) {
                existing.setCompleted(request.getCompleted());
            }
            Todo saved = todoRepository.save(existing);
            return TodoResponse.fromEntity(saved);
        }));
    }

    public void deleteTodo(Long id) {
        executeResilient(() -> {
            transactionTemplate.executeWithoutResult(status -> {
                if (!todoRepository.existsById(id)) {
                    throw new ResourceNotFoundException("Todo not found with id: " + id);
                }
                todoRepository.deleteById(id);
            });
            return null;
        });
    }

    private <T> T executeResilient(Supplier<T> dbSupplier) {
        Supplier<CompletableFuture<T>> futureSupplier = () ->
                CompletableFuture.supplyAsync(dbSupplier, dbExecutor);

        Callable<T> timedCall = TimeLimiter.decorateFutureSupplier(timeLimiter, futureSupplier);
        Callable<T> resilientCall = CircuitBreaker.decorateCallable(circuitBreaker, timedCall);

        try {
            return resilientCall.call();
        } catch (RuntimeException e) {
            if (e.getCause() instanceof RuntimeException runtimeCause) {
                throw runtimeCause;
            }
            throw e;
        } catch (Exception e) {
            if (e instanceof java.util.concurrent.TimeoutException timeoutException) {
                throw new RuntimeException(timeoutException);
            }
            if (e.getCause() instanceof RuntimeException runtimeCause) {
                throw runtimeCause;
            }
            throw new RuntimeException("Database execution failed", e);
        }
    }
}

