package com.example.todo.service;

import com.example.todo.dto.TodoListRequest;
import com.example.todo.dto.TodoListResponse;
import com.example.todo.dto.TodoRequest;
import com.example.todo.dto.TodoResponse;
import com.example.todo.entity.Priority;
import com.example.todo.entity.Todo;
import com.example.todo.entity.TodoList;
import com.example.todo.exception.ResourceNotFoundException;
import com.example.todo.repository.TodoListRepository;
import com.example.todo.repository.TodoRepository;
import io.github.resilience4j.circuitbreaker.CircuitBreaker;
import io.github.resilience4j.circuitbreaker.CircuitBreakerRegistry;
import io.github.resilience4j.timelimiter.TimeLimiter;
import io.github.resilience4j.timelimiter.TimeLimiterRegistry;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
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
    private final TodoListRepository todoListRepository;
    private final TransactionTemplate transactionTemplate;
    private final CircuitBreaker circuitBreaker;
    private final TimeLimiter timeLimiter;
    private final ExecutorService dbExecutor = Executors.newCachedThreadPool();

    public TodoService(TodoRepository todoRepository,
                       TodoListRepository todoListRepository,
                       TransactionTemplate transactionTemplate,
                       CircuitBreakerRegistry circuitBreakerRegistry,
                       TimeLimiterRegistry timeLimiterRegistry) {
        this.todoRepository = todoRepository;
        this.todoListRepository = todoListRepository;
        this.transactionTemplate = transactionTemplate;
        this.circuitBreaker = circuitBreakerRegistry.circuitBreaker(RESILIENCE_INSTANCE);
        this.timeLimiter = timeLimiterRegistry.timeLimiter(RESILIENCE_INSTANCE);
    }

    public List<TodoResponse> getAllTodos() {
        return getTodos(null, null, null, null, null);
    }

    public List<TodoResponse> getTodos(Long listId,
                                       String status,
                                       Priority priority,
                                       String query,
                                       String sort) {
        return executeResilient(() -> transactionTemplate.execute(tx -> {
            List<Todo> all = todoRepository.findAllByOrderByCreatedAtDesc();
            String normalizedQuery = query != null ? query.trim().toLowerCase(Locale.ROOT) : "";
            String normalizedStatus = status != null ? status.trim().toLowerCase(Locale.ROOT) : "";
            String normalizedSort = sort != null ? sort.trim().toLowerCase(Locale.ROOT) : "createdat";

            Comparator<Todo> comparator = switch (normalizedSort) {
                case "duedate" -> Comparator
                        .comparing(Todo::getDueDate, Comparator.nullsLast(Comparator.naturalOrder()))
                        .thenComparing(Todo::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder()));
                case "priority" -> Comparator
                        .comparingInt((Todo t) -> priorityRank(t.getPriority()))
                        .thenComparing(Todo::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder()));
                default -> Comparator
                        .comparing(Todo::getCreatedAt, Comparator.nullsLast(Comparator.reverseOrder()));
            };

            return all.stream()
                    .filter(todo -> {
                        if (listId != null) {
                            return todo.getTodoList() != null && listId.equals(todo.getTodoList().getId());
                        }
                        return true;
                    })
                    .filter(todo -> switch (normalizedStatus) {
                        case "completed" -> todo.isCompleted();
                        case "active" -> !todo.isCompleted();
                        case "today" -> !todo.isCompleted() && LocalDate.now().equals(todo.getDueDate());
                        case "upcoming" -> !todo.isCompleted()
                                && todo.getDueDate() != null
                                && todo.getDueDate().isAfter(LocalDate.now());
                        default -> true;
                    })
                    .filter(todo -> priority == null || priority == todo.getPriority())
                    .filter(todo -> {
                        if (normalizedQuery.isEmpty()) {
                            return true;
                        }
                        boolean titleMatch = todo.getTitle() != null
                                && todo.getTitle().toLowerCase(Locale.ROOT).contains(normalizedQuery);
                        boolean descMatch = todo.getDescription() != null
                                && todo.getDescription().toLowerCase(Locale.ROOT).contains(normalizedQuery);
                        return titleMatch || descMatch;
                    })
                    .sorted(comparator)
                    .map(TodoResponse::fromEntity)
                    .collect(Collectors.toList());
        }));
    }

    private int priorityRank(Priority priority) {
        if (priority == Priority.HIGH) return 1;
        if (priority == Priority.MEDIUM) return 2;
        return 3;
    }

    public TodoResponse createTodo(TodoRequest request) {
        return executeResilient(() -> transactionTemplate.execute(status -> {
            Todo todo = new Todo(
                    request.getTitle().trim(),
                    request.getDescription() != null ? request.getDescription().trim() : null,
                    Boolean.TRUE.equals(request.getCompleted())
            );
            todo.setPriority(request.getPriority() != null ? request.getPriority() : Priority.MEDIUM);
            todo.setDueDate(request.getDueDate());
            if (request.getListId() != null) {
                TodoList list = todoListRepository.findById(request.getListId())
                        .orElseThrow(() -> new ResourceNotFoundException("List not found with id: " + request.getListId()));
                todo.setTodoList(list);
            }
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
            if (request.getPriority() != null) {
                existing.setPriority(request.getPriority());
            }
            existing.setDueDate(request.getDueDate());
            if (request.getListId() != null) {
                TodoList list = todoListRepository.findById(request.getListId())
                        .orElseThrow(() -> new ResourceNotFoundException("List not found with id: " + request.getListId()));
                existing.setTodoList(list);
            } else {
                existing.setTodoList(null);
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

    public List<TodoListResponse> getAllLists() {
        return executeResilient(() -> transactionTemplate.execute(status ->
                todoListRepository.findAllByOrderByCreatedAtAsc()
                        .stream()
                        .map(list -> TodoListResponse.fromEntity(list, todoRepository.countByTodoListId(list.getId())))
                        .collect(Collectors.toList())
        ));
    }

    public TodoListResponse createList(TodoListRequest request) {
        return executeResilient(() -> transactionTemplate.execute(status -> {
            String color = request.getColor() != null && !request.getColor().isBlank()
                    ? request.getColor().trim()
                    : "#6366f1";
            TodoList list = new TodoList(request.getName().trim(), color);
            TodoList saved = todoListRepository.save(list);
            return TodoListResponse.fromEntity(saved, 0L);
        }));
    }

    public TodoListResponse updateList(Long id, TodoListRequest request) {
        return executeResilient(() -> transactionTemplate.execute(status -> {
            TodoList existing = todoListRepository.findById(id)
                    .orElseThrow(() -> new ResourceNotFoundException("List not found with id: " + id));
            existing.setName(request.getName().trim());
            if (request.getColor() != null && !request.getColor().isBlank()) {
                existing.setColor(request.getColor().trim());
            }
            TodoList saved = todoListRepository.save(existing);
            long count = todoRepository.countByTodoListId(saved.getId());
            return TodoListResponse.fromEntity(saved, count);
        }));
    }

    public void deleteList(Long id) {
        executeResilient(() -> {
            transactionTemplate.executeWithoutResult(status -> {
                TodoList existing = todoListRepository.findById(id)
                        .orElseThrow(() -> new ResourceNotFoundException("List not found with id: " + id));
                // Detach todos in this list before deleting
                todoRepository.findAll().stream()
                        .filter(t -> t.getTodoList() != null && id.equals(t.getTodoList().getId()))
                        .forEach(t -> {
                            t.setTodoList(null);
                            todoRepository.save(t);
                        });
                todoListRepository.delete(existing);
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
